"""Cycle-count variance: what was physically scanned vs. what the system says is on the rack."""

from collections import Counter
from decimal import Decimal

from inventory.models import StockAllocation

MATCH = 'MATCH'
MISSING = 'MISSING'  # system says it is here, nothing scanned
SHORT = 'SHORT'  # batch scanned, fewer than the system expects
OVER = 'OVER'  # batch scanned, more than the system expects
UNEXPECTED = 'UNEXPECTED'  # scanned here, but the system has it elsewhere (or nowhere)

PROBLEM_ORDER = {MISSING: 0, SHORT: 1, OVER: 2, UNEXPECTED: 3, MATCH: 4}
ZERO = Decimal('0')


def fmt_qty(value) -> str:
    text = f'{Decimal(value):f}'
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text or '0'


def position_label(position) -> str:
    shelf = position.shelf
    rack = shelf.rack
    return f'{rack.warehouse.code}/{rack.code}/{shelf.code}/{position.code}'


def system_location(*, batch=None, unit=None) -> str:
    """Where the system believes this stock is (all active actual allocations)."""
    qs = StockAllocation.objects.filter(is_active=True, allocation_type='ACTUAL').select_related(
        'position__shelf__rack__warehouse'
    )
    qs = qs.filter(batch=batch) if batch is not None else qs.filter(unit=unit)
    labels = [position_label(a.position) for a in qs]
    return '; '.join(labels) if labels else 'Not allocated'


def expected_in_rack(rack):
    """({batch_id: (batch, qty)}, {unit_id: unit}) the system expects on this rack right now."""
    allocations = StockAllocation.objects.filter(
        is_active=True, allocation_type='ACTUAL', position__shelf__rack=rack
    ).select_related('batch__item', 'unit__item')
    batches: dict[int, list] = {}
    units = {}
    for alloc in allocations:
        if alloc.batch_id:
            entry = batches.setdefault(alloc.batch_id, [alloc.batch, ZERO])
            entry[1] += alloc.quantity or ZERO
        elif alloc.unit_id:
            units[alloc.unit_id] = alloc.unit
    return {k: (v[0], v[1]) for k, v in batches.items()}, units


def _row(*, kind, code, item, expected, counted, status, location=''):
    difference = Decimal(counted) - Decimal(expected)
    return {
        'kind': kind,
        'code': code,
        'item_code': item.item_code,
        'item_name': item.name,
        'uom': item.uom,
        'expected_qty': fmt_qty(expected),
        'counted_qty': fmt_qty(counted),
        'difference': fmt_qty(difference),
        'status': status,
        'system_location': location,
    }


def compute_variance(session) -> dict:
    expected_batches, expected_units = expected_in_rack(session.rack)
    lines = list(session.lines.select_related('batch__item', 'unit__item'))
    rows = []
    seen_batches, seen_units = set(), set()

    for line in lines:
        if line.unit_id:
            seen_units.add(line.unit_id)
            unit = line.unit
            here = line.unit_id in expected_units
            rows.append(
                _row(
                    kind='UNIT',
                    code=unit.unit_code,
                    item=unit.item,
                    expected=1 if here else 0,
                    counted=1,
                    status=MATCH if here else UNEXPECTED,
                    location='' if here else system_location(unit=unit),
                )
            )
        else:
            seen_batches.add(line.batch_id)
            batch = line.batch
            expected = expected_batches[line.batch_id][1] if line.batch_id in expected_batches else ZERO
            counted = line.quantity
            if expected == 0:
                status = UNEXPECTED
            elif counted == expected:
                status = MATCH
            elif counted < expected:
                status = SHORT
            else:
                status = OVER
            rows.append(
                _row(
                    kind='BATCH',
                    code=batch.batch_code,
                    item=batch.item,
                    expected=expected,
                    counted=counted,
                    status=status,
                    location='' if expected > 0 else system_location(batch=batch),
                )
            )

    for unit_id, unit in expected_units.items():
        if unit_id not in seen_units:
            rows.append(
                _row(kind='UNIT', code=unit.unit_code, item=unit.item, expected=1, counted=0, status=MISSING)
            )
    for batch_id, (batch, qty) in expected_batches.items():
        if batch_id not in seen_batches and qty > 0:
            rows.append(
                _row(kind='BATCH', code=batch.batch_code, item=batch.item, expected=qty, counted=0, status=MISSING)
            )

    rows.sort(key=lambda r: (PROBLEM_ORDER[r['status']], r['code']))
    counts = Counter(r['status'] for r in rows)
    return {
        'counts': {s: counts.get(s, 0) for s in PROBLEM_ORDER},
        'differences': sum(counts.get(s, 0) for s in (MISSING, SHORT, OVER, UNEXPECTED)),
        'rows': rows,
    }
