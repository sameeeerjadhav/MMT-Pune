from django.db.models import Q
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin, IsWarehouseStaff
from barcodes.models import Printer, PrintLog
from barcodes.printing import printer_payload, render_barcode_label_commands
from barcodes.services import create_barcode, label_payload
from config.exceptions import ApiError
from grn.models import GRN
from grn.serializers import GRNImportSerializer, GRNSerializer
from integrations.importers import MockIntegrationService, import_grn_payload
from inventory.models import InventoryBatch, InventoryUnit


class GRNListCreateView(generics.ListCreateAPIView):
    serializer_class = GRNSerializer

    def get_queryset(self):
        qs = GRN.objects.select_related('vendor').prefetch_related('lines__item').order_by('-received_date')
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(grn_number__icontains=q)
                | Q(external_ref__icontains=q)
                | Q(external_system__icontains=q)
                | Q(vendor__name__icontains=q)
                | Q(vendor__code__icontains=q)
                | Q(status__icontains=q)
            )
        return qs

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


# Keep each response (and each TCP write from the phone) a manageable size.
BULK_PRINT_DEFAULT_LIMIT = 50
BULK_PRINT_MAX_LIMIT = 100


def _grn_label_barcodes(grn):
    """Barcodes of every batch/unit received on this GRN, plus how many still have none."""
    barcodes, missing = [], 0
    for line in grn.lines.all():
        for stock in list(line.batches.all()) + list(line.units.all()):
            if stock.barcode_id:
                barcodes.append(stock.barcode)
            else:
                missing += 1
    return barcodes, missing


def _int_query(request, name, default, minimum, maximum):
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return default
    try:
        return max(minimum, min(maximum, int(raw)))
    except ValueError:
        raise ApiError('VALIDATION_ERROR', f'{name} must be a whole number')


class GRNPrintCommandsView(APIView):
    """
    Printer commands for the labels on a GRN, in pages (?limit=&offset=).

    The phone requests one page at a time and sends it to the printer, so a GRN with hundreds
    of units never needs one huge request.
    """

    permission_classes = [IsWarehouseStaff]

    def get(self, request, pk):
        printer_id = request.query_params.get('printer_id')
        if not printer_id:
            raise ApiError('VALIDATION_ERROR', 'printer_id is required')
        try:
            printer = Printer.objects.get(pk=int(printer_id), is_active=True)
        except (ValueError, Printer.DoesNotExist):
            raise ApiError('NOT_FOUND', 'Active printer not found', status_code=404)
        try:
            grn = GRN.objects.prefetch_related(
                'lines__batches__barcode', 'lines__units__barcode'
            ).get(pk=pk)
        except GRN.DoesNotExist:
            raise ApiError('NOT_FOUND', 'GRN not found', status_code=404)

        limit = _int_query(request, 'limit', BULK_PRINT_DEFAULT_LIMIT, 1, BULK_PRINT_MAX_LIMIT)
        offset = _int_query(request, 'offset', 0, 0, 10**9)
        barcodes, missing = _grn_label_barcodes(grn)
        page = barcodes[offset : offset + limit]
        commands = ''.join(render_barcode_label_commands(b, printer) for b in page)
        next_offset = offset + limit if offset + limit < len(barcodes) else None
        return Response(
            printer_payload(
                printer,
                commands,
                grn_number=grn.grn_number,
                total=len(barcodes),
                offset=offset,
                count=len(page),
                next_offset=next_offset,
                missing_barcodes=missing,
                barcode_values=[b.value for b in page],
            )
        )


class GRNPrintLogView(APIView):
    """Record that a page of this GRN's labels was printed (one PrintLog per label)."""

    permission_classes = [IsWarehouseStaff]

    def post(self, request, pk):
        try:
            grn = GRN.objects.prefetch_related(
                'lines__batches__barcode', 'lines__units__barcode'
            ).get(pk=pk)
        except GRN.DoesNotExist:
            raise ApiError('NOT_FOUND', 'GRN not found', status_code=404)
        values = request.data.get('values')
        if not isinstance(values, list) or not values or not all(isinstance(v, str) for v in values):
            raise ApiError('VALIDATION_ERROR', 'values must be a non-empty list of barcode values')
        allowed = {b.value: b for b in _grn_label_barcodes(grn)[0]}
        unknown = [v for v in values if v not in allowed]
        if unknown:
            raise ApiError('VALIDATION_ERROR', f'Barcode not on this GRN: {unknown[0]}')
        printer_name = str(request.data.get('printer', ''))[:100]
        PrintLog.objects.bulk_create(
            [
                PrintLog(
                    barcode=allowed[v],
                    user=request.user,
                    printer=printer_name,
                    notes=f'bulk print for {grn.grn_number}',
                )
                for v in values
            ]
        )
        return Response({'logged': len(values)}, status=status.HTTP_201_CREATED)
