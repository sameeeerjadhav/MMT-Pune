import re

from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin, IsWarehouseStaff
from audit.idempotency import idempotent
from config.exceptions import ApiError
from inventory.models import StockAllocation
from inventory.serializers import StockAllocationSerializer
from warehouses.models import Floor, Rack, RackPosition, Warehouse
from warehouses.serializers import (
    CreateFloorSerializer,
    FloorLayoutSerializer,
    FloorSerializer,
    PlaceRackSerializer,
    RackCreateSerializer,
    RackLayoutSerializer,
    RackSerializer,
    RackTransferSerializer,
    WarehouseSerializer,
)
from warehouses.services import (
    allocate_stock,
    build_floor_map,
    create_floor,
    create_rack,
    deallocate_stock,
    place_rack_on_floor,
    transfer_stock,
    update_floor_layout,
    update_rack_layout,
)


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


def _id_param(request, name):
    value = (request.query_params.get(name) or '').strip()
    if not value:
        return None
    if not value.isdigit():
        raise ApiError('VALIDATION_ERROR', f'{name} must be a numeric id')
    return int(value)


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


class FloorListCreateView(generics.ListCreateAPIView):
    serializer_class = FloorSerializer

    def get_queryset(self):
        qs = Floor.objects.select_related('warehouse').filter(is_active=True).order_by(
            'warehouse_id', 'level', 'code'
        )
        warehouse_id = _id_param(self.request, 'warehouse')
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)
        return qs

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        ser = CreateFloorSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        floor = create_floor(**ser.validated_data)
        return Response(FloorSerializer(floor).data, status=status.HTTP_201_CREATED)


class FloorDetailView(generics.RetrieveAPIView):
    queryset = Floor.objects.select_related('warehouse').all()
    serializer_class = FloorSerializer


class FloorMapView(APIView):
    """Floor-level visualization: large racks on a row ? column grid with stock."""

    def get(self, request, pk):
        floor = get_object_or_404(Floor.objects.select_related('warehouse'), pk=pk)
        role = getattr(request.user, 'role_code', None)
        return Response(build_floor_map(floor, role=role))


class FloorLayoutView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def patch(self, request, pk):
        ser = FloorLayoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        floor = update_floor_layout(floor_id=pk, **ser.validated_data)
        return Response(FloorSerializer(floor).data)


class FloorPlaceRackView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def post(self, request, pk):
        ser = PlaceRackSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        rack = place_rack_on_floor(floor_id=pk, **ser.validated_data)
        return Response(RackSerializer(rack).data)


class RackListCreateView(generics.ListCreateAPIView):
    serializer_class = RackSerializer

    def get_queryset(self):
        qs = Rack.objects.select_related('warehouse', 'floor', 'barcode').prefetch_related(
            'shelves__positions'
        ).order_by('warehouse__code', 'code')
        q = self.request.query_params.get('q', '').strip()
        warehouse_id = _id_param(self.request, 'warehouse')
        floor_id = _id_param(self.request, 'floor')
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)
        if floor_id:
            qs = qs.filter(floor_id=floor_id)
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
            floor_id=data.get('floor_id') or data.get('floor'),
            row_index=data.get('row_index'),
            column_index=data.get('column_index'),
        )
        return Response(RackSerializer(rack).data, status=status.HTTP_201_CREATED)


class RackDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RackSerializer
    http_method_names = ['get', 'patch', 'put', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = Rack.objects.select_related('warehouse', 'floor', 'barcode').prefetch_related(
            'shelves__positions'
        )
        if self.request.method == 'GET' and not _is_lead(self.request.user):
            qs = qs.filter(is_active=True, warehouse__is_active=True)
        return qs

    def get_permissions(self):
        if self.request.method in ('PATCH', 'PUT', 'DELETE'):
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        rack = serializer.save()
        # Free the floor bay when a rack is deactivated so another rack can be placed.
        if was_active and not rack.is_active and (
            rack.row_index is not None or rack.column_index is not None or rack.floor_id
        ):
            rack.row_index = None
            rack.column_index = None
            rack.floor = None
            rack.save(update_fields=['row_index', 'column_index', 'floor', 'updated_at'])

    def perform_destroy(self, instance):
        _safe_delete(instance, f'rack {instance.code}')


class RackInventoryView(APIView):
    def get(self, request, pk):
        get_object_or_404(Rack, pk=pk)
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
        qs = Rack.objects.select_related('warehouse', 'floor', 'barcode').prefetch_related(
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

        role = getattr(request.user, 'role_code', None)
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
                    'row_count': len(rows),
                    'column_count': max((len(r['cells']) for r in rows), default=0),
                },
                'can_edit_layout': role in ('ADMIN', 'SUPERVISOR'),
                'viewer_role': role,
                'rows': rows,
            }
        )


class RackLayoutView(APIView):
    """Resize rack map: shelves (rows) × positions (columns). Admin/Supervisor only."""

    permission_classes = [IsSupervisorOrAdmin]

    def patch(self, request, pk):
        ser = RackLayoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        update_rack_layout(rack_id=pk, **ser.validated_data)
        # Return fresh map payload via the same shape as RackMapView.
        map_view = RackMapView()
        return map_view.get(request, pk)


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
                'warehouse_id': p.shelf.rack.warehouse_id,
                'warehouse': p.shelf.rack.warehouse.code,
                'warehouse_name': p.shelf.rack.warehouse.name,
                'rack_id': p.shelf.rack_id,
                'rack': p.shelf.rack.code,
                'rack_name': p.shelf.rack.name,
                'shelf': p.shelf.code,
                'position': p.code,
                'cell': f'{p.shelf.code}/{p.code}',
                'label': f'{p.shelf.rack.warehouse.code}/{p.shelf.rack.code}/{p.shelf.code}/{p.code}',
            }
            for p in positions.order_by(
                'shelf__rack__warehouse__code', 'shelf__rack__code', 'shelf__code', 'code'
            )
        ]
        return Response(data)


class AllocateView(APIView):
    permission_classes = [IsWarehouseStaff]

    @idempotent
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

    @idempotent
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
