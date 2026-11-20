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

    class Meta:
        model = Item
        fields = '__all__'


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


class InventoryTransactionSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)

    class Meta:
        model = InventoryTransaction
        fields = '__all__'
