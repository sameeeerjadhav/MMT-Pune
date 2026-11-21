from rest_framework import serializers

from warehouses.models import Floor, Rack, RackPosition, RackTransfer, Shelf, Warehouse


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


class FloorSerializer(serializers.ModelSerializer):
    warehouse_code = serializers.CharField(source='warehouse.code', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)
    rack_count = serializers.SerializerMethodField()

    class Meta:
        model = Floor
        fields = '__all__'

    def get_rack_count(self, obj):
        return obj.racks.count()


class FloorLayoutSerializer(serializers.Serializer):
    row_count = serializers.IntegerField(min_value=1, max_value=50)
    column_count = serializers.IntegerField(min_value=1, max_value=50)


class PlaceRackSerializer(serializers.Serializer):
    rack_id = serializers.IntegerField()
    row_index = serializers.IntegerField(min_value=1)
    column_index = serializers.IntegerField(min_value=1)


class CreateFloorSerializer(serializers.Serializer):
    warehouse_id = serializers.IntegerField()
    code = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=150)
    level = serializers.IntegerField(required=False, default=1)
    row_count = serializers.IntegerField(min_value=1, max_value=50, required=False, default=4)
    column_count = serializers.IntegerField(min_value=1, max_value=50, required=False, default=5)
    description = serializers.CharField(required=False, allow_blank=True, default='')


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
    floor_code = serializers.CharField(source='floor.code', read_only=True, allow_null=True, required=False)
    barcode_value = serializers.CharField(
        source='barcode.value', read_only=True, allow_null=True, required=False
    )
    shelves = ShelfSerializer(many=True, read_only=True)

    class Meta:
        model = Rack
        fields = (
            'id',
            'warehouse',
            'warehouse_code',
            'floor',
            'floor_code',
            'row_index',
            'column_index',
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
            'floor_code',
            'shelves',
            'created_at',
            'updated_at',
        )


class RackTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = RackTransfer
        fields = '__all__'
