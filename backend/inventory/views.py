from django.db.models import Q, Sum
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
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

        from inventory.serializers import (
            InventoryBatchListSerializer,
            InventoryUnitListSerializer,
        )

        q = request.query_params.get('q', '').strip()
        inv_type = (request.query_params.get('type') or '').strip().upper()
        testing = (request.query_params.get('testing_status') or '').strip().upper()
        unit_status = (request.query_params.get('status') or '').strip().upper()
        allocated = (request.query_params.get('allocated') or '').strip().lower()
        try:
            limit = min(max(int(request.query_params.get('limit') or 80), 1), 200)
        except (TypeError, ValueError):
            limit = 80

        # Lean joins only — list UI does not need nested allocations / label JSON.
        batch_qs = InventoryBatch.objects.select_related(
            'item', 'barcode', 'grn_line__grn'
        )
        unit_qs = InventoryUnit.objects.select_related(
            'item', 'barcode', 'grn_line__grn'
        )

        if q:
            # Prefer indexed prefix matches on codes, then broader contains.
            batch_qs = batch_qs.filter(
                Q(batch_code__istartswith=q)
                | Q(item__item_code__istartswith=q)
                | Q(barcode__value__istartswith=q)
                | Q(batch_code__icontains=q)
                | Q(item__name__icontains=q)
                | Q(item__item_code__icontains=q)
                | Q(barcode__value__icontains=q)
            )
            unit_qs = unit_qs.filter(
                Q(unit_code__istartswith=q)
                | Q(item__item_code__istartswith=q)
                | Q(barcode__value__istartswith=q)
                | Q(unit_code__icontains=q)
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

        # Default newest first. Secondary id keeps edits from reshuffling ties.
        ordering = (request.query_params.get('ordering') or '-received_at').strip()
        batch_order_map = {
            'received_at': 'received_at',
            '-received_at': '-received_at',
            'code': 'batch_code',
            '-code': '-batch_code',
            'item': 'item__name',
            '-item': '-item__name',
            'qty': 'available_qty',
            '-qty': '-available_qty',
        }
        unit_order_map = {
            'received_at': 'received_at',
            '-received_at': '-received_at',
            'code': 'unit_code',
            '-code': '-unit_code',
            'item': 'item__name',
            '-item': '-item__name',
            'qty': 'unit_code',  # units are qty 1 — stable by code
            '-qty': '-unit_code',
        }
        batch_order = batch_order_map.get(ordering, '-received_at')
        unit_order = unit_order_map.get(ordering, '-received_at')
        id_tie = '-id' if ordering.startswith('-') else 'id'

        only_units = inv_type == 'UNIT'
        only_batches = inv_type in ('BATCH', 'BULK')
        ctx = {'request': request}
        # Cap payload size so live search stays snappy.
        half = max(limit // 2, 1) if not only_units and not only_batches else limit
        batches = (
            []
            if only_units
            else InventoryBatchListSerializer(
                batch_qs.order_by(batch_order, id_tie)[:half],
                many=True,
                context=ctx,
            ).data
        )
        units = (
            []
            if only_batches
            else InventoryUnitListSerializer(
                unit_qs.order_by(unit_order, id_tie)[:half],
                many=True,
                context=ctx,
            ).data
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
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _clear_image(self, item):
        if item.image:
            try:
                item.image.delete(save=False)
            except OSError:
                # Windows may briefly lock a file after /media/ serve; still clear the DB field.
                pass
            item.image = None
            item.save(update_fields=['image', 'updated_at'])
        return item

    def post(self, request, pk):
        item = get_object_or_404(Item, pk=pk)
        # Clear without DELETE (older/prod servers may not allow DELETE on this route).
        clear_raw = request.data.get('clear') if hasattr(request.data, 'get') else None
        if clear_raw is True:
            clear = 'true'
        else:
            clear = str(clear_raw or request.query_params.get('clear') or '').lower()
        if clear in ('1', 'true', 'yes'):
            item = self._clear_image(item)
            return Response(ItemSerializer(item, context={'request': request}).data)

        image = request.FILES.get('image')
        if not image:
            raise ApiError('VALIDATION_ERROR', 'image file is required')

        max_bytes = 5 * 1024 * 1024
        size = getattr(image, 'size', None)
        if size is not None and size > max_bytes:
            raise ApiError('VALIDATION_ERROR', 'Image must be 5 MB or smaller')

        content_type = (getattr(image, 'content_type', '') or '').lower()
        if content_type and not content_type.startswith('image/'):
            raise ApiError('VALIDATION_ERROR', 'Only image uploads are allowed')

        # Always verify bytes are a real image (Content-Type can be missing/spoofed).
        try:
            from PIL import Image as PilImage

            image.seek(0)
            with PilImage.open(image) as verified:
                verified.verify()
            image.seek(0)
        except Exception as exc:
            raise ApiError('VALIDATION_ERROR', 'Invalid image file') from exc

        # Replace previous image if present
        if item.image:
            item.image.delete(save=False)
        item.image = image
        item.save(update_fields=['image', 'updated_at'])
        return Response(ItemSerializer(item, context={'request': request}).data)

    def delete(self, request, pk):
        item = get_object_or_404(Item, pk=pk)
        item = self._clear_image(item)
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
        qs = InventoryTransaction.objects.select_related(
            'user',
            'batch',
            'unit',
            'from_position__shelf__rack__warehouse',
            'to_position__shelf__rack__warehouse',
            'withdrawal',
        )
        if inv_type == 'batch':
            qs = qs.filter(batch_id=pk)
        elif inv_type == 'unit':
            qs = qs.filter(unit_id=pk)
        else:
            raise ApiError('VALIDATION_ERROR', 'type must be batch or unit')
        return Response(InventoryTransactionSerializer(qs[:100], many=True).data)


class AllocationDetailView(APIView):
    """Full allocation + stock origin + movement history for rack stock taps."""

    def get(self, request, pk):
        alloc = get_object_or_404(
            StockAllocation.objects.select_related(
                'batch__item__category',
                'batch__barcode',
                'batch__grn_line__grn',
                'unit__item__category',
                'unit__barcode',
                'unit__grn_line__grn',
                'position__shelf__rack__warehouse',
            ),
            pk=pk,
        )
        pos = alloc.position
        shelf = pos.shelf
        rack = shelf.rack
        warehouse = rack.warehouse
        location = f'{warehouse.code}/{rack.code}/{shelf.code}/{pos.code}'

        stock = None
        history = []
        if alloc.batch_id:
            b = alloc.batch
            stock = {
                'kind': 'BATCH',
                'id': b.id,
                'code': b.batch_code,
                'item_id': b.item_id,
                'item_code': b.item.item_code if b.item_id else None,
                'item_name': b.item.name if b.item_id else None,
                'uom': b.item.uom if b.item_id else None,
                'category': getattr(b.item.category, 'name', None) if b.item_id else None,
                'grn_id': b.grn_line.grn_id if b.grn_line_id else None,
                'grn_number': b.grn_line.grn.grn_number if b.grn_line_id else None,
                'received_at': b.received_at,
                'testing_status': b.testing_status,
                'available_qty': str(b.available_qty),
                'received_qty': str(b.received_qty),
                'withdrawn_qty': str(b.withdrawn_qty),
                'barcode_value': b.barcode.value if b.barcode_id else None,
            }
            tx_qs = InventoryTransaction.objects.filter(batch_id=b.id)
        elif alloc.unit_id:
            u = alloc.unit
            stock = {
                'kind': 'UNIT',
                'id': u.id,
                'code': u.unit_code,
                'item_id': u.item_id,
                'item_code': u.item.item_code if u.item_id else None,
                'item_name': u.item.name if u.item_id else None,
                'uom': u.item.uom if u.item_id else None,
                'category': getattr(u.item.category, 'name', None) if u.item_id else None,
                'grn_id': u.grn_line.grn_id if u.grn_line_id else None,
                'grn_number': u.grn_line.grn.grn_number if u.grn_line_id else None,
                'received_at': u.received_at,
                'testing_status': u.testing_status,
                'status': u.status,
                'barcode_value': u.barcode.value if u.barcode_id else None,
            }
            tx_qs = InventoryTransaction.objects.filter(unit_id=u.id)
        else:
            tx_qs = InventoryTransaction.objects.none()

        history = InventoryTransactionSerializer(
            tx_qs.select_related(
                'user',
                'from_position__shelf__rack__warehouse',
                'to_position__shelf__rack__warehouse',
                'withdrawal',
            )[:100],
            many=True,
        ).data

        return Response(
            {
                'allocation': {
                    'id': alloc.id,
                    'allocation_type': alloc.allocation_type,
                    'quantity': str(alloc.quantity) if alloc.quantity is not None else None,
                    'is_active': alloc.is_active,
                    'created_at': alloc.created_at,
                    'updated_at': alloc.updated_at,
                    'position_id': alloc.position_id,
                    'location': location,
                    'warehouse_code': warehouse.code,
                    'warehouse_name': warehouse.name,
                    'rack_id': rack.id,
                    'rack_code': rack.code,
                    'rack_name': rack.name,
                    'shelf_code': shelf.code,
                    'position_code': pos.code,
                },
                'stock': stock,
                'history': history,
            }
        )


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
