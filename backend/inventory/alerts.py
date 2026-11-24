"""Low-stock and expiry alerts.

Low stock is per item: withdrawable stock (QA-passed bulk quantity plus QA-passed available units)
at or below the item's `reorder_level`. Items with reorder_level 0 are not monitored.
Expiry alerts cover batches that still have stock and an expiry date.
"""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone

from inventory.models import InventoryBatch, InventoryUnit, Item

DEFAULT_EXPIRY_WINDOW_DAYS = 30
MAX_EXPIRY_WINDOW_DAYS = 365


def withdrawable_stock_by_item() -> dict[int, Decimal]:
    totals: dict[int, Decimal] = defaultdict(Decimal)
    batch_rows = (
        InventoryBatch.objects.filter(testing_status='PASSED', available_qty__gt=0)
        .values('item_id')
        .annotate(total=Sum('available_qty'))
    )
    for row in batch_rows:
        totals[row['item_id']] += row['total'] or Decimal('0')
    unit_rows = (
        InventoryUnit.objects.filter(status='AVAILABLE', testing_status='PASSED')
        .values('item_id')
        .annotate(total=Count('id'))
    )
    for row in unit_rows:
        totals[row['item_id']] += Decimal(row['total'])
    return totals


def low_stock_items() -> list[dict]:
    totals = withdrawable_stock_by_item()
    rows = []
    for item in Item.objects.filter(is_active=True, reorder_level__gt=0).order_by('item_code'):
        available = totals.get(item.id, Decimal('0'))
        if available <= item.reorder_level:
            rows.append(
                {
                    'item_id': item.id,
                    'item_code': item.item_code,
                    'item_name': item.name,
                    'uom': item.uom,
                    'available_qty': str(available),
                    'reorder_level': str(item.reorder_level),
                    'out_of_stock': available <= 0,
                }
            )
    # Emptiest first, so the most urgent items lead the list.
    rows.sort(key=lambda r: (Decimal(r['available_qty']) / Decimal(r['reorder_level']), r['item_code']))
    return rows


def _batch_row(batch: InventoryBatch, today) -> dict:
    return {
        'batch_id': batch.id,
        'batch_code': batch.batch_code,
        'item_code': batch.item.item_code,
        'item_name': batch.item.name,
        'available_qty': str(batch.available_qty),
        'expiry_date': batch.expiry_date.isoformat(),
        'days_left': (batch.expiry_date - today).days,
    }


def expiry_alerts(days: int = DEFAULT_EXPIRY_WINDOW_DAYS) -> tuple[list[dict], list[dict]]:
    """Returns (expired, expiring_soon) for batches that still hold stock."""
    today = timezone.localdate()
    live = InventoryBatch.objects.filter(
        expiry_date__isnull=False, available_qty__gt=0
    ).select_related('item')
    expired = [
        _batch_row(b, today) for b in live.filter(expiry_date__lt=today).order_by('expiry_date')
    ]
    soon = [
        _batch_row(b, today)
        for b in live.filter(
            expiry_date__gte=today, expiry_date__lte=today + timedelta(days=days)
        ).order_by('expiry_date')
    ]
    return expired, soon


def build_alerts(days: int = DEFAULT_EXPIRY_WINDOW_DAYS) -> dict:
    low = low_stock_items()
    expired, soon = expiry_alerts(days)
    return {
        'window_days': days,
        'summary': {
            'low_stock': len(low),
            'expired': len(expired),
            'expiring_soon': len(soon),
            'total': len(low) + len(expired) + len(soon),
        },
        'low_stock': low,
        'expired': expired,
        'expiring_soon': soon,
    }
