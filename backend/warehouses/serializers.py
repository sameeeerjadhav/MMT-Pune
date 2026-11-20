from rest_framework import serializers

from warehouses.models import Rack, RackPosition, RackTransfer, Shelf, Warehouse


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = '__all__'


class RackPositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RackPosition
        fields = '__all__'


class ShelfSerializer(serializers.ModelSerializer):
    positions = RackPositionSerializer(many=True, read_only=True)

    class Meta:
        model = Shelf
        fields = '__all__'


class RackSerializer(serializers.ModelSerializer):
    warehouse_code = serializers.CharField(source='warehouse.code', read_only=True)
    barcode_value = serializers.CharField(source='barcode.value', read_only=True)
    shelves = ShelfSerializer(many=True, read_only=True)

    class Meta:
        model = Rack
        fields = '__all__'


class RackTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = RackTransfer
        fields = '__all__'
