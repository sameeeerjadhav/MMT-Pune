from django.db.models import Q

from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryUnit


def _location_from_obj(obj):
    alloc = (
        obj.allocations.filter(is_active=True, allocation_type='ACTUAL')
        .select_related('position__shelf__rack__warehouse')
        .first()
    )
    if not alloc:
        return {
            'warehouse': None,
            'rack': None,
            'shelf': None,
            'position': None,
        }
    pos = alloc.position
    return {
        'warehouse': pos.shelf.rack.warehouse.code,
        'rack': pos.shelf.rack.code,
        'shelf': pos.shelf.code,
        'position': pos.code,
    }


def find_older_bulk(item_id: int, received_at, exclude_id: int, *, for_update=False):
    # Only PASSED older stock blocks withdraw — PENDING is not releasable yet.
    qs = InventoryBatch.objects.filter(
        item_id=item_id,
        available_qty__gt=0,
        testing_status='PASSED',
    ).exclude(id=exclude_id).filter(
        Q(received_at__lt=received_at) | Q(received_at=received_at, id__lt=exclude_id)
    ).order_by('received_at', 'id')
    if for_update:
        qs = qs.select_for_update()
    return qs.first()


def find_older_unit(item_id: int, received_at, exclude_id: int, *, for_update=False):
    qs = InventoryUnit.objects.filter(
        item_id=item_id,
        status='AVAILABLE',
        testing_status='PASSED',
    ).exclude(id=exclude_id).filter(
        Q(received_at__lt=received_at) | Q(received_at=received_at, id__lt=exclude_id)
    ).order_by('received_at', 'id')
    if for_update:
        qs = qs.select_for_update()
    return qs.first()


def older_stock_payload(older, kind: str):
    loc = _location_from_obj(older)
    if kind == 'BATCH':
        return {
            'kind': 'BATCH',
            'id': older.id,
            'code': older.batch_code,
            'grn_date': older.received_at.isoformat(),
            'available_qty': str(older.available_qty),
            **loc,
        }
    return {
        'kind': 'UNIT',
        'id': older.id,
        'code': older.unit_code,
        'grn_date': older.received_at.isoformat(),
        'available_qty': '1',
        **loc,
    }


def check_fifo_batch(batch: InventoryBatch, *, for_update=False):
    older = find_older_bulk(batch.item_id, batch.received_at, batch.id, for_update=for_update)
    if not older:
        return {'eligible': True, 'older': None}
    payload = older_stock_payload(older, 'BATCH')
    return {
        'eligible': False,
        'code': 'FIFO_VIOLATION',
        'message': 'Older stock is available and should be withdrawn first.',
        'older': payload,
    }


def check_fifo_unit(unit: InventoryUnit, *, for_update=False):
    older = find_older_unit(unit.item_id, unit.received_at, unit.id, for_update=for_update)
    if not older:
        return {'eligible': True, 'older': None}
    payload = older_stock_payload(older, 'UNIT')
    return {
        'eligible': False,
        'code': 'FIFO_VIOLATION',
        'message': 'Older stock is available and should be withdrawn first.',
        'older': payload,
    }


def assert_fifo_or_override(*, result, user, override_reason: str):
    if result.get('eligible'):
        return False
    if not override_reason:
        raise ApiError(
            'FIFO_VIOLATION',
            result['message'],
            status_code=409,
            details=result,
        )
    if not user.has_role('ADMIN', 'SUPERVISOR'):
        raise ApiError(
            'FORBIDDEN',
            'Only supervisors or administrators can override older-stock order.',
            status_code=403,
        )
    return True
