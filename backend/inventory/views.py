from django.db.models import Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from barcodes.models import Barcode
from config.exceptions import ApiError
from inventory.models import InventoryBatch, InventoryTransaction, InventoryUnit, Item, StockAllocation
from inventory.serializers import (
    InventoryBatchSerializer,
    InventoryTransactionSerializer,
    InventoryUnitSerializer,
    ItemSerializer,
)
from inventory.services.fifo import check_fifo_batch, check_fifo_unit
from warehouses.models import Rack


class InventoryListView(APIView):
    def get(self, request):
        q = request.query_params.get('q', '').strip()
        inv_type = request.query_params.get('type')
        batch_qs = InventoryBatch.objects.select_related(
            'item', 'item__category', 'barcode', 'grn_line__grn'
        ).prefetch_related(
            Prefetch(
                'allocations',
                queryset=StockAllocation.objects.filter(is_active=True).select_related(
                    'position__shelf__rack__warehouse'
                ),
            )
        )
        unit_qs = InventoryUnit.objects.select_related(
            'item', 'item__category', 'barcode', 'grn_line__grn'
        ).prefetch_related(
            Prefetch(
                'allocations',
                queryset=StockAllocation.objects.filter(is_active=True).select_related(
                    'position__shelf__rack__warehouse'
                ),
            )
        )
        if q:
            batch_qs = batch_qs.filter(
                Q(batch_code__icontains=q)
                | Q(item__name__icontains=q)
                | Q(item__item_code__icontains=q)
                | Q(barcode__value__icontains=q)
            )
            unit_qs = unit_qs.filter(
                Q(unit_code__icontains=q)
                | Q(item__name__icontains=q)
                | Q(item__item_code__icontains=q)
                | Q(barcode__value__icontains=q)
            )
        ctx = {'request': request}
        batches = (
            []
            if inv_type == 'UNIT'
            else InventoryBatchSerializer(batch_qs.order_by('received_at'), many=True, context=ctx).data
        )
        units = (
            []
            if inv_type == 'BULK'
            else InventoryUnitSerializer(unit_qs.order_by('received_at'), many=True, context=ctx).data
        )
        return Response({'batches': batches, 'units': units})


class ItemImageUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        item = get_object_or_404(Item, pk=pk)
        image = request.FILES.get('image')
        if not image:
            raise ApiError('VALIDATION_ERROR', 'image file is required')
        content_type = getattr(image, 'content_type', '') or ''
        if content_type and not content_type.startswith('image/'):
            raise ApiError('VALIDATION_ERROR', 'Only image uploads are allowed')
        # Replace previous image if present
        if item.image:
            item.image.delete(save=False)
        item.image = image
        item.save(update_fields=['image', 'updated_at'])
        return Response(ItemSerializer(item, context={'request': request}).data)


class BatchDetailView(generics.RetrieveAPIView):
    queryset = InventoryBatch.objects.select_related(
        'item', 'item__category', 'barcode', 'grn_line__grn__vendor'
    ).prefetch_related('allocations__position__shelf__rack__warehouse')
    serializer_class = InventoryBatchSerializer


class UnitDetailView(generics.RetrieveAPIView):
    queryset = InventoryUnit.objects.select_related(
        'item', 'item__category', 'barcode', 'grn_line__grn__vendor'
    ).prefetch_related('allocations__position__shelf__rack__warehouse')
    serializer_class = InventoryUnitSerializer


class InventoryHistoryView(APIView):
    def get(self, request, inv_type, pk):
        qs = InventoryTransaction.objects.select_related('user', 'batch', 'unit')
        if inv_type == 'batch':
            qs = qs.filter(batch_id=pk)
        elif inv_type == 'unit':
            qs = qs.filter(unit_id=pk)
        else:
            raise ApiError('VALIDATION_ERROR', 'type must be batch or unit')
        return Response(InventoryTransactionSerializer(qs[:100], many=True).data)


class ScanBarcodeView(APIView):
    def get(self, request, barcode):
        try:
            bc = Barcode.objects.get(value=barcode)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)

        if bc.entity_type == 'BATCH':
            batch = InventoryBatch.objects.select_related(
                'item', 'barcode', 'grn_line__grn'
            ).prefetch_related('allocations__position__shelf__rack__warehouse').get(pk=bc.entity_id)
            fifo = check_fifo_batch(batch)
            return Response(
                {
                    'type': 'BATCH',
                    'barcode': bc.value,
                    'batch': InventoryBatchSerializer(batch, context={'request': request}).data,
                    'fifo': fifo,
                }
            )
        if bc.entity_type == 'UNIT':
            unit = InventoryUnit.objects.select_related(
                'item', 'barcode', 'grn_line__grn'
            ).prefetch_related('allocations__position__shelf__rack__warehouse').get(pk=bc.entity_id)
            fifo = check_fifo_unit(unit)
            return Response(
                {
                    'type': 'UNIT',
                    'barcode': bc.value,
                    'unit': InventoryUnitSerializer(unit, context={'request': request}).data,
                    'fifo': fifo,
                }
            )
        if bc.entity_type == 'RACK':
            rack = Rack.objects.select_related('warehouse', 'barcode').prefetch_related(
                'shelves__positions'
            ).get(barcode=bc)
            return Response({'type': 'RACK', 'barcode': bc.value, 'rack': {
                'id': rack.id,
                'code': rack.code,
                'name': rack.name,
                'warehouse': rack.warehouse.code,
            }})
        raise ApiError('UNSUPPORTED', 'Unsupported barcode type')


class DashboardView(APIView):
    def get(self, request):
        from grn.models import GRN
        from warehouses.models import Rack, RackTransfer
        from withdrawals.models import Withdrawal
        from inventory.services.fifo import find_older_bulk

        batch_agg = InventoryBatch.objects.aggregate(
            available=Sum('available_qty'),
            received=Sum('received_qty'),
        )
        unit_available = InventoryUnit.objects.filter(status='AVAILABLE').count()
        unit_total = InventoryUnit.objects.count()
        recent_tx = InventoryTransaction.objects.select_related('user', 'batch', 'unit')[:10]
        recent_withdrawals = Withdrawal.objects.select_related('user')[:5]
        recent_transfers = RackTransfer.objects.select_related('user')[:5]

        fifo_alerts = []
        for batch in InventoryBatch.objects.filter(available_qty__gt=0).select_related('item')[:40]:
            older = find_older_bulk(batch.item_id, batch.received_at, batch.id)
            if older:
                fifo_alerts.append(
                    {
                        'item': batch.item.name,
                        'newer': batch.batch_code,
                        'older': older.batch_code,
                        'older_available': str(older.available_qty),
                    }
                )

        return Response(
            {
                'total_inventory': float(batch_agg['received'] or 0) + unit_total,
                'total_items': InventoryBatch.objects.values('item_id').distinct().count()
                + InventoryUnit.objects.values('item_id').distinct().count(),
                'available_quantity': float(batch_agg['available'] or 0) + unit_available,
                'bulk_batches': InventoryBatch.objects.count(),
                'individual_units': unit_total,
                'pending_grns': GRN.objects.filter(status='DRAFT').count(),
                'testing_pending': InventoryBatch.objects.filter(testing_status='PENDING').count()
                + InventoryUnit.objects.filter(testing_status='PENDING').count(),
                'total_racks': Rack.objects.count(),
                'low_stock_alerts': list(
                    InventoryBatch.objects.filter(available_qty__gt=0, available_qty__lte=10)
                    .values('batch_code', 'available_qty', 'item__name')[:10]
                ),
                'recent_transactions': InventoryTransactionSerializer(recent_tx, many=True).data,
                'recent_withdrawals': [
                    {
                        'id': w.id,
                        'purpose': w.purpose,
                        'user': w.user.get_full_name() or w.user.username,
                        'created_at': w.created_at,
                    }
                    for w in recent_withdrawals
                ],
                'recent_transfers': [
                    {'id': t.id, 'reason': t.reason, 'created_at': t.created_at}
                    for t in recent_transfers
                ],
                'fifo_alerts': fifo_alerts[:10],
            }
        )
