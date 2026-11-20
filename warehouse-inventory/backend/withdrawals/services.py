from decimal import Decimal

from django.db import transaction

from audit.models import AuditLog
from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryTransaction, InventoryUnit
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


@transaction.atomic
def validate_withdrawal(*, batch_id=None, unit_id=None, quantity=None):
    if batch_id:
        batch = InventoryBatch.objects.select_for_update().get(pk=batch_id)
        if batch.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
        qty = Decimal(str(quantity or 0))
        if qty <= 0:
            raise ApiError('INVALID_QTY', 'Quantity must be positive')
        if qty > batch.available_qty:
            raise ApiError(
                'INSUFFICIENT_STOCK',
                'Insufficient available quantity',
                details={'available': str(batch.available_qty)},
            )
        fifo = check_fifo_batch(batch, for_update=True)
        InventoryTransaction.objects.create(
            type='FIFO_CHECK',
            batch=batch,
            quantity=qty,
            metadata=fifo,
        )
        return {
            'type': 'BATCH',
            'batch_id': batch.id,
            'batch_code': batch.batch_code,
            'available_qty': str(batch.available_qty),
            'location': _active_location(batch),
            'fifo': fifo,
        }

    if unit_id:
        unit = InventoryUnit.objects.select_for_update().get(pk=unit_id)
        if unit.status != 'AVAILABLE':
            raise ApiError('INELIGIBLE', f'Unit status is {unit.status}')
        if unit.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
        fifo = check_fifo_unit(unit, for_update=True)
        InventoryTransaction.objects.create(
            type='FIFO_CHECK',
            unit=unit,
            quantity=Decimal('1'),
            metadata=fifo,
        )
        return {
            'type': 'UNIT',
            'unit_id': unit.id,
            'unit_code': unit.unit_code,
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
        batch = InventoryBatch.objects.select_for_update().get(pk=batch_id)
        if batch.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')
        qty = Decimal(str(quantity or 0))
        if qty <= 0:
            raise ApiError('INVALID_QTY', 'Quantity must be positive')
        if qty > batch.available_qty:
            raise ApiError('INSUFFICIENT_STOCK', 'Insufficient available quantity')

        fifo = check_fifo_batch(batch, for_update=True)
        overridden = assert_fifo_or_override(result=fifo, user=user, override_reason=override_reason)
        previous = _active_location(batch)

        batch.available_qty -= qty
        batch.withdrawn_qty += qty
        if batch.available_qty < 0:
            raise ApiError('NEGATIVE_STOCK', 'Negative stock prevented')
        batch.save(update_fields=['available_qty', 'withdrawn_qty', 'updated_at'])

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

    unit = InventoryUnit.objects.select_for_update().get(pk=unit_id)
    if unit.status != 'AVAILABLE':
        raise ApiError('INELIGIBLE', f'Unit status is {unit.status}')
    if unit.testing_status == 'FAILED':
        raise ApiError('INELIGIBLE', 'Cannot withdraw failed inventory')

    fifo = check_fifo_unit(unit, for_update=True)
    overridden = assert_fifo_or_override(result=fifo, user=user, override_reason=override_reason)
    previous = _active_location(unit)

    updated = InventoryUnit.objects.filter(pk=unit.id, status='AVAILABLE').update(status='WITHDRAWN')
    if updated != 1:
        raise ApiError('CONCURRENT_UPDATE', 'Unit already withdrawn', status_code=409)

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
