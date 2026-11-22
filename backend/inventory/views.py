from django.db.models import Prefetch, Q, Sum
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin
from barcodes.models import Barcode
from config.exceptions import ApiError
from inventory.models import (
    Category,
    InventoryBatch,
    InventoryTransaction,
    InventoryUnit,
    Item,
    StockAllocation,
)
from inventory.serializers import (
    CategorySerializer,
    InventoryBatchSerializer,
    InventoryTransactionSerializer,
    InventoryUnitSerializer,
    ItemSerializer,
    TestingStatusSerializer,
)
from inventory.services.fifo import check_fifo_batch, check_fifo_unit
from warehouses.models import Rack


class InventoryListView(APIView):
    def get(self, request):
        from django.db.models import Exists, OuterRef

        q = request.query_params.get('q', '').strip()
        inv_type = (request.query_params.get('type') or '').strip().upper()
        testing = (request.query_params.get('testing_status') or '').strip().upper()
        unit_status = (request.query_params.get('status') or '').strip().upper()
        allocated = (request.query_params.get('allocated') or '').strip().lower()

        alloc_prefetch = Prefetch(
            'allocations',
            queryset=StockAllocation.objects.filter(is_active=True).select_related(
                'position__shelf__rack__warehouse'
            ),
        )
        batch_qs = InventoryBatch.objects.select_related(
            'item', 'item__category', 'barcode', 'grn_line__grn'
        ).prefetch_related(alloc_prefetch)
        unit_qs = InventoryUnit.objects.select_related(
            'item', 'item__category', 'barcode', 'grn_line__grn'
        ).prefetch_related(alloc_prefetch)

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
        if testing in ('PENDING', 'PASSED', 'FAILED'):
            batch_qs = batch_qs.filter(testing_status=testing)
            unit_qs = unit_qs.filter(testing_status=testing)
        if unit_status in ('AVAILABLE', 'WITHDRAWN', 'FAILED', 'RESERVED'):
            unit_qs = unit_qs.filter(status=unit_status)

        if allocated in ('1', 'true', 'yes', '0', 'false', 'no'):
            want_alloc = allocated in ('1', 'true', 'yes')
            batch_on_rack = Exists(
                StockAllocation.objects.filter(
                    batch_id=OuterRef('pk'), is_active=True, allocation_type='ACTUAL'
                )
            )
            unit_on_rack = Exists(
                StockAllocation.objects.filter(
                    unit_id=OuterRef('pk'), is_active=True, allocation_type='ACTUAL'
                )
            )
            batch_qs = batch_qs.annotate(_on_rack=batch_on_rack).filter(_on_rack=want_alloc)
            unit_qs = unit_qs.annotate(_on_rack=unit_on_rack).filter(_on_rack=want_alloc)

        only_units = inv_type == 'UNIT'
        only_batches = inv_type in ('BATCH', 'BULK')
        ctx = {'request': request}
        batches = (
            []
            if only_units
            else InventoryBatchSerializer(batch_qs.order_by('received_at'), many=True, context=ctx).data
        )
        units = (
            []
            if only_batches
            else InventoryUnitSerializer(unit_qs.order_by('received_at'), many=True, context=ctx).data
        )
        return Response({'batches': batches, 'units': units})


def _is_lead(user) -> bool:
    return bool(user and user.is_authenticated and user.has_role('ADMIN', 'SUPERVISOR'))


def _include_inactive_items(request) -> bool:
    flag = request.query_params.get('include_inactive', '').lower() in ('1', 'true', 'yes')
    if not flag:
        return False
    return _is_lead(request.user)


class CategoryListView(APIView):
    def get(self, request):
        qs = Category.objects.all().order_by('code')
        q = request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q))
        return Response(CategorySerializer(qs, many=True).data)


class ItemListCreateView(generics.ListCreateAPIView):
    serializer_class = ItemSerializer

    def get_queryset(self):
        qs = Item.objects.select_related('category').order_by('item_code')
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(item_code__icontains=q)
                | Q(name__icontains=q)
                | Q(category__name__icontains=q)
                | Q(category__code__icontains=q)
            )
        if not _include_inactive_items(self.request):
            qs = qs.filter(is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx


class ItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ItemSerializer
    http_method_names = ['get', 'patch', 'put', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = Item.objects.select_related('category')
        # Employees cannot retrieve inactive items by ID.
        if self.request.method == 'GET' and not _is_lead(self.request.user):
            qs = qs.filter(is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method in ('PATCH', 'PUT', 'DELETE'):
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_destroy(self, instance):
        if instance.batches.exists() or instance.units.exists():
            raise ApiError(
                'CONFLICT',
                f'Cannot delete item {instance.item_code}: it has batches or units. '
                'Deactivate it instead.',
                status_code=409,
            )
        try:
            instance.delete()
        except ProtectedError:
            raise ApiError(
                'CONFLICT',
                f'Cannot delete item {instance.item_code}: still referenced elsewhere. '
                'Deactivate it instead.',
                status_code=409,
            )


class ItemImageUploadView(APIView):
    permission_classes = [IsSupervisorOrAdmin]
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

    def get_permissions(self):
        if self.request.method == 'PATCH':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def patch(self, request, *args, **kwargs):
        batch = self.get_object()
        ser = TestingStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        batch.testing_status = ser.validated_data['testing_status']
        batch.save(update_fields=['testing_status', 'updated_at'])
        return Response(InventoryBatchSerializer(batch, context={'request': request}).data)


class UnitDetailView(generics.RetrieveAPIView):
    queryset = InventoryUnit.objects.select_related(
        'item', 'item__category', 'barcode', 'grn_line__grn__vendor'
    ).prefetch_related('allocations__position__shelf__rack__warehouse')
    serializer_class = InventoryUnitSerializer

    def get_permissions(self):
        if self.request.method == 'PATCH':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def patch(self, request, *args, **kwargs):
        unit = self.get_object()
        ser = TestingStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        unit.testing_status = ser.validated_data['testing_status']
        update_fields = ['testing_status', 'updated_at']
        # Keep operational status aligned with QA outcome when still in warehouse.
        if unit.status in ('AVAILABLE', 'FAILED'):
            if unit.testing_status == 'FAILED':
                unit.status = 'FAILED'
                update_fields.append('status')
            elif unit.status == 'FAILED' and unit.testing_status in ('PASSED', 'PENDING'):
                unit.status = 'AVAILABLE'
                update_fields.append('status')
        unit.save(update_fields=update_fields)
        return Response(InventoryUnitSerializer(unit, context={'request': request}).data)


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
            if (not rack.is_active or not rack.warehouse.is_active) and not _is_lead(
                request.user
            ):
                raise ApiError('NOT_FOUND', 'Rack not found', status_code=404)
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
        from inventory.services.fifo import find_older_bulk, find_older_unit

        # Only QA-passed stock is withdrawable — mirror that in the headline metric.
        batch_agg = InventoryBatch.objects.aggregate(
            available=Sum('available_qty'),
            received=Sum('received_qty'),
        )
        withdrawable_batch_qty = (
            InventoryBatch.objects.filter(testing_status='PASSED', available_qty__gt=0).aggregate(
                total=Sum('available_qty')
            )['total']
            or 0
        )
        unit_available = InventoryUnit.objects.filter(
            status='AVAILABLE', testing_status='PASSED'
        ).count()
        unit_total = InventoryUnit.objects.count()
        recent_tx = InventoryTransaction.objects.select_related('user', 'batch', 'unit')[:10]
        recent_withdrawals = Withdrawal.objects.select_related('user')[:5]
        recent_transfers = RackTransfer.objects.select_related('user')[:5]

        fifo_alerts = []
        # Prefer newest lots — those are the ones most likely to conflict with older stock.
        for batch in (
            InventoryBatch.objects.filter(available_qty__gt=0, testing_status='PASSED')
            .select_related('item')
            .order_by('-received_at', '-id')[:40]
        ):
            older = find_older_bulk(batch.item_id, batch.received_at, batch.id)
            if older:
                fifo_alerts.append(
                    {
                        'item': batch.item.name,
                        'newer': batch.batch_code,
                        'newer_id': batch.id,
                        'older': older.batch_code,
                        'older_id': older.id,
                        'older_available': str(older.available_qty),
                        'kind': 'BATCH',
                    }
                )
        for unit in (
            InventoryUnit.objects.filter(status='AVAILABLE', testing_status='PASSED')
            .select_related('item')
            .order_by('-received_at', '-id')[:40]
        ):
            older_u = find_older_unit(unit.item_id, unit.received_at, unit.id)
            if older_u:
                fifo_alerts.append(
                    {
                        'item': unit.item.name,
                        'newer': unit.unit_code,
                        'newer_id': unit.id,
                        'older': older_u.unit_code,
                        'older_id': older_u.id,
                        'older_available': '1',
                        'kind': 'UNIT',
                    }
                )
        fifo_alerts = fifo_alerts[:20]

        return Response(
            {
                'total_inventory': float(batch_agg['received'] or 0) + unit_total,
                'total_items': InventoryBatch.objects.values('item_id').distinct().count()
                + InventoryUnit.objects.values('item_id').distinct().count(),
                'available_quantity': float(withdrawable_batch_qty) + unit_available,
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
