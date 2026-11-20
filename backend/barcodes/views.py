from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import serializers

from barcodes.models import Barcode, PrintLog
from barcodes.services import create_barcode
from config.exceptions import ApiError


class BarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Barcode
        fields = '__all__'


class GenerateBarcodeView(APIView):
    def post(self, request):
        entity_type = request.data.get('entity_type')
        entity_id = request.data.get('entity_id')
        if entity_type not in ('BATCH', 'UNIT', 'RACK') or not entity_id:
            raise ApiError('VALIDATION_ERROR', 'entity_type and entity_id required')
        existing = Barcode.objects.filter(entity_type=entity_type, entity_id=entity_id).first()
        if existing:
            return Response(BarcodeSerializer(existing).data)
        barcode = create_barcode(entity_type, int(entity_id), request.data.get('label_data') or {})
        return Response(BarcodeSerializer(barcode).data, status=status.HTTP_201_CREATED)


class BarcodeDetailView(APIView):
    def get(self, request, value):
        try:
            barcode = Barcode.objects.get(value=value)
        except Barcode.DoesNotExist:
            raise ApiError('NOT_FOUND', 'Barcode not found', status_code=404)
        return Response(BarcodeSerializer(barcode).data)


class PrintLogView(APIView):
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
