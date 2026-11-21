from django.http import HttpResponse
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsWarehouseStaff
from barcodes.models import Barcode, PrintLog
from barcodes.services import create_barcode, label_image_base64, render_label_png_bytes
from config.exceptions import ApiError


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
