from rest_framework import serializers

from grn.models import GRN, GRNLine
from inventory.serializers import ItemSerializer, InventoryBatchSerializer, InventoryUnitSerializer


class GRNLineSerializer(serializers.ModelSerializer):
    item = ItemSerializer(read_only=True)
    batches = InventoryBatchSerializer(many=True, read_only=True)
    units = InventoryUnitSerializer(many=True, read_only=True)

    class Meta:
        model = GRNLine
        fields = '__all__'


class GRNSerializer(serializers.ModelSerializer):
    vendor_name = serializers.CharField(source='vendor.name', read_only=True)
    lines = GRNLineSerializer(many=True, read_only=True)
    line_count = serializers.IntegerField(source='lines.count', read_only=True)

    class Meta:
        model = GRN
        fields = '__all__'


class GRNImportSerializer(serializers.Serializer):
    grn_number = serializers.CharField()
    external_system = serializers.ChoiceField(
        choices=['M1', 'WORKROOM', 'MANUAL', 'MOCK'], default='MOCK'
    )
    external_ref = serializers.CharField(required=False, allow_blank=True)
    vendor_code = serializers.CharField(required=False, allow_blank=True)
    vendor_name = serializers.CharField(required=False, allow_blank=True)
    received_date = serializers.CharField()
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = serializers.ListField(child=serializers.DictField(), min_length=1)
