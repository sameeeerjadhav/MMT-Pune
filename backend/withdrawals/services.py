from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F

from audit.models import AuditLog
from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryTransaction, InventoryUnit, StockAllocation
from inventory.services.fifo import assert_fifo_or_override, check_fifo_batch, check_fifo_unit
from withdrawals.models import Withdrawal, WithdrawalLine


def _active_location(obj):
    alloc = (
        obj.allocations.filter(is_active=True, allocation_type='ACTUAL')
        .select_related('position__shelf__rack__warehouse')
        .first()
    )
    if not alloc:
        return {}
    pos = alloc.position
    return {
        'warehouse': pos.shelf.rack.warehouse.code,
        'rack': pos.shelf.rack.code,
        'shelf': pos.shelf.code,
        'position': pos.code,
        'position_id': pos.id,
    }


def _reduce_batch_allocations(batch: InventoryBatch, qty: Decimal) -> None:
    """Reduce active ACTUAL allocation quantities to match a batch withdrawal."""
    remaining = qty
    allocations = list(
        StockAllocation.objects.select_for_update()
        .filter(batch=batch, allocation_type='ACTUAL', is_active=True)
        .order_by('id')
    )
    for alloc in allocations:
        if remaining <= 0:
            break
        current = alloc.quantity or Decimal('0')
        if current <= 0:
            alloc.is_active = False
            alloc.save(update_fields=['is_active', 'updated_at'])
            continue
        take = min(current, remaining)
        new_qty = current - take
        remaining -= take
        if new_qty <= 0:
            alloc.is_active = False
            alloc.quantity = Decimal('0')
            alloc.save(update_fields=['is_active', 'quantity', 'updated_at'])
        else:
            alloc.quantity = new_qty
            alloc.save(update_fields=['quantity', 'updated_at'])


def _get_stock(model, pk, *, label, for_update=False):
    """Fetch a batch/unit by id; bad or unknown ids become 400/404 instead of a 500."""
    qs = model.objects.select_related('item')
    if for_update:
        qs = qs.select_for_update()
    try:
        return qs.get(pk=int(pk))
    except (TypeError, ValueError):
        raise ApiError('VALIDATION_ERROR', f'Invalid {label.lower()} id')
    except model.DoesNotExist:
        raise ApiError('NOT_FOUND', f'{label} not found', status_code=404)


def _parse_qty(quantity) -> Decimal:
    try:
        qty = Decimal(str(quantity or 0))
    except (InvalidOperation, ValueError):
        raise ApiError('INVALID_QTY', 'Quantity must be a number')
    if not qty.is_finite() or qty <= 0:
        raise ApiError('INVALID_QTY', 'Quantity must be positive')
    return qty


def _deactivate_unit_allocations(unit: InventoryUnit) -> None:
    StockAllocation.objects.filter(
        unit=unit, allocation_type='ACTUAL', is_active=True
    ).update(is_active=False)


@transaction.atomic
def validate_withdrawal(*, batch_id=None, unit_id=None, quantity=None):
    """Read-only validation — no ledger writes and no row locks."""
    if batch_id:
        batch = _get_stock(InventoryBatch, batch_id, label='Batch')
        if batch.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
        if batch.testing_status == 'PENDING':
            raise ApiError('INELIGIBLE', 'Cannot withdraw inventory still pending testing')
        if batch.available_qty <= 0:
            raise ApiError(
                'ALREADY_WITHDRAWN',
                'This batch has no remaining quantity — it cannot be withdrawn again',
                details={'available': '0', 'withdrawn_qty': str(batch.withdrawn_qty)},
                status_code=409,
            )
        qty = _parse_qty(quantity)
        if qty > batch.available_qty:
            raise ApiError(
                'INSUFFICIENT_STOCK',
                'Insufficient available quantity',
                details={'available': str(batch.available_qty)},
            )
        fifo = check_fifo_batch(batch, for_update=False)
        return {
            'type': 'BATCH',
            'batch_id': batch.id,
            'batch_code': batch.batch_code,
            'item_name': batch.item.name if batch.item_id else None,
            'available_qty': str(batch.available_qty),
            'withdrawn_qty': str(batch.withdrawn_qty),
            'can_withdraw': True,
            'location': _active_location(batch),
            'fifo': fifo,
        }

    if unit_id:
        unit = _get_stock(InventoryUnit, unit_id, label='Unit')
        if unit.status == 'WITHDRAWN':
            raise ApiError(
                'ALREADY_WITHDRAWN',
                'This unit was already withdrawn and cannot be withdrawn again',
                details={'unit_code': unit.unit_code, 'status': unit.status},
                status_code=409,
            )
        if unit.status != 'AVAILABLE':
            raise ApiError('INELIGIBLE', f'Unit status is {unit.status}')
        if unit.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
        if unit.testing_status == 'PENDING':
            raise ApiError('INELIGIBLE', 'Cannot withdraw inventory still pending testing')
        fifo = check_fifo_unit(unit, for_update=False)
        return {
            'type': 'UNIT',
            'unit_id': unit.id,
            'unit_code': unit.unit_code,
            'item_name': unit.item.name if unit.item_id else None,
            'status': unit.status,
            'can_withdraw': True,
            'location': _active_location(unit),
            'fifo': fifo,
        }

    raise ApiError('VALIDATION_ERROR', 'batch_id or unit_id is required')


@transaction.atomic
def create_withdrawal(
    *,
    user,
    purpose,
    batch_id=None,
    unit_id=None,
    quantity=None,
    reference='',
    notes='',
    override_reason='',
):
    if bool(batch_id) == bool(unit_id):
        raise ApiError('VALIDATION_ERROR', 'Provide exactly one of batch_id or unit_id')

    if batch_id:
        batch = _get_stock(InventoryBatch, batch_id, label='Batch', for_update=True)
        if batch.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
        if batch.testing_status == 'PENDING':
            raise ApiError('INELIGIBLE', 'Cannot withdraw inventory still pending testing')
        if batch.available_qty <= 0:
            raise ApiError(
                'ALREADY_WITHDRAWN',
                'This batch has no remaining quantity — it cannot be withdrawn again',
                status_code=409,
            )
        qty = _parse_qty(quantity)
        if qty > batch.available_qty:
            raise ApiError('INSUFFICIENT_STOCK', 'Insufficient available quantity')

        fifo = check_fifo_batch(batch, for_update=True)
        overridden = assert_fifo_or_override(result=fifo, user=user, override_reason=override_reason)
        previous = _active_location(batch)

        updated = InventoryBatch.objects.filter(pk=batch.id, available_qty__gte=qty).update(
            available_qty=F('available_qty') - qty,
            withdrawn_qty=F('withdrawn_qty') + qty,
        )
        if updated != 1:
            raise ApiError(
                'ALREADY_WITHDRAWN',
                'Stock changed or was already withdrawn — refresh and try again',
                status_code=409,
            )
        batch.refresh_from_db()
        _reduce_batch_allocations(batch, qty)

        withdrawal = Withdrawal.objects.create(
            purpose=purpose, reference=reference, notes=notes, user=user
        )
        WithdrawalLine.objects.create(
            withdrawal=withdrawal,
            batch=batch,
            quantity=qty,
            fifo_ok=not overridden,
            fifo_override=overridden,
            override_reason=override_reason or '',
            previous_location=previous,
        )
        InventoryTransaction.objects.create(
            type='FIFO_OVERRIDE' if overridden else 'WITHDRAW',
            batch=batch,
            quantity=qty,
            purpose=purpose,
            withdrawal=withdrawal,
            user=user,
            override_reason=override_reason or '',
            notes=notes,
            metadata={'fifo': fifo},
        )
        if overridden:
            AuditLog.objects.create(
                user=user,
                action='FIFO_OVERRIDE',
                entity_type='InventoryBatch',
                entity_id=batch.id,
                details={'fifo': fifo, 'reason': override_reason, 'quantity': str(qty)},
            )
        return withdrawal

    unit = _get_stock(InventoryUnit, unit_id, label='Unit', for_update=True)
    if unit.status == 'WITHDRAWN':
        raise ApiError(
            'ALREADY_WITHDRAWN',
            'This unit was already withdrawn and cannot be withdrawn again',
            status_code=409,
        )
    if unit.status != 'AVAILABLE':
        raise ApiError('INELIGIBLE', f'Unit status is {unit.status}')
    if unit.testing_status == 'FAILED':
        raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
    if unit.testing_status == 'PENDING':
        raise ApiError('INELIGIBLE', 'Cannot withdraw inventory still pending testing')

    fifo = check_fifo_unit(unit, for_update=True)
    overridden = assert_fifo_or_override(result=fifo, user=user, override_reason=override_reason)
    previous = _active_location(unit)

    updated = InventoryUnit.objects.filter(pk=unit.id, status='AVAILABLE').update(status='WITHDRAWN')
    if updated != 1:
        raise ApiError(
            'ALREADY_WITHDRAWN',
            'This unit was already withdrawn and cannot be withdrawn again',
            status_code=409,
        )
    _deactivate_unit_allocations(unit)

    withdrawal = Withdrawal.objects.create(
        purpose=purpose, reference=reference, notes=notes, user=user
    )
    WithdrawalLine.objects.create(
        withdrawal=withdrawal,
        unit=unit,
        quantity=Decimal('1'),
        fifo_ok=not overridden,
        fifo_override=overridden,
        override_reason=override_reason or '',
        previous_location=previous,
    )
    InventoryTransaction.objects.create(
        type='FIFO_OVERRIDE' if overridden else 'WITHDRAW',
        unit=unit,
        quantity=Decimal('1'),
        purpose=purpose,
        withdrawal=withdrawal,
        user=user,
        override_reason=override_reason or '',
        notes=notes,
        metadata={'fifo': fifo},
    )
    if overridden:
        AuditLog.objects.create(
            user=user,
            action='FIFO_OVERRIDE',
            entity_type='InventoryUnit',
            entity_id=unit.id,
            details={'fifo': fifo, 'reason': override_reason},
        )
    return withdrawal
