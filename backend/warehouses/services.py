from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Sum
from django.db.models.deletion import ProtectedError

from barcodes.services import create_barcode
from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryTransaction, InventoryUnit, StockAllocation
from warehouses.models import Floor, Rack, RackPosition, RackTransfer, Shelf, Warehouse


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
    try:
        allocation_id = int(allocation_id)
    except (TypeError, ValueError):
        raise ApiError('VALIDATION_ERROR', 'Invalid allocation id')
    # of=('self',): lock only the allocation row. batch/unit are nullable joins, and PostgreSQL
    # refuses FOR UPDATE on the nullable side of an outer join.
    alloc = (
        StockAllocation.objects.select_for_update(of=('self',))
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
def create_floor(
    *,
    warehouse_id,
    code,
    name,
    level=1,
    row_count=4,
    column_count=5,
    description='',
):
    warehouse = Warehouse.objects.get(pk=warehouse_id)
    code = code.strip().upper()
    if Floor.objects.filter(warehouse=warehouse, code=code).exists():
        raise ApiError('DUPLICATE', f'Floor {code} already exists in this warehouse', status_code=409)
    return Floor.objects.create(
        warehouse=warehouse,
        code=code,
        name=name,
        level=level,
        row_count=row_count,
        column_count=column_count,
        description=description or '',
    )


@transaction.atomic
def update_floor_layout(*, floor_id, row_count, column_count):
    from django.db.models import Q

    floor = Floor.objects.select_for_update().get(pk=floor_id)
    # Racks that would fall outside the new grid.
    outside_ids = list(
        Rack.objects.filter(floor=floor)
        .filter(Q(row_index__gt=row_count) | Q(column_index__gt=column_count))
        .values_list('id', flat=True)
    )
    if outside_ids:
        # Never orphan stocked racks off the map — empty cells could then get a new rack.
        stocked_codes = sorted(
            {
                code
                for code in StockAllocation.objects.filter(
                    is_active=True,
                    allocation_type='ACTUAL',
                    position__shelf__rack_id__in=outside_ids,
                )
                .values_list('position__shelf__rack__code', flat=True)
                .distinct()
                if code
            }
        )
        if stocked_codes:
            raise ApiError(
                'CELL_OCCUPIED',
                'Cannot shrink floor: racks with stock would leave the grid: '
                + ', '.join(stocked_codes)
                + '. Move or deallocate that stock first.',
                status_code=409,
                details={'rack_codes': stocked_codes},
            )
        Rack.objects.filter(pk__in=outside_ids).update(row_index=None, column_index=None)
    floor.row_count = row_count
    floor.column_count = column_count
    floor.save(update_fields=['row_count', 'column_count', 'updated_at'])
    return floor


@transaction.atomic
def place_rack_on_floor(*, floor_id, rack_id, row_index, column_index):
    floor = Floor.objects.select_for_update().get(pk=floor_id)
    if row_index < 1 or row_index > floor.row_count:
        raise ApiError('VALIDATION_ERROR', f'row_index must be 1..{floor.row_count}')
    if column_index < 1 or column_index > floor.column_count:
        raise ApiError('VALIDATION_ERROR', f'column_index must be 1..{floor.column_count}')

    rack = Rack.objects.select_for_update().get(pk=rack_id)
    if rack.warehouse_id != floor.warehouse_id:
        raise ApiError('VALIDATION_ERROR', 'Rack must belong to the same warehouse as the floor')

    conflict = (
        Rack.objects.select_for_update()
        .filter(floor=floor, row_index=row_index, column_index=column_index)
        .exclude(pk=rack.id)
        .first()
    )
    if conflict:
        if conflict.is_active:
            raise ApiError(
                'CELL_OCCUPIED',
                f'Cell R{row_index}-C{column_index} already has rack {conflict.code}',
                status_code=409,
                details={'rack_id': conflict.id, 'rack_code': conflict.code},
            )
        # Inactive racks still hold unique cell coords — clear so the bay can be reused.
        conflict.row_index = None
        conflict.column_index = None
        conflict.floor = None
        conflict.save(update_fields=['row_index', 'column_index', 'floor', 'updated_at'])

    rack.floor = floor
    rack.row_index = row_index
    rack.column_index = column_index
    rack.save(update_fields=['floor', 'row_index', 'column_index', 'updated_at'])
    return rack


def build_floor_map(floor: Floor, *, role: str | None = None):
    """Grid visualization: each cell is a large rack bay with occupancy + stock summary."""
    racks = list(
        Rack.objects.filter(floor=floor, is_active=True)
        .select_related('barcode')
        .prefetch_related('shelves__positions')
    )
    rack_by_cell = {
        (r.row_index, r.column_index): r
        for r in racks
        if r.row_index and r.column_index
    }
    rack_ids = [r.id for r in racks]

    allocations = (
        StockAllocation.objects.filter(
            is_active=True,
            allocation_type='ACTUAL',
            position__shelf__rack_id__in=rack_ids,
        )
        .select_related('batch__item', 'unit__item', 'position__shelf__rack')
        .order_by('id')
    )
    stock_by_rack: dict[int, list] = {}
    qty_by_rack: dict[int, Decimal] = {}
    occupied_sections_by_rack: dict[int, set] = {}
    for a in allocations:
        rid = a.position.shelf.rack_id
        stock_by_rack.setdefault(rid, []).append(
            {
                'allocation_id': a.id,
                'batch_id': a.batch_id,
                'unit_id': a.unit_id,
                'batch_code': a.batch.batch_code if a.batch_id else None,
                'unit_code': a.unit.unit_code if a.unit_id else None,
                'item_name': (
                    a.batch.item.name if a.batch_id else a.unit.item.name if a.unit_id else None
                ),
                'item_code': (
                    a.batch.item.item_code
                    if a.batch_id
                    else a.unit.item.item_code
                    if a.unit_id
                    else None
                ),
                'quantity': str(a.quantity) if a.quantity is not None else None,
                'section': f'{a.position.shelf.code}-{a.position.code}',
            }
        )
        qty_by_rack[rid] = qty_by_rack.get(rid, Decimal('0')) + (a.quantity or Decimal('0'))
        occupied_sections_by_rack.setdefault(rid, set()).add(a.position_id)

    # Employees get compact stock lists; leads/admins get full section detail.
    compact = role == 'WAREHOUSE_EMPLOYEE'

    grid = []
    placed = 0
    occupied_racks = 0
    for r in range(1, floor.row_count + 1):
        row_cells = []
        for c in range(1, floor.column_count + 1):
            rack = rack_by_cell.get((r, c))
            if not rack:
                row_cells.append(
                    {
                        'row_index': r,
                        'column_index': c,
                        'cell_code': f'R{r}-C{c}',
                        'empty': True,
                        'rack': None,
                    }
                )
                continue
            placed += 1
            stock = stock_by_rack.get(rack.id, [])
            if stock:
                occupied_racks += 1
            section_total = sum(len(s.positions.all()) for s in rack.shelves.all())
            occupied_sections = len(occupied_sections_by_rack.get(rack.id, set()))
            stock_preview = stock[:3] if compact else stock
            row_cells.append(
                {
                    'row_index': r,
                    'column_index': c,
                    'cell_code': f'R{r}-C{c}',
                    'empty': False,
                    'rack': {
                        'id': rack.id,
                        'code': rack.code,
                        'name': rack.name,
                        'barcode_value': rack.barcode.value if rack.barcode_id else None,
                        'stock_lines': len(stock),
                        'total_qty': str(qty_by_rack.get(rack.id, Decimal('0'))),
                        'sections_total': section_total,
                        'sections_occupied': occupied_sections,
                        'fill_pct': round((occupied_sections / section_total) * 100) if section_total else 0,
                        'stock': stock_preview,
                        'stock_truncated': compact and len(stock) > 3,
                    },
                }
            )
        grid.append({'row_index': r, 'cells': row_cells})

    placed_ids = {r.id for r in racks if r.row_index and r.column_index}
    unplaced_on_floor = [
        {
            'id': r.id,
            'code': r.code,
            'name': r.name,
            'stock_lines': len(stock_by_rack.get(r.id, [])),
        }
        for r in racks
        if r.id not in placed_ids
    ]

    # Any warehouse rack not currently sitting on this floor grid can be placed.
    warehouse_racks = Rack.objects.filter(warehouse_id=floor.warehouse_id, is_active=True).order_by(
        'code'
    )
    available_to_place = [
        {
            'id': r.id,
            'code': r.code,
            'name': r.name,
            'floor_id': r.floor_id,
            'on_this_floor': r.floor_id == floor.id,
        }
        for r in warehouse_racks
        if r.id not in placed_ids
    ]

    return {
        'floor': {
            'id': floor.id,
            'code': floor.code,
            'name': floor.name,
            'level': floor.level,
            'row_count': floor.row_count,
            'column_count': floor.column_count,
            'description': floor.description,
            'warehouse_id': floor.warehouse_id,
            'warehouse_code': floor.warehouse.code,
            'warehouse_name': floor.warehouse.name,
        },
        'summary': {
            'cells': floor.row_count * floor.column_count,
            'placed_racks': placed,
            'empty_cells': floor.row_count * floor.column_count - placed,
            'occupied_racks': occupied_racks,
            'unplaced_racks': len(unplaced_on_floor),
        },
        'viewer_role': role,
        'can_edit_layout': role in ('ADMIN', 'SUPERVISOR'),
        'can_manage_stock': role in ('ADMIN', 'SUPERVISOR', 'WAREHOUSE_EMPLOYEE'),
        'grid': grid,
        'unplaced_racks': unplaced_on_floor,
        'available_racks': available_to_place,
    }


@transaction.atomic
def create_rack(*, warehouse_id, code, name, shelves=None, floor_id=None, row_index=None, column_index=None):
    warehouse = Warehouse.objects.get(pk=warehouse_id)
    if not warehouse.is_active:
        raise ApiError(
            'INACTIVE_LOCATION',
            f'Cannot create rack in inactive warehouse {warehouse.code}. Activate it first.',
            status_code=400,
        )
    floor = None
    if floor_id:
        floor = Floor.objects.get(pk=floor_id)
        if floor.warehouse_id != warehouse.id:
            raise ApiError('VALIDATION_ERROR', 'Floor must belong to the selected warehouse')

    code = code.strip()
    if Rack.objects.filter(warehouse=warehouse, code__iexact=code).exists():
        raise ApiError(
            'DUPLICATE', f'Rack {code} already exists in {warehouse.code}', status_code=409
        )
    rack = Rack.objects.create(warehouse=warehouse, floor=floor, code=code, name=name)
    if floor_id and row_index is not None and column_index is not None:
        place_rack_on_floor(
            floor_id=floor_id, rack_id=rack.id, row_index=row_index, column_index=column_index
        )
        rack.refresh_from_db()

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


def _shelf_code_for_index(index: int) -> str:
    """1-based index → A, B, … Z, AA, AB…"""
    n = index
    chars = []
    while n > 0:
        n, rem = divmod(n - 1, 26)
        chars.append(chr(65 + rem))
    return ''.join(reversed(chars))


def _position_code_for_index(index: int) -> str:
    return f'{index:02d}'


def _natural_sort_key(value: str):
    import re

    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', value or '')]


@transaction.atomic
def update_rack_layout(*, rack_id, row_count: int, column_count: int):
    """
    Resize rack map: rows = shelves, columns = positions.
    Expanding creates empty shelves/positions. Shrinking removes only empty cells
    (positions with no active stock, shelves with no remaining positions).
    """
    rack = Rack.objects.select_for_update().get(pk=rack_id)
    shelves = list(rack.shelves.all())
    shelves_sorted = sorted(shelves, key=lambda s: _natural_sort_key(s.code))

    # Ensure we have row_count shelves (create missing with next letter codes).
    existing_codes = {s.code for s in shelves}
    idx = 1
    while len(shelves_sorted) < row_count:
        code = _shelf_code_for_index(idx)
        idx += 1
        if code in existing_codes:
            continue
        shelf = Shelf.objects.create(rack=rack, code=code, name=f'Shelf {code}')
        existing_codes.add(code)
        shelves_sorted.append(shelf)

    # Ensure each kept shelf has column_count positions.
    for shelf in shelves_sorted[:row_count]:
        positions = list(shelf.positions.all())
        positions_sorted = sorted(positions, key=lambda p: _natural_sort_key(p.code))
        existing_pos = {p.code for p in positions}
        pidx = 1
        while len(positions_sorted) < column_count:
            code = _position_code_for_index(pidx)
            pidx += 1
            if code in existing_pos:
                continue
            pos = RackPosition.objects.create(shelf=shelf, code=code, name=f'Pos {code}')
            existing_pos.add(code)
            positions_sorted.append(pos)

        # Shrink positions beyond column_count (from the end).
        if len(positions_sorted) > column_count:
            for pos in reversed(positions_sorted[column_count:]):
                has_stock = StockAllocation.objects.filter(
                    position=pos, is_active=True, allocation_type='ACTUAL'
                ).exists()
                if has_stock:
                    raise ApiError(
                        'CELL_OCCUPIED',
                        f'Cannot remove {shelf.code}/{pos.code}: still has stock. Move or deallocate first.',
                        status_code=409,
                    )
                # Drop inactive allocation rows so PROTECT does not block empty-cell shrink.
                StockAllocation.objects.filter(position=pos, is_active=False).delete()
                try:
                    pos.delete()
                except ProtectedError:
                    raise ApiError(
                        'CONFLICT',
                        f'Cannot remove position {shelf.code}/{pos.code}: referenced by transfer history. '
                        'Leave the column count as-is.',
                        status_code=409,
                    )

    # Shrink shelves beyond row_count (from the end).
    if len(shelves_sorted) > row_count:
        for shelf in reversed(shelves_sorted[row_count:]):
            for pos in shelf.positions.all():
                has_stock = StockAllocation.objects.filter(
                    position=pos, is_active=True, allocation_type='ACTUAL'
                ).exists()
                if has_stock:
                    raise ApiError(
                        'CELL_OCCUPIED',
                        f'Cannot remove shelf {shelf.code}: still has stock. Move or deallocate first.',
                        status_code=409,
                    )
            for pos in list(shelf.positions.all()):
                StockAllocation.objects.filter(position=pos, is_active=False).delete()
            try:
                shelf.delete()
            except ProtectedError:
                raise ApiError(
                    'CONFLICT',
                    f'Cannot remove shelf {shelf.code}: referenced by transfer history.',
                    status_code=409,
                )

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


def _get_by_id(qs, pk, *, label):
    """Fetch by id; bad or unknown ids become 400/404 instead of a 500."""
    try:
        return qs.get(pk=int(pk))
    except (TypeError, ValueError):
        raise ApiError('VALIDATION_ERROR', f'Invalid {label.lower()} id')
    except qs.model.DoesNotExist:
        raise ApiError('NOT_FOUND', f'{label} not found', status_code=404)


def _parse_decimal(value, *, message='Quantity must be a number') -> Decimal:
    try:
        qty = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ApiError('INVALID_QTY', message)
    if not qty.is_finite():
        raise ApiError('INVALID_QTY', message)
    return qty


@transaction.atomic
def allocate_stock(*, position_id, user, batch_id=None, unit_id=None, quantity=None, allocation_type='ACTUAL'):
    if bool(batch_id) == bool(unit_id):
        raise ApiError('VALIDATION_ERROR', 'Provide exactly one of batch_id or unit_id')
    if allocation_type not in StockAllocation.AllocationType.values:
        raise ApiError('VALIDATION_ERROR', f'Invalid allocation_type: {allocation_type}')
    position = _get_by_id(
        RackPosition.objects.select_related('shelf__rack__warehouse'), position_id, label='Position'
    )
    _ensure_destination_active(position)

    if batch_id:
        batch = _get_by_id(InventoryBatch.objects.select_for_update(), batch_id, label='Batch')
        if batch.testing_status == 'FAILED':
            raise ApiError('INELIGIBLE', 'Cannot allocate failed inventory')
        if batch.testing_status == 'PENDING':
            raise ApiError('INELIGIBLE', 'Cannot allocate inventory still pending testing')
        if quantity is None or quantity == '':
            raise ApiError(
                'VALIDATION_ERROR',
                'quantity is required for batch allocate (avoids moving the whole batch by mistake)',
            )
        qty = _parse_decimal(quantity)
        if qty <= 0 or qty > batch.available_qty:
            raise ApiError('INVALID_QTY', 'Invalid allocation quantity')

        if allocation_type == 'ACTUAL':
            # Full putaway of remaining qty to one location: replace other active ACTUAL rows.
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

    unit = _get_by_id(InventoryUnit.objects.select_for_update(), unit_id, label='Unit')
    if unit.status != 'AVAILABLE':
        raise ApiError(
            'INELIGIBLE',
            f'Cannot allocate unit with status {unit.status}',
            status_code=400,
        )
    if unit.testing_status == 'FAILED':
        raise ApiError('INELIGIBLE', 'Cannot allocate failed inventory')
    if unit.testing_status == 'PENDING':
        raise ApiError('INELIGIBLE', 'Cannot allocate inventory still pending testing')
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
    positions = RackPosition.objects.select_for_update().select_related('shelf__rack__warehouse')
    from_pos = _get_by_id(positions, from_position_id, label='Source position')
    to_pos = _get_by_id(positions, to_position_id, label='Destination position')
    if from_pos.id == to_pos.id:
        raise ApiError('VALIDATION_ERROR', 'Source and destination must differ')
    # Allow moving stock *off* inactive locations; block putting it onto inactive ones.
    _ensure_destination_active(to_pos)

    if batch_id:
        batch = _get_by_id(InventoryBatch.objects.select_for_update(), batch_id, label='Batch')
        qty = _parse_decimal(quantity or 0)
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
        unit = _get_by_id(InventoryUnit.objects.select_for_update(), unit_id, label='Unit')
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
