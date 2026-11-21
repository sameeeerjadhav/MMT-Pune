import re

from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin, IsWarehouseStaff
from config.exceptions import ApiError
from inventory.models import StockAllocation
from inventory.serializers import StockAllocationSerializer
from warehouses.models import Rack, RackPosition, Warehouse
from warehouses.serializers import (
    RackCreateSerializer,
    RackSerializer,
    RackTransferSerializer,
    WarehouseSerializer,
)
from warehouses.services import allocate_stock, create_rack, deallocate_stock, transfer_stock


def _safe_delete(instance, label: str):
    try:
        instance.delete()
    except ProtectedError:
        raise ApiError(
            'CONFLICT',
            f'Cannot delete {label}: still referenced by stock allocations or history. '
            'Deactivate it or clear related stock first.',
            status_code=409,
        )


def _natural_key(value: str):
    """Sort key so '2' comes before '10'."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', value or '')]


def _is_lead(user) -> bool:
    return bool(user and user.is_authenticated and user.has_role('ADMIN', 'SUPERVISOR'))


def _include_inactive(request) -> bool:
    flag = request.query_params.get('include_inactive', '').lower() in ('1', 'true', 'yes')
    if not flag:
        return False
    return _is_lead(request.user)


class WarehouseListCreateView(generics.ListCreateAPIView):
    serializer_class = WarehouseSerializer

    def get_queryset(self):
        qs = Warehouse.objects.all().order_by('code')
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q) | Q(address__icontains=q))
        if not _include_inactive(self.request):
            qs = qs.filter(is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()


class WarehouseDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = WarehouseSerializer
    http_method_names = ['get', 'patch', 'put', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = Warehouse.objects.all()
        # Employees cannot retrieve inactive warehouses by ID.
        if self.request.method == 'GET' and not _is_lead(self.request.user):
            qs = qs.filter(is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method in ('PATCH', 'PUT', 'DELETE'):
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def perform_destroy(self, instance):
        _safe_delete(instance, f'warehouse {instance.code}')


class RackListCreateView(generics.ListCreateAPIView):
    serializer_class = RackSerializer

    def get_queryset(self):
        qs = Rack.objects.select_related('warehouse', 'barcode').prefetch_related(
            'shelves__positions'
        ).order_by('warehouse__code', 'code')
        q = self.request.query_params.get('q', '').strip()
        warehouse_id = self.request.query_params.get('warehouse')
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)
        if q:
            qs = qs.filter(
                Q(code__icontains=q)
                | Q(name__icontains=q)
                | Q(warehouse__code__icontains=q)
                | Q(warehouse__name__icontains=q)
                | Q(barcode__value__icontains=q)
            )
        if not _include_inactive(self.request):
            qs = qs.filter(is_active=True, warehouse__is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        ser = RackCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        rack = create_rack(
            warehouse_id=data['warehouse'].id,
            code=data['code'],
            name=(data.get('name') or data['code']),
            shelves=data.get('shelves'),
        )
        return Response(RackSerializer(rack).data, status=status.HTTP_201_CREATED)


class RackDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RackSerializer
    http_method_names = ['get', 'patch', 'put', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = Rack.objects.select_related('warehouse', 'barcode').prefetch_related(
            'shelves__positions'
        )
        if self.request.method == 'GET' and not _is_lead(self.request.user):
            qs = qs.filter(is_active=True, warehouse__is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method in ('PATCH', 'PUT', 'DELETE'):
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def perform_destroy(self, instance):
        _safe_delete(instance, f'rack {instance.code}')


class RackInventoryView(APIView):
    def get(self, request, pk):
        allocations = StockAllocation.objects.filter(
            is_active=True,
            allocation_type='ACTUAL',
            position__shelf__rack_id=pk,
        ).select_related(
            'batch',
            'batch__item',
            'unit',
            'unit__item',
            'position__shelf__rack__warehouse',
        )
        data = []
        for a in allocations:
            row = StockAllocationSerializer(a).data
            row['batch_code'] = a.batch.batch_code if a.batch_id else None
            row['unit_code'] = a.unit.unit_code if a.unit_id else None
            row['item_name'] = (
                a.batch.item.name if a.batch_id else a.unit.item.name if a.unit_id else None
            )
            row['item_code'] = (
                a.batch.item.item_code
                if a.batch_id
                else a.unit.item.item_code
                if a.unit_id
                else None
            )
            data.append(row)
        return Response(data)


class RackMapView(APIView):
    """Visual layout: shelves as rows, positions as columns, with stock per cell."""

    def get(self, request, pk):
        qs = Rack.objects.select_related('warehouse', 'barcode').prefetch_related(
            'shelves__positions'
        )
        if not _is_lead(request.user):
            qs = qs.filter(is_active=True, warehouse__is_active=True)
        rack = get_object_or_404(qs, pk=pk)
        allocations = (
            StockAllocation.objects.filter(
                is_active=True,
                allocation_type='ACTUAL',
                position__shelf__rack_id=pk,
            )
            .select_related('batch__item', 'unit__item', 'position')
            .order_by('id')
        )
        by_position: dict[int, list] = {}
        for a in allocations:
            by_position.setdefault(a.position_id, []).append(
                {
                    'allocation_id': a.id,
                    'batch_id': a.batch_id,
                    'unit_id': a.unit_id,
                    'batch_code': a.batch.batch_code if a.batch_id else None,
                    'unit_code': a.unit.unit_code if a.unit_id else None,
                    'item_name': (
                        a.batch.item.name
                        if a.batch_id
                        else a.unit.item.name
                        if a.unit_id
                        else None
                    ),
                    'item_code': (
                        a.batch.item.item_code
                        if a.batch_id
                        else a.unit.item.item_code
                        if a.unit_id
                        else None
                    ),
                    'quantity': str(a.quantity) if a.quantity is not None else None,
                }
            )

        rows = []
        total_cells = 0
        occupied_cells = 0
        shelves = sorted(rack.shelves.all(), key=lambda s: _natural_key(s.code))
        for shelf in shelves:
            cells = []
            positions = sorted(shelf.positions.all(), key=lambda p: _natural_key(p.code))
            for pos in positions:
                stock = by_position.get(pos.id, [])
                total_cells += 1
                if stock:
                    occupied_cells += 1
                cells.append(
                    {
                        'position_id': pos.id,
                        'position_code': pos.code,
                        'position_name': pos.name,
                        'occupied': bool(stock),
                        'stock_count': len(stock),
                        'stock': stock,
                    }
                )
            rows.append(
                {
                    'shelf_id': shelf.id,
                    'shelf_code': shelf.code,
                    'shelf_name': shelf.name or shelf.code,
                    'cells': cells,
                }
            )

        return Response(
            {
                'rack': {
                    'id': rack.id,
                    'code': rack.code,
                    'name': rack.name,
                    'warehouse_id': rack.warehouse_id,
                    'warehouse_code': rack.warehouse.code,
                    'warehouse_name': rack.warehouse.name,
                    'barcode_value': rack.barcode.value if rack.barcode_id else None,
                    'is_active': rack.is_active,
                },
                'summary': {
                    'shelves': len(rows),
                    'cells': total_cells,
                    'occupied': occupied_cells,
                    'empty': total_cells - occupied_cells,
                },
                'rows': rows,
            }
        )


class LocationListView(APIView):
    def get(self, request):
        positions = RackPosition.objects.select_related('shelf__rack__warehouse').filter(
            shelf__rack__is_active=True,
            shelf__rack__warehouse__is_active=True,
        )
        q = request.query_params.get('q', '').strip()
        if q:
            positions = positions.filter(
                Q(code__icontains=q)
                | Q(shelf__code__icontains=q)
                | Q(shelf__rack__code__icontains=q)
                | Q(shelf__rack__warehouse__code__icontains=q)
                | Q(shelf__rack__name__icontains=q)
            )
        data = [
            {
                'id': p.id,
                'warehouse': p.shelf.rack.warehouse.code,
                'rack': p.shelf.rack.code,
                'shelf': p.shelf.code,
                'position': p.code,
                'label': f'{p.shelf.rack.warehouse.code}/{p.shelf.rack.code}/{p.shelf.code}/{p.code}',
            }
            for p in positions.order_by(
                'shelf__rack__warehouse__code', 'shelf__rack__code', 'shelf__code', 'code'
            )
        ]
        return Response(data)


class AllocateView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request):
        position_id = request.data.get('position_id')
        if not position_id:
            raise ApiError('VALIDATION_ERROR', 'position_id is required')
        allocation = allocate_stock(
            position_id=position_id,
            user=request.user,
            batch_id=request.data.get('batch_id'),
            unit_id=request.data.get('unit_id'),
            quantity=request.data.get('quantity'),
            allocation_type=request.data.get('allocation_type', 'ACTUAL'),
        )
        return Response(StockAllocationSerializer(allocation).data, status=status.HTTP_201_CREATED)


class DeallocateView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def post(self, request):
        allocation_id = request.data.get('allocation_id')
        if not allocation_id:
            raise ApiError('VALIDATION_ERROR', 'allocation_id is required')
        alloc = deallocate_stock(
            allocation_id=allocation_id,
            user=request.user,
            reason=request.data.get('reason', ''),
        )
        return Response(StockAllocationSerializer(alloc).data)


class TransferView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request):
        from_position_id = request.data.get('from_position_id')
        to_position_id = request.data.get('to_position_id')
        if not from_position_id or not to_position_id:
            raise ApiError('VALIDATION_ERROR', 'from_position_id and to_position_id are required')
        transfer = transfer_stock(
            from_position_id=from_position_id,
            to_position_id=to_position_id,
            user=request.user,
            batch_id=request.data.get('batch_id'),
            unit_id=request.data.get('unit_id'),
            quantity=request.data.get('quantity'),
            reason=request.data.get('reason', ''),
        )
        return Response(RackTransferSerializer(transfer).data, status=status.HTTP_201_CREATED)
