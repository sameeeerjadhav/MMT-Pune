from decimal import Decimal

from django.db import transaction

from barcodes.services import create_barcode, label_payload
from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryTransaction, InventoryUnit, StockAllocation
from warehouses.models import Rack, RackPosition, RackTransfer, Shelf, Warehouse


@transaction.atomic
def create_rack(*, warehouse_id, code, name, shelves=None):
    warehouse = Warehouse.objects.get(pk=warehouse_id)
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


@transaction.atomic
def allocate_stock(*, position_id, user, batch_id=None, unit_id=None, quantity=None, allocation_type='ACTUAL'):
    if bool(batch_id) == bool(unit_id):
        raise ApiError('VALIDATION_ERROR', 'Provide exactly one of batch_id or unit_id')
    position = RackPosition.objects.select_related('shelf__rack').get(pk=position_id)

    if batch_id:
        batch = InventoryBatch.objects.select_for_update().get(pk=batch_id)
        qty = Decimal(str(quantity if quantity is not None else batch.available_qty))
        if qty <= 0 or qty > batch.available_qty:
            raise ApiError('INVALID_QTY', 'Invalid allocation quantity')
        if allocation_type == 'ACTUAL':
            StockAllocation.objects.filter(
                batch=batch, allocation_type='ACTUAL', is_active=True
            ).update(is_active=False)
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
    from_pos = RackPosition.objects.get(pk=from_position_id)
    to_pos = RackPosition.objects.get(pk=to_position_id)

    transfer = RackTransfer.objects.create(
        from_position=from_pos,
        to_position=to_pos,
        batch_id=batch_id,
        unit_id=unit_id,
        quantity=quantity,
        reason=reason,
        user=user,
    )

    if batch_id:
        qty = Decimal(str(quantity or 0))
        if qty <= 0:
            raise ApiError('INVALID_QTY', 'Quantity required for batch transfer')
        StockAllocation.objects.filter(
            batch_id=batch_id, position=from_pos, allocation_type='ACTUAL', is_active=True
        ).update(is_active=False)
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch_id=batch_id,
            position=to_pos,
            quantity=qty,
        )
        InventoryTransaction.objects.create(
            type='TRANSFER',
            batch_id=batch_id,
            quantity=qty,
            from_position=from_pos,
            to_position=to_pos,
            transfer=transfer,
            user=user,
            notes=reason,
        )
    else:
        StockAllocation.objects.filter(
            unit_id=unit_id, position=from_pos, allocation_type='ACTUAL', is_active=True
        ).update(is_active=False)
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            unit_id=unit_id,
            position=to_pos,
            quantity=Decimal('1'),
        )
        InventoryTransaction.objects.create(
            type='TRANSFER',
            unit_id=unit_id,
            quantity=Decimal('1'),
            from_position=from_pos,
            to_position=to_pos,
            transfer=transfer,
            user=user,
            notes=reason,
        )
    return transfer
