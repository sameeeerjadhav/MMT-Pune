from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin
from grn.models import GRN
from inventory.models import InventoryBatch, InventoryUnit, StockAllocation
from inventory.services.fifo import find_older_bulk
from reports.pdf import build_withdrawals_report_pdf
from withdrawals.models import Withdrawal


class StockReportView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        batches = list(
            InventoryBatch.objects.select_related('item').values(
                'id', 'batch_code', 'item__name', 'available_qty', 'received_qty', 'withdrawn_qty', 'received_at'
            )
        )
        units = list(
            InventoryUnit.objects.select_related('item').values(
                'id', 'unit_code', 'item__name', 'status', 'received_at'
            )
        )
        return Response({'batches': batches, 'units': units})


class GRNReportView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        return Response(
            list(
                GRN.objects.select_related('vendor').values(
                    'id', 'grn_number', 'external_system', 'received_date', 'status', 'vendor__name'
                )
            )
        )


class WithdrawalReportView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        rows = []
        qs = (
            Withdrawal.objects.select_related('user', 'user__role')
            .prefetch_related('lines__batch__item', 'lines__unit__item')
            .order_by('-created_at')
        )
        for w in qs:
            lines = []
            for line in w.lines.all():
                lines.append(
                    {
                        'batch_code': line.batch.batch_code if line.batch_id else None,
                        'unit_code': line.unit.unit_code if line.unit_id else None,
                        'item_name': (
                            line.batch.item.name
                            if line.batch_id and line.batch.item_id
                            else line.unit.item.name
                            if line.unit_id and line.unit.item_id
                            else None
                        ),
                        'quantity': str(line.quantity),
                        'fifo_override': line.fifo_override,
                        'previous_location': line.previous_location,
                    }
                )
            rows.append(
                {
                    'id': w.id,
                    'purpose': w.purpose,
                    'reference': w.reference,
                    'notes': w.notes,
                    'created_at': w.created_at,
                    'user__username': w.user.username,
                    'user_name': w.user.get_full_name() or w.user.username,
                    'user_role': getattr(w.user, 'role_code', ''),
                    'user_employee_id': w.user.employee_id,
                    'lines': lines,
                }
            )
        return Response(rows)


class WithdrawalReportPdfView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        qs = (
            Withdrawal.objects.select_related('user', 'user__role')
            .prefetch_related('lines__batch__item', 'lines__unit__item')
            .order_by('-created_at')
        )
        pdf = build_withdrawals_report_pdf(qs)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = 'attachment; filename="withdrawal-report.pdf"'
        return response


class RackOccupancyReportView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        allocations = StockAllocation.objects.filter(
            is_active=True, allocation_type='ACTUAL'
        ).select_related('position__shelf__rack__warehouse', 'batch', 'unit')
        data = []
        for a in allocations:
            data.append(
                {
                    'warehouse': a.position.shelf.rack.warehouse.code,
                    'rack': a.position.shelf.rack.code,
                    'shelf': a.position.shelf.code,
                    'position': a.position.code,
                    'batch': a.batch.batch_code if a.batch_id else None,
                    'unit': a.unit.unit_code if a.unit_id else None,
                    'quantity': str(a.quantity) if a.quantity is not None else None,
                }
            )
        return Response(data)


class FIFOReportView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def get(self, request):
        alerts = []
        for batch in InventoryBatch.objects.filter(available_qty__gt=0).select_related('item'):
            older = find_older_bulk(batch.item_id, batch.received_at, batch.id)
            if older:
                alerts.append(
                    {
                        'item': batch.item.name,
                        'newer_batch': batch.batch_code,
                        'newer_date': batch.received_at,
                        'older_batch': older.batch_code,
                        'older_date': older.received_at,
                        'older_available': str(older.available_qty),
                    }
                )
        return Response(alerts)
