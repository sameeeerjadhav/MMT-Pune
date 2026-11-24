from django.http import HttpResponse
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsSupervisorOrAdmin, IsWarehouseStaff
from barcodes.models import Barcode, Printer, PrintLog
from barcodes.printing import (
    ALLOWED_DPI,
    MAX_LABEL_MM,
    MIN_LABEL_MM,
    printer_payload,
    render_barcode_label_commands,
    render_test_label_commands,
)
from barcodes.services import (
    create_barcode,
    label_image_base64,
    render_label_pdf_bytes,
    render_label_png_bytes,
)
from config.exceptions import ApiError


class PrinterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Printer
        fields = [
            'id',
            'name',
            'language',
            'host',
            'port',
            'label_width_mm',
            'label_height_mm',
            'dpi',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_host(self, value):
        host = (value or '').strip()
        if not host or '/' in host or ' ' in host or host.startswith(('http://', 'https://')):
            raise serializers.ValidationError('Enter the printer IP address, e.g. 192.168.1.50')
        return host

    def validate_port(self, value):
        if not 1 <= value <= 65535:
            raise serializers.ValidationError('Port must be between 1 and 65535 (default 9100).')
        return value

    def validate_label_width_mm(self, value):
        return self._check_mm(value, 'Label width')

    def validate_label_height_mm(self, value):
        return self._check_mm(value, 'Label height')

    def _check_mm(self, value, label):
        if not MIN_LABEL_MM <= value <= MAX_LABEL_MM:
            raise serializers.ValidationError(f'{label} must be between {MIN_LABEL_MM} and {MAX_LABEL_MM} mm.')
        return value

    def validate_dpi(self, value):
        if value not in ALLOWED_DPI:
            raise serializers.ValidationError(f'DPI must be one of {", ".join(map(str, ALLOWED_DPI))}.')
        return value


class PrinterListCreateView(generics.ListCreateAPIView):
    """List configured label printers (any warehouse user); create (admin / supervisor)."""

    serializer_class = PrinterSerializer
    pagination_class = None

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsSupervisorOrAdmin()]
        return [IsWarehouseStaff()]

    def get_queryset(self):
        qs = Printer.objects.all()
        if self.request.query_params.get('active') in ('1', 'true', 'yes'):
            qs = qs.filter(is_active=True)
        return qs


class PrinterDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PrinterSerializer
    queryset = Printer.objects.all()

    def get_permissions(self):
        if self.request.method == 'GET':
            return [IsWarehouseStaff()]
        return [IsSupervisorOrAdmin()]


class PrinterTestLabelView(APIView):
    """Commands for a small test label, so the phone can check the Wi-Fi printer connection."""

    permission_classes = [IsWarehouseStaff]

    def get(self, request, pk):
        try:
            printer = Printer.objects.get(pk=pk)
        except Printer.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Printer not found', status_code=404)
        return Response(printer_payload(printer, render_test_label_commands(printer)))


class BarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Barcode
        fields = '__all__'


class GenerateBarcodeView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request):
        entity_type = request.data.get('entity_type')
        entity_id = request.data.get('entity_id')
        if entity_type not in ('BATCH', 'UNIT', 'RACK') or entity_id in (None, ''):
            raise ApiError('VALIDATION_ERROR', 'entity_type and entity_id required')
        try:
            entity_id_int = int(entity_id)
        except (TypeError, ValueError):
            raise ApiError('VALIDATION_ERROR', 'entity_id must be a positive integer')
        if entity_id_int <= 0:
            raise ApiError('VALIDATION_ERROR', 'entity_id must be a positive integer')
        existing = Barcode.objects.filter(entity_type=entity_type, entity_id=entity_id_int).first()
        if existing:
            return Response(BarcodeSerializer(existing).data)
        barcode = create_barcode(entity_type, entity_id_int, request.data.get('label_data') or {})
        return Response(BarcodeSerializer(barcode).data, status=status.HTTP_201_CREATED)


class BarcodeDetailView(APIView):
    def get(self, request, value):
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)
        data = BarcodeSerializer(barcode).data
        data['label_image_base64'] = label_image_base64(barcode)
        data['label_image_content_type'] = 'image/png'
        return Response(data)


class BarcodeLabelImageView(APIView):
    """Return a Code 128 warehouse label PNG."""

    def get(self, request, value):
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)
        png = render_label_png_bytes(barcode)
        response = HttpResponse(png, content_type='image/png')
        response['Content-Disposition'] = f'inline; filename="{barcode.value}.png"'
        return response


class BarcodeLabelPdfView(APIView):
    """Return a single-page PDF of the warehouse barcode label."""

    permission_classes = [IsWarehouseStaff]

    def get(self, request, value):
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)
        pdf = render_label_pdf_bytes(barcode)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{barcode.value}-label.pdf"'
        return response


class BarcodePrintCommandsView(APIView):
    """Raw ZPL/TSPL for a batch/unit label on a chosen printer (?printer_id=)."""

    permission_classes = [IsWarehouseStaff]

    def get(self, request, value):
        printer_id = request.query_params.get('printer_id')
        if not printer_id:
            raise ApiError('VALIDATION_ERROR', 'printer_id is required')
        try:
            printer = Printer.objects.get(pk=int(printer_id), is_active=True)
        except (ValueError, Printer.DoesNotExist):
            raise ApiError('NOT_FOUND', 'Active printer not found', status_code=404)
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)
        return Response(printer_payload(printer, render_barcode_label_commands(barcode, printer)))


class PrintLogView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request, value):
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)
        log = PrintLog.objects.create(
            barcode=barcode,
            user=request.user,
            printer=request.data.get('printer', ''),
            notes=request.data.get('notes', ''),
        )
        return Response({'id': log.id, 'created_at': log.created_at}, status=status.HTTP_201_CREATED)

