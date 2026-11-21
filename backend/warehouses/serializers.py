from rest_framework import serializers

from warehouses.models import Rack, RackPosition, RackTransfer, Shelf, Warehouse


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ('id', 'code', 'name', 'address', 'is_active', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')


class RackCreateSerializer(serializers.Serializer):
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.all())
    code = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    shelves = serializers.JSONField(required=False)


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
        fields = (
            'id',
            'warehouse',
            'warehouse_code',
            'code',
            'name',
            'barcode',
            'barcode_value',
            'shelves',
            'is_active',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'barcode',
            'barcode_value',
            'warehouse_code',
            'shelves',
            'created_at',
            'updated_at',
        )


class RackTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = RackTransfer
        fields = '__all__'
