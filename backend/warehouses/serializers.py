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
    floor_id = serializers.IntegerField(required=False, allow_null=True)
    floor = serializers.IntegerField(required=False, allow_null=True)
    row_index = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    column_index = serializers.IntegerField(required=False, allow_null=True, min_value=1)


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


class RackLayoutSerializer(serializers.Serializer):
    """Rows = shelves, columns = positions on the rack map."""

    row_count = serializers.IntegerField(min_value=1, max_value=26)
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
        # Placement changes go through create / place-rack so floor rules are enforced.
        read_only_fields = (
            'id',
            'warehouse',
            'floor',
            'row_index',
            'column_index',
            'barcode',
            'barcode_value',
            'warehouse_code',
            'floor_code',
            'shelves',
            'created_at',
            'updated_at',
        )

    def validate_code(self, value):
        code = value.strip()
        rack = self.instance
        if rack is not None and (
            Rack.objects.filter(warehouse_id=rack.warehouse_id, code__iexact=code)
            .exclude(pk=rack.pk)
            .exists()
        ):
            raise serializers.ValidationError('A rack with this code already exists in this warehouse')
        return code


class RackTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = RackTransfer
        fields = '__all__'
