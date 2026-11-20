from rest_framework.response import Response
from rest_framework.views import APIView

from grn.models import GRN
from inventory.models import InventoryBatch, InventoryUnit, StockAllocation
from inventory.services.fifo import find_older_bulk
from warehouses.models import RackTransfer
from withdrawals.models import Withdrawal


class StockReportView(APIView):
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
    def get(self, request):
        return Response(
            list(
                GRN.objects.select_related('vendor').values(
                    'id', 'grn_number', 'external_system', 'received_date', 'status', 'vendor__name'
                )
            )
        )


class WithdrawalReportView(APIView):
    def get(self, request):
        return Response(
            list(
                Withdrawal.objects.select_related('user').values(
                    'id', 'purpose', 'reference', 'created_at', 'user__username'
                )
            )
        )


class RackOccupancyReportView(APIView):
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
