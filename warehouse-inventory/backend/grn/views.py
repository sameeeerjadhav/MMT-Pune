from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin
from barcodes.services import create_barcode, label_payload
from grn.models import GRN
from grn.serializers import GRNImportSerializer, GRNSerializer
from integrations.importers import MockIntegrationService, import_grn_payload
from inventory.models import InventoryBatch, InventoryUnit


class GRNListCreateView(generics.ListCreateAPIView):
    queryset = GRN.objects.select_related('vendor').prefetch_related('lines__item').order_by('-received_date')
    serializer_class = GRNSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return super().get_permissions()

    def create(self, request, *args, **kwargs):
        serializer = GRNImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        data['external_system'] = data.get('external_system') or 'MANUAL'
        grn = import_grn_payload(data, source='MOCK', system=data['external_system'])
        return Response(GRNSerializer(grn).data, status=status.HTTP_201_CREATED)


class GRNDetailView(generics.RetrieveAPIView):
    queryset = GRN.objects.select_related('vendor').prefetch_related(
        'lines__item', 'lines__batches__barcode', 'lines__units__barcode', 'integration_logs'
    )
    serializer_class = GRNSerializer


class GRNImportView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def post(self, request):
        serializer = GRNImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        grn = MockIntegrationService().import_grn(serializer.validated_data)
        return Response(GRNSerializer(GRN.objects.get(pk=grn.pk)).data, status=status.HTTP_201_CREATED)


class GRNGenerateBarcodesView(APIView):
    permission_classes = [IsSupervisorOrAdmin]

    def post(self, request, pk):
        grn = GRN.objects.prefetch_related('lines__batches', 'lines__units', 'lines__item').get(pk=pk)
        created = 0
        for line in grn.lines.all():
            for batch in line.batches.filter(barcode__isnull=True):
                batch.barcode = create_barcode(
                    'BATCH',
                    batch.id,
                    label_payload(
                        item_name=line.item.name,
                        item_code=line.item.item_code,
                        grn_number=grn.grn_number,
                        batch_or_unit=batch.batch_code,
                        quantity=batch.received_qty,
                    ),
                )
                batch.save(update_fields=['barcode'])
                created += 1
            for unit in line.units.filter(barcode__isnull=True):
                unit.barcode = create_barcode(
                    'UNIT',
                    unit.id,
                    label_payload(
                        item_name=line.item.name,
                        item_code=line.item.item_code,
                        grn_number=grn.grn_number,
                        batch_or_unit=unit.unit_code,
                        quantity=1,
                    ),
                )
                unit.save(update_fields=['barcode'])
                created += 1
        return Response({'created': created, 'grn': GRNSerializer(grn).data})
