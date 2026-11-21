from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from barcodes.services import create_barcode
from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryTransaction, InventoryUnit, StockAllocation
from warehouses.models import Rack, RackPosition, RackTransfer, Shelf, Warehouse


def _ensure_destination_active(position: RackPosition):
    """Block putaway onto deactivated rack/warehouse."""
    rack = position.shelf.rack
    warehouse = rack.warehouse
    if not rack.is_active or not warehouse.is_active:
        raise ApiError(
            'INACTIVE_LOCATION',
            f'Cannot place stock on inactive location '
            f'({warehouse.code}/{rack.code}). Activate it first or choose another cell.',
            status_code=400,
        )


@transaction.atomic
def deallocate_stock(*, allocation_id, user, reason=''):
    """Soft-remove an active ACTUAL allocation (stock remains available, not on a rack)."""
    alloc = (
        StockAllocation.objects.select_for_update()
        .select_related('batch', 'unit', 'position')
        .filter(pk=allocation_id, is_active=True, allocation_type='ACTUAL')
        .first()
    )
    if not alloc:
        raise ApiError('NOT_FOUND', 'Active allocation not found', status_code=404)

    qty = alloc.quantity or Decimal('1')
    position = alloc.position
    batch = alloc.batch
    unit = alloc.unit

    alloc.is_active = False
    if alloc.batch_id:
        alloc.quantity = Decimal('0')
        alloc.save(update_fields=['is_active', 'quantity', 'updated_at'])
    else:
        alloc.save(update_fields=['is_active', 'updated_at'])

    InventoryTransaction.objects.create(
        type='ADJUST',
        batch=batch,
        unit=unit,
        quantity=qty,
        from_position=position,
        user=user,
        notes=reason or 'Deallocated from rack position',
        metadata={'action': 'DEALLOCATE', 'allocation_id': allocation_id},
    )
    return alloc


@transaction.atomic
def create_rack(*, warehouse_id, code, name, shelves=None):
    warehouse = Warehouse.objects.get(pk=warehouse_id)
    if not warehouse.is_active:
        raise ApiError(
            'INACTIVE_LOCATION',
            f'Cannot create rack in inactive warehouse {warehouse.code}. Activate it first.',
            status_code=400,
        )
    rack = Rack.objects.create(warehouse=warehouse, code=code, name=name)
    barcode = create_barcode(
        'RACK',
        rack.id,
        {'rack_code': rack.code, 'warehouse': warehouse.code, 'company_name': warehouse.name},
    )
    rack.barcode = barcode
    rack.save(update_fields=['barcode'])

    shelf_defs = shelves or [
        {'code': 'A', 'name': 'Shelf A', 'positions': ['01', '02', '03']},
        {'code': 'B', 'name': 'Shelf B', 'positions': ['01', '02', '03']},
    ]
    for shelf_def in shelf_defs:
        shelf = Shelf.objects.create(
            rack=rack, code=shelf_def['code'], name=shelf_def.get('name') or shelf_def['code']
        )
        for pos in shelf_def.get('positions') or ['01', '02']:
            RackPosition.objects.create(shelf=shelf, code=pos, name=f'Pos {pos}')
    return rack


def _merge_or_create_batch_allocation(*, batch, position, qty: Decimal):
    """Keep at most one active ACTUAL allocation per batch+position; merge quantities."""
    existing = (
        StockAllocation.objects.select_for_update()
        .filter(
            batch=batch,
            position=position,
            allocation_type='ACTUAL',
            is_active=True,
        )
        .first()
    )
    if existing:
        existing.quantity = (existing.quantity or Decimal('0')) + qty
        existing.save(update_fields=['quantity', 'updated_at'])
        return existing
    return StockAllocation.objects.create(
        allocation_type='ACTUAL',
        batch=batch,
        position=position,
        quantity=qty,
    )


@transaction.atomic
def allocate_stock(*, position_id, user, batch_id=None, unit_id=None, quantity=None, allocation_type='ACTUAL'):
    if bool(batch_id) == bool(unit_id):
        raise ApiError('VALIDATION_ERROR', 'Provide exactly one of batch_id or unit_id')
    position = RackPosition.objects.select_related('shelf__rack__warehouse').get(pk=position_id)
    _ensure_destination_active(position)

    if batch_id:
        batch = InventoryBatch.objects.select_for_update().get(pk=batch_id)
        qty = Decimal(str(quantity if quantity is not None else batch.available_qty))
        if qty <= 0 or qty > batch.available_qty:
            raise ApiError('INVALID_QTY', 'Invalid allocation quantity')

        if allocation_type == 'ACTUAL':
            # Full putaway to one location: replace all other active ACTUAL rows.
            # Partial putaway: keep other locations (supports split batches).
            full_putaway = qty >= batch.available_qty
            if full_putaway:
                StockAllocation.objects.filter(
                    batch=batch, allocation_type='ACTUAL', is_active=True
                ).update(is_active=False)
                allocation = StockAllocation.objects.create(
                    allocation_type='ACTUAL',
                    batch=batch,
                    position=position,
                    quantity=qty,
                )
            else:
                already = (
                    StockAllocation.objects.filter(
                        batch=batch, allocation_type='ACTUAL', is_active=True
                    ).aggregate(total=Sum('quantity'))['total']
                    or Decimal('0')
                )
                if already + qty > batch.available_qty:
                    raise ApiError(
                        'INVALID_QTY',
                        'Allocation would exceed available quantity across locations',
                        details={
                            'available': str(batch.available_qty),
                            'already_allocated': str(already),
                            'requested': str(qty),
                        },
                    )
                allocation = _merge_or_create_batch_allocation(
                    batch=batch, position=position, qty=qty
                )
        else:
            allocation = StockAllocation.objects.create(
                allocation_type=allocation_type,
                batch=batch,
                position=position,
                quantity=qty,
            )

        InventoryTransaction.objects.create(
            type='ALLOCATE',
            batch=batch,
            quantity=qty,
            to_position=position,
            user=user,
            notes=f'{allocation_type} allocation',
        )
        return allocation

    unit = InventoryUnit.objects.select_for_update().get(pk=unit_id)
    if allocation_type == 'ACTUAL':
        StockAllocation.objects.filter(
            unit=unit, allocation_type='ACTUAL', is_active=True
        ).update(is_active=False)
    allocation = StockAllocation.objects.create(
        allocation_type=allocation_type,
        unit=unit,
        position=position,
        quantity=Decimal('1'),
    )
    InventoryTransaction.objects.create(
        type='ALLOCATE',
        unit=unit,
        quantity=Decimal('1'),
        to_position=position,
        user=user,
        notes=f'{allocation_type} allocation',
    )
    return allocation


@transaction.atomic
def transfer_stock(*, from_position_id, to_position_id, user, batch_id=None, unit_id=None, quantity=None, reason=''):
    if bool(batch_id) == bool(unit_id):
        raise ApiError('VALIDATION_ERROR', 'Provide exactly one of batch_id or unit_id')
    from_pos = (
        RackPosition.objects.select_for_update()
        .select_related('shelf__rack__warehouse')
        .get(pk=from_position_id)
    )
    to_pos = (
        RackPosition.objects.select_for_update()
        .select_related('shelf__rack__warehouse')
        .get(pk=to_position_id)
    )
    if from_pos.id == to_pos.id:
        raise ApiError('VALIDATION_ERROR', 'Source and destination must differ')
    # Allow moving stock *off* inactive locations; block putting it onto inactive ones.
    _ensure_destination_active(to_pos)

    if batch_id:
        batch = InventoryBatch.objects.select_for_update().get(pk=batch_id)
        qty = Decimal(str(quantity or 0))
        if qty <= 0:
            raise ApiError('INVALID_QTY', 'Quantity required for batch transfer')
        source_alloc = (
            StockAllocation.objects.select_for_update()
            .filter(
                batch=batch,
                position=from_pos,
                allocation_type='ACTUAL',
                is_active=True,
            )
            .first()
        )
        if not source_alloc:
            raise ApiError('NOT_FOUND', 'No active allocation at source position', status_code=404)
        available_at_source = source_alloc.quantity or Decimal('0')
        if qty > available_at_source:
            raise ApiError(
                'INSUFFICIENT_STOCK',
                'Transfer quantity exceeds quantity at source location',
                details={'available': str(available_at_source)},
            )

        transfer = RackTransfer.objects.create(
            from_position=from_pos,
            to_position=to_pos,
            batch_id=batch_id,
            unit_id=unit_id,
            quantity=qty,
            reason=reason,
            user=user,
        )

        remaining = available_at_source - qty
        if remaining > 0:
            source_alloc.quantity = remaining
            source_alloc.save(update_fields=['quantity', 'updated_at'])
        else:
            source_alloc.is_active = False
            source_alloc.quantity = Decimal('0')
            source_alloc.save(update_fields=['is_active', 'quantity', 'updated_at'])

        _merge_or_create_batch_allocation(batch=batch, position=to_pos, qty=qty)

        InventoryTransaction.objects.create(
            type='TRANSFER',
            batch=batch,
            quantity=qty,
            from_position=from_pos,
            to_position=to_pos,
            transfer=transfer,
            user=user,
            notes=reason,
        )
    else:
        unit = InventoryUnit.objects.select_for_update().get(pk=unit_id)
        source_alloc = (
            StockAllocation.objects.select_for_update()
            .filter(
                unit=unit,
                position=from_pos,
                allocation_type='ACTUAL',
                is_active=True,
            )
            .first()
        )
        if not source_alloc:
            raise ApiError('NOT_FOUND', 'No active allocation at source position', status_code=404)

        transfer = RackTransfer.objects.create(
            from_position=from_pos,
            to_position=to_pos,
            batch_id=batch_id,
            unit_id=unit_id,
            quantity=Decimal('1'),
            reason=reason,
            user=user,
        )

        source_alloc.is_active = False
        source_alloc.save(update_fields=['is_active', 'updated_at'])
        StockAllocation.objects.filter(
            unit=unit, allocation_type='ACTUAL', is_active=True
        ).exclude(pk=source_alloc.pk).update(is_active=False)
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            unit=unit,
            position=to_pos,
            quantity=Decimal('1'),
        )
        InventoryTransaction.objects.create(
            type='TRANSFER',
            unit=unit,
            quantity=Decimal('1'),
            from_position=from_pos,
            to_position=to_pos,
            transfer=transfer,
            user=user,
            notes=reason,
        )
    return transfer
