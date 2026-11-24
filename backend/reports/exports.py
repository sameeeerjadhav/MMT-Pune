"""CSV exports for supervisors/admins. UTF-8 with BOM so Excel opens them correctly."""

import csv
import io
import re
from datetime import date, datetime, time

from django.db.models import Prefetch
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin
from config.exceptions import ApiError
from grn.models import GRN
from inventory.models import InventoryBatch, InventoryUnit, StockAllocation
from withdrawals.models import Withdrawal

_FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
_NUMBER_RE = re.compile(r'^-?\d+(\.\d+)?$')


def safe_cell(value) -> str:
    """Stringify a value and defuse spreadsheet formulas typed into free-text fields."""
    if value is None:
        return ''
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        return value.strftime('%Y-%m-%d %H:%M')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bool):
        return 'Yes' if value else 'No'
    text = str(value)
    if text.startswith(_FORMULA_PREFIXES) and not _NUMBER_RE.match(text):
        return "'" + text
    return text


def csv_response(filename: str, header: list[str], rows) -> HttpResponse:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow([safe_cell(cell) for cell in row])
    response = HttpResponse('\ufeff' + buffer.getvalue(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _stamp() -> str:
    return timezone.localtime().strftime('%Y%m%d-%H%M')


def _day_bounds(request):
    """Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive) as aware datetimes."""
    bounds = []
    for name, end in (('from', False), ('to', True)):
        raw = (request.query_params.get(name) or '').strip()
        if not raw:
            bounds.append(None)
            continue
        try:
            day = datetime.strptime(raw, '%Y-%m-%d').date()
        except ValueError:
            raise ApiError('VALIDATION_ERROR', f'"{name}" must be a date like 2026-11-24')
        moment = datetime.combine(day, time.max if end else time.min)
        bounds.append(timezone.make_aware(moment))
    return bounds


def _location_text(allocations) -> str:
    parts = []
    for alloc in allocations:
        pos = alloc.position
        label = f'{pos.shelf.rack.warehouse.code}/{pos.shelf.rack.code}/{pos.shelf.code}/{pos.code}'
        if alloc.quantity is not None:
            label += f' ({alloc.quantity:f})'
        parts.append(label)
    return '; '.join(parts)


class StockCsvView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        actual = Prefetch(
            'allocations',
            queryset=StockAllocation.objects.filter(is_active=True, allocation_type='ACTUAL')
            .select_related('position__shelf__rack__warehouse'),
            to_attr='live_allocations',
        )
        header = [
            'Type', 'Code', 'Barcode', 'Item code', 'Item name', 'Category', 'UoM',
            'Testing status', 'Status', 'Received qty', 'Available qty', 'Withdrawn qty',
            'Received at', 'GRN', 'Location',
        ]

        def rows():
            batches = (
                InventoryBatch.objects.select_related(
                    'item', 'item__category', 'barcode', 'grn_line__grn'
                )
                .prefetch_related(actual)
                .order_by('item__item_code', 'received_at', 'id')
            )
            for b in batches:
                yield [
                    'Batch', b.batch_code, b.barcode.value if b.barcode_id else '',
                    b.item.item_code, b.item.name, b.item.category.name, b.item.uom,
                    b.testing_status, 'AVAILABLE' if b.available_qty > 0 else 'DEPLETED',
                    b.received_qty, b.available_qty, b.withdrawn_qty, b.received_at,
                    b.grn_line.grn.grn_number, _location_text(b.live_allocations),
                ]
            units = (
                InventoryUnit.objects.select_related(
                    'item', 'item__category', 'barcode', 'grn_line__grn'
                )
                .prefetch_related(actual)
                .order_by('item__item_code', 'received_at', 'id')
            )
            for u in units:
                yield [
                    'Unit', u.unit_code, u.barcode.value if u.barcode_id else '',
                    u.item.item_code, u.item.name, u.item.category.name, u.item.uom,
                    u.testing_status, u.status, 1, 1 if u.status == 'AVAILABLE' else 0,
                    1 if u.status == 'WITHDRAWN' else 0, u.received_at,
                    u.grn_line.grn.grn_number, _location_text(u.live_allocations),
                ]

        return csv_response(f'stock-{_stamp()}.csv', header, rows())


class GrnCsvView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        start, end = _day_bounds(request)
        qs = (
            GRN.objects.select_related('vendor')
            .prefetch_related('lines__item')
            .order_by('-received_date', '-id')
        )
        if start:
            qs = qs.filter(received_date__gte=start)
        if end:
            qs = qs.filter(received_date__lte=end)
        header = [
            'GRN', 'Source system', 'External ref', 'Vendor', 'Received date', 'Status',
            'Item code', 'Item name', 'Received qty', 'UoM', 'Classification', 'Testing status',
        ]

        def rows():
            for grn in qs:
                base = [
                    grn.grn_number, grn.external_system, grn.external_ref or '',
                    grn.vendor.name if grn.vendor_id else '', grn.received_date, grn.status,
                ]
                lines = list(grn.lines.all())
                if not lines:
                    yield base + [''] * 6
                for line in lines:
                    yield base + [
                        line.item.item_code, line.item.name, line.received_qty, line.uom,
                        line.classification, line.testing_status,
                    ]

        return csv_response(f'grn-{_stamp()}.csv', header, rows())


class WithdrawalsCsvView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        start, end = _day_bounds(request)
        qs = (
            Withdrawal.objects.select_related('user', 'user__role')
            .prefetch_related('lines__batch__item', 'lines__unit__item')
            .order_by('-created_at', '-id')
        )
        if start:
            qs = qs.filter(created_at__gte=start)
        if end:
            qs = qs.filter(created_at__lte=end)
        header = [
            'Withdrawal ID', 'Date', 'Purpose', 'Reference', 'Notes', 'User', 'Employee ID',
            'Role', 'Batch', 'Unit', 'Item code', 'Item name', 'Quantity',
            'Older-stock override', 'Override reason',
        ]

        def rows():
            for w in qs:
                base = [
                    w.id, w.created_at, w.purpose, w.reference, w.notes,
                    w.user.get_full_name() or w.user.username, w.user.employee_id,
                    getattr(w.user, 'role_code', ''),
                ]
                lines = list(w.lines.all())
                if not lines:
                    yield base + [''] * 7
                for line in lines:
                    item = line.batch.item if line.batch_id else (line.unit.item if line.unit_id else None)
                    yield base + [
                        line.batch.batch_code if line.batch_id else '',
                        line.unit.unit_code if line.unit_id else '',
                        item.item_code if item else '', item.name if item else '',
                        line.quantity, line.fifo_override, line.override_reason,
                    ]

        return csv_response(f'withdrawals-{_stamp()}.csv', header, rows())


class OccupancyCsvView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        header = ['Warehouse', 'Rack', 'Shelf', 'Position', 'Batch', 'Unit', 'Item', 'Quantity']
        allocations = (
            StockAllocation.objects.filter(is_active=True, allocation_type='ACTUAL')
            .select_related(
                'position__shelf__rack__warehouse', 'batch__item', 'unit__item'
            )
            .order_by(
                'position__shelf__rack__warehouse__code',
                'position__shelf__rack__code',
                'position__shelf__code',
                'position__code',
            )
        )

        def rows():
            for a in allocations:
                pos = a.position
                item = a.batch.item if a.batch_id else (a.unit.item if a.unit_id else None)
                yield [
                    pos.shelf.rack.warehouse.code, pos.shelf.rack.code, pos.shelf.code, pos.code,
                    a.batch.batch_code if a.batch_id else '',
                    a.unit.unit_code if a.unit_id else '',
                    item.name if item else '',
                    a.quantity if a.quantity is not None else '',
                ]

        return csv_response(f'rack-occupancy-{_stamp()}.csv', header, rows())
