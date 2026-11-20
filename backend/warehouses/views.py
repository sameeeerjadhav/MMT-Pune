from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin, IsWarehouseStaff
from inventory.models import StockAllocation
from inventory.serializers import StockAllocationSerializer
from warehouses.models import Rack, RackPosition, Warehouse
from warehouses.serializers import RackSerializer, RackTransferSerializer, WarehouseSerializer
from warehouses.services import allocate_stock, create_rack, transfer_stock


class WarehouseListCreateView(generics.ListCreateAPIView):
    queryset = Warehouse.objects.all().order_by('code')
    serializer_class = WarehouseSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()


class RackListCreateView(generics.ListCreateAPIView):
    queryset = Rack.objects.select_related('warehouse', 'barcode').prefetch_related(
        'shelves__positions'
    )
    serializer_class = RackSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        rack = create_rack(
            warehouse_id=request.data['warehouse'],
            code=request.data['code'],
            name=request.data.get('name') or request.data['code'],
            shelves=request.data.get('shelves'),
        )
        return Response(RackSerializer(rack).data, status=status.HTTP_201_CREATED)


class RackDetailView(generics.RetrieveAPIView):
    queryset = Rack.objects.select_related('warehouse', 'barcode').prefetch_related(
        'shelves__positions'
    )
    serializer_class = RackSerializer


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
            data.append(row)
        return Response(data)


class LocationListView(APIView):
    def get(self, request):
        positions = RackPosition.objects.select_related('shelf__rack__warehouse').all()
        data = [
            {
                'id': p.id,
                'warehouse': p.shelf.rack.warehouse.code,
                'rack': p.shelf.rack.code,
                'shelf': p.shelf.code,
                'position': p.code,
                'label': f'{p.shelf.rack.warehouse.code}/{p.shelf.rack.code}/{p.shelf.code}/{p.code}',
            }
            for p in positions
        ]
        return Response(data)


class AllocateView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request):
        allocation = allocate_stock(
            position_id=request.data['position_id'],
            user=request.user,
            batch_id=request.data.get('batch_id'),
            unit_id=request.data.get('unit_id'),
            quantity=request.data.get('quantity'),
            allocation_type=request.data.get('allocation_type', 'ACTUAL'),
        )
        return Response(StockAllocationSerializer(allocation).data, status=status.HTTP_201_CREATED)


class TransferView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request):
        transfer = transfer_stock(
            from_position_id=request.data['from_position_id'],
            to_position_id=request.data['to_position_id'],
            user=request.user,
            batch_id=request.data.get('batch_id'),
            unit_id=request.data.get('unit_id'),
            quantity=request.data.get('quantity'),
            reason=request.data.get('reason', ''),
        )
        return Response(RackTransferSerializer(transfer).data, status=status.HTTP_201_CREATED)
