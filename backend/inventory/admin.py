from django.contrib import admin

from inventory.models import (
    Category,
    InventoryBatch,
    InventoryTransaction,
    InventoryUnit,
    Item,
    StockAllocation,
    Vendor,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('code', 'name')
    search_fields = ('code', 'name')


@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'contact')
    search_fields = ('code', 'name')


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ('item_code', 'name', 'category', 'inventory_type', 'uom', 'is_active')
    list_filter = ('inventory_type', 'category')
    search_fields = ('item_code', 'name')


@admin.register(InventoryBatch)
class InventoryBatchAdmin(admin.ModelAdmin):
    list_display = (
        'batch_code',
        'item',
        'available_qty',
        'received_qty',
        'testing_status',
        'received_at',
    )
    list_filter = ('testing_status',)
    search_fields = ('batch_code', 'item__item_code')


@admin.register(InventoryUnit)
class InventoryUnitAdmin(admin.ModelAdmin):
    list_display = ('unit_code', 'item', 'status', 'testing_status', 'received_at')
    list_filter = ('status', 'testing_status')
    search_fields = ('unit_code', 'item__item_code')


@admin.register(StockAllocation)
class StockAllocationAdmin(admin.ModelAdmin):
    list_display = ('id', 'allocation_type', 'batch', 'unit', 'position', 'quantity', 'is_active')
    list_filter = ('allocation_type', 'is_active')


@admin.register(InventoryTransaction)
class InventoryTransactionAdmin(admin.ModelAdmin):
    list_display = ('id', 'type', 'batch', 'unit', 'quantity', 'purpose', 'user', 'created_at')
    list_filter = ('type', 'purpose')
    readonly_fields = (
        'type',
        'batch',
        'unit',
        'quantity',
        'purpose',
        'from_position',
        'to_position',
        'withdrawal',
        'transfer',
        'user',
        'override_reason',
        'notes',
        'metadata',
        'created_at',
    )

    def has_delete_permission(self, request, obj=None):
        return False
