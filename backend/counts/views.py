from decimal import Decimal, InvalidOperation

from django.db.models import Count
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin, IsWarehouseStaff
from audit.idempotency import idempotent
from audit.models import AuditLog
from barcodes.models import Barcode
from config.exceptions import ApiError
from counts.models import CountLine, CountSession
from counts.services import compute_variance, expected_in_rack, fmt_qty, system_location
from inventory.models import InventoryBatch, InventoryUnit
from reports.exports import csv_response
from warehouses.models import Rack

LIST_LIMIT = 50


def _user_name(user) -> str:
    return (user.get_full_name() or user.username) if user else ''


def _rack_payload(rack: Rack) -> dict:
    return {
        'id': rack.id,
        'code': rack.code,
        'name': rack.name,
        'warehouse_code': rack.warehouse.code,
    }


def _line_payload(line: CountLine) -> dict:
    stock = line.batch if line.batch_id else line.unit
    return {
        'id': line.id,
        'barcode_value': line.barcode_value,
        'kind': 'BATCH' if line.batch_id else 'UNIT',
        'code': line.batch.batch_code if line.batch_id else line.unit.unit_code,
        'item_code': stock.item.item_code,
        'item_name': stock.item.name,
        'quantity': fmt_qty(line.quantity),
        'scanned_at': line.scanned_at,
    }


def _session_payload(session: CountSession, *, line_count=None) -> dict:
    data = {
        'id': session.id,
        'rack': _rack_payload(session.rack),
        'status': session.status,
        'notes': session.notes,
        'started_by': _user_name(session.started_by),
        'started_at': session.started_at,
        'submitted_by': _user_name(session.submitted_by),
        'submitted_at': session.submitted_at,
        'line_count': line_count if line_count is not None else session.lines.count(),
    }
    if session.status == CountSession.Status.SUBMITTED:
        data['differences'] = session.summary.get('differences', 0)
        data['counts'] = session.summary.get('counts', {})
    return data


def _variance(session: CountSession) -> dict:
    """Live while open; the frozen snapshot once submitted."""
    if session.status == CountSession.Status.SUBMITTED and session.summary:
        return session.summary
    return compute_variance(session)


def _get_session(pk) -> CountSession:
    try:
        return CountSession.objects.select_related(
            'rack__warehouse', 'started_by', 'submitted_by'
        ).get(pk=pk)
    except CountSession.DoesNotExist:
        raise ApiError('NOT_FOUND', 'Count not found', status_code=404)


def _ensure_open_and_editable(user, session: CountSession):
    if session.status != CountSession.Status.OPEN:
        raise ApiError('CONFLICT', 'This count was already submitted.', status_code=409)
    if session.started_by_id != user.id and not user.has_role('ADMIN', 'SUPERVISOR'):
        raise ApiError(
            'FORBIDDEN', 'Only the person who started this count, or a supervisor, can change it.',
            status_code=403,
        )


class CountListCreateView(APIView):
    permission_classes = [IsWarehouseStaff]

    def get(self, request):
        qs = CountSession.objects.select_related('rack__warehouse', 'started_by', 'submitted_by')
        status_filter = (request.query_params.get('status') or '').strip().upper()
        if status_filter:
            qs = qs.filter(status=status_filter)
        rack_id = (request.query_params.get('rack_id') or '').strip()
        if rack_id.isdigit():
            qs = qs.filter(rack_id=int(rack_id))
        if request.query_params.get('mine') in ('1', 'true', 'yes'):
            qs = qs.filter(started_by=request.user)
        rows = qs.annotate(n_lines=Count('lines'))[:LIST_LIMIT]
        return Response([_session_payload(s, line_count=s.n_lines) for s in rows])

    def post(self, request):
        rack_id = request.data.get('rack_id')
        try:
            rack = Rack.objects.select_related('warehouse').get(pk=int(rack_id), is_active=True)
        except (TypeError, ValueError, Rack.DoesNotExist):
            raise ApiError('VALIDATION_ERROR', 'A valid, active rack_id is required')
        open_session = (
            CountSession.objects.select_related('rack__warehouse', 'started_by', 'submitted_by')
            .filter(rack=rack, status=CountSession.Status.OPEN)
            .first()
        )
        if open_session:
            # One open count per rack: resume it instead of starting a parallel one.
            return Response({**_session_payload(open_session), 'resumed': True})
        session = CountSession.objects.create(
            rack=rack,
            started_by=request.user,
            notes=str(request.data.get('notes') or '')[:255],
        )
        session = _get_session(session.pk)
        return Response({**_session_payload(session), 'resumed': False}, status=status.HTTP_201_CREATED)


class CountDetailView(APIView):
    permission_classes = [IsWarehouseStaff]

    def get(self, request, pk):
        session = _get_session(pk)
        lines = session.lines.select_related('batch__item', 'unit__item')
        return Response(
            {
                **_session_payload(session),
                'lines': [_line_payload(line) for line in lines],
                'variance': _variance(session),
            }
        )


def _parse_scanned_at(raw):
    try:
        parsed = parse_datetime(str(raw)) if raw else None
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        parsed = None
    now = timezone.now()
    if parsed is None:
        return now
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return min(parsed, now)  # a phone clock running ahead must not create future-dated scans


class CountScanView(APIView):
    """Record one scan. Batches need the physically counted quantity; units count as 1."""

    permission_classes = [IsWarehouseStaff]

    @idempotent
    def post(self, request, pk):
        session = _get_session(pk)
        _ensure_open_and_editable(request.user, session)

        value = str(request.data.get('barcode') or '').strip()
        if not value:
            raise ApiError('VALIDATION_ERROR', 'barcode is required')
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', f'Barcode {value} not found', status_code=404)
        if barcode.entity_type == Barcode.EntityType.RACK:
            raise ApiError('VALIDATION_ERROR', 'That is a rack label. Scan an item, batch or unit label.')

        scanned_at = _parse_scanned_at(request.data.get('scanned_at'))
        defaults = {'barcode_value': value, 'scanned_by': request.user, 'scanned_at': scanned_at}

        if barcode.entity_type == Barcode.EntityType.BATCH:
            batch = InventoryBatch.objects.select_related('item').filter(barcode=barcode).first()
            if batch is None:
                raise ApiError('NOT_FOUND', f'No batch is linked to barcode {value}', status_code=404)
            try:
                quantity = Decimal(str(request.data.get('quantity')))
            except (InvalidOperation, TypeError, ValueError):
                quantity = None
            if quantity is None or not quantity.is_finite() or quantity <= 0:
                raise ApiError('VALIDATION_ERROR', 'quantity (counted amount, above 0) is required for a batch')
            line, created = CountLine.objects.update_or_create(
                session=session, batch=batch, defaults={**defaults, 'quantity': quantity}
            )
            expected_map, _ = expected_in_rack(session.rack)
            expected = expected_map[batch.id][1] if batch.id in expected_map else Decimal('0')
            here = expected > 0
            location = '' if here else system_location(batch=batch)
        else:
            unit = InventoryUnit.objects.select_related('item').filter(barcode=barcode).first()
            if unit is None:
                raise ApiError('NOT_FOUND', f'No unit is linked to barcode {value}', status_code=404)
            line, created = CountLine.objects.get_or_create(
                session=session, unit=unit, defaults={**defaults, 'quantity': Decimal('1')}
            )
            _, expected_units = expected_in_rack(session.rack)
            here = unit.id in expected_units
            expected = Decimal('1') if here else Decimal('0')
            location = '' if here else system_location(unit=unit)

        line = CountLine.objects.select_related('batch__item', 'unit__item').get(pk=line.pk)
        return Response(
            {
                'line': _line_payload(line),
                'created': created,
                'expected_here': here,
                'expected_qty': fmt_qty(expected),
                'system_location': location,
                'line_count': session.lines.count(),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CountLineDeleteView(APIView):
    """Undo a scan while the count is still open."""

    permission_classes = [IsWarehouseStaff]

    def delete(self, request, pk, line_id):
        session = _get_session(pk)
        _ensure_open_and_editable(request.user, session)
        deleted, _ = CountLine.objects.filter(session=session, pk=line_id).delete()
        if not deleted:
            raise ApiError('NOT_FOUND', 'Scan not found', status_code=404)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CountSubmitView(APIView):
    """Freeze the result. Differences are only reported; stock is never changed automatically."""

    permission_classes = [IsWarehouseStaff]

    @idempotent
    def post(self, request, pk):
        session = _get_session(pk)
        _ensure_open_and_editable(request.user, session)
        variance = compute_variance(session)
        session.status = CountSession.Status.SUBMITTED
        session.submitted_by = request.user
        session.submitted_at = timezone.now()
        session.summary = variance
        session.save(update_fields=['status', 'submitted_by', 'submitted_at', 'summary'])
        AuditLog.objects.create(
            user=request.user,
            action='COUNT_SUBMIT',
            entity_type='CountSession',
            entity_id=session.id,
            details={
                'rack': session.rack.code,
                'counts': variance['counts'],
                'differences': variance['differences'],
            },
        )
        session = _get_session(session.pk)
        return Response({**_session_payload(session), 'variance': variance})


class CountVarianceCsvView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request, pk):
        session = _get_session(pk)
        variance = _variance(session)
        header = [
            'Status', 'Type', 'Code', 'Item code', 'Item name', 'Expected', 'Counted',
            'Difference', 'System location',
        ]
        rows = [
            [
                r['status'], r['kind'], r['code'], r['item_code'], r['item_name'],
                r['expected_qty'], r['counted_qty'], r['difference'], r['system_location'],
            ]
            for r in variance['rows']
        ]
        return csv_response(f'count-{session.id}-{session.rack.code}.csv', header, rows)
