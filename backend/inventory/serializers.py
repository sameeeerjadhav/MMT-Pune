from rest_framework import serializers

from inventory.models import (
    Category,
    InventoryBatch,
    InventoryTransaction,
    InventoryUnit,
    Item,
    StockAllocation,
    Vendor,
)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = '__all__'


class VendorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vendor
        fields = '__all__'


class ItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    category_code = serializers.CharField(source='category.code', read_only=True)
    image_url = serializers.SerializerMethodField()
    # Optional: create/update can pass category_code to get_or_create category
    category_code_input = serializers.CharField(write_only=True, required=False, allow_blank=True)
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = Item
        fields = (
            'id',
            'item_code',
            'name',
            'description',
            'category',
            'category_name',
            'category_code',
            'category_code_input',
            'inventory_type',
            'uom',
            'image',
            'image_url',
            'is_active',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('image',)

    def get_image_url(self, obj):
        from inventory.media_urls import absolute_media_url

        return absolute_media_url(self.context.get('request'), obj.image)

    def _resolve_category(self, validated_data):
        code_input = validated_data.pop('category_code_input', None)
        if code_input:
            code = code_input.strip().upper()
            cat, _ = Category.objects.get_or_create(
                code=code, defaults={'name': code.replace('-', ' ').title()}
            )
            validated_data['category'] = cat
        return validated_data

    def create(self, validated_data):
        validated_data = self._resolve_category(validated_data)
        if 'category' not in validated_data:
            raise serializers.ValidationError({'category': 'category or category_code_input is required'})
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data = self._resolve_category(validated_data)
        return super().update(instance, validated_data)


class TestingStatusSerializer(serializers.Serializer):
    testing_status = serializers.ChoiceField(choices=['PENDING', 'PASSED', 'FAILED'])


class StockAllocationSerializer(serializers.ModelSerializer):
    warehouse = serializers.CharField(source='position.shelf.rack.warehouse.code', read_only=True)
    rack = serializers.CharField(source='position.shelf.rack.code', read_only=True)
    shelf = serializers.CharField(source='position.shelf.code', read_only=True)
    position_code = serializers.CharField(source='position.code', read_only=True)

    class Meta:
        model = StockAllocation
        fields = (
            'id',
            'allocation_type',
            'batch',
            'unit',
            'position',
            'quantity',
            'is_active',
            'warehouse',
            'rack',
            'shelf',
            'position_code',
        )


class ItemListSerializer(serializers.ModelSerializer):
    """Lean item payload for inventory search/list rows."""

    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = (
            'id',
            'item_code',
            'name',
            'inventory_type',
            'uom',
            'image_url',
            'updated_at',
            'is_active',
        )

    def get_image_url(self, obj):
        from inventory.media_urls import absolute_media_url

        return absolute_media_url(self.context.get('request'), obj.image)


class InventoryBatchSerializer(serializers.ModelSerializer):
    item = ItemSerializer(read_only=True)
    barcode_value = serializers.CharField(source='barcode.value', read_only=True)
    barcode_label_data = serializers.JSONField(source='barcode.label_data', read_only=True)
    allocations = StockAllocationSerializer(many=True, read_only=True)
    grn_number = serializers.CharField(source='grn_line.grn.grn_number', read_only=True)

    class Meta:
        model = InventoryBatch
        fields = '__all__'


class InventoryUnitSerializer(serializers.ModelSerializer):
    item = ItemSerializer(read_only=True)
    barcode_value = serializers.CharField(source='barcode.value', read_only=True)
    barcode_label_data = serializers.JSONField(source='barcode.label_data', read_only=True)
    allocations = StockAllocationSerializer(many=True, read_only=True)
    grn_number = serializers.CharField(source='grn_line.grn.grn_number', read_only=True)

    class Meta:
        model = InventoryUnit
        fields = '__all__'


class InventoryBatchListSerializer(serializers.ModelSerializer):
    """Fast list/search row — no nested allocations or label blobs."""

    item = ItemListSerializer(read_only=True)
    barcode_value = serializers.CharField(source='barcode.value', read_only=True)
    grn_number = serializers.CharField(source='grn_line.grn.grn_number', read_only=True)

    class Meta:
        model = InventoryBatch
        fields = (
            'id',
            'batch_code',
            'item',
            'received_qty',
            'available_qty',
            'withdrawn_qty',
            'reserved_qty',
            'testing_status',
            'received_at',
            'barcode_value',
            'grn_number',
        )


class InventoryUnitListSerializer(serializers.ModelSerializer):
    item = ItemListSerializer(read_only=True)
    barcode_value = serializers.CharField(source='barcode.value', read_only=True)
    grn_number = serializers.CharField(source='grn_line.grn.grn_number', read_only=True)

    class Meta:
        model = InventoryUnit
        fields = (
            'id',
            'unit_code',
            'item',
            'status',
            'testing_status',
            'received_at',
            'barcode_value',
            'grn_number',
        )


def _position_label(position) -> str | None:
    if position is None:
        return None
    try:
        shelf = position.shelf
        rack = shelf.rack
        warehouse = rack.warehouse
        return f'{warehouse.code}/{rack.code}/{shelf.code}/{position.code}'
    except Exception:
        return None


class InventoryTransactionSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    from_location = serializers.SerializerMethodField()
    to_location = serializers.SerializerMethodField()
    display_type = serializers.SerializerMethodField()

    class Meta:
        model = InventoryTransaction
        fields = (
            'id',
            'type',
            'display_type',
            'batch',
            'unit',
            'quantity',
            'purpose',
            'from_position',
            'to_position',
            'from_location',
            'to_location',
            'withdrawal',
            'transfer',
            'user',
            'user_name',
            'notes',
            'override_reason',
            'metadata',
            'created_at',
        )

    def get_user_name(self, obj):
        user = obj.user
        if not user:
            return None
        name = (user.get_full_name() or '').strip()
        return name or getattr(user, 'username', None)

    def get_from_location(self, obj):
        return _position_label(obj.from_position)

    def get_to_location(self, obj):
        return _position_label(obj.to_position)

    def get_display_type(self, obj):
        meta = obj.metadata or {}
        if obj.type == InventoryTransaction.Type.ADJUST and meta.get('action') == 'DEALLOCATE':
            return 'DEALLOCATE'
        return obj.type
