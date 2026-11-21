from django.contrib import admin

from warehouses.models import Floor, Rack, RackPosition, RackTransfer, Shelf, Warehouse


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'is_active', 'created_at')
    search_fields = ('code', 'name')


@admin.register(Floor)
class FloorAdmin(admin.ModelAdmin):
    list_display = (
        'code',
        'name',
        'warehouse',
        'level',
        'row_count',
        'column_count',
        'is_active',
    )
    list_filter = ('warehouse', 'is_active')
    search_fields = ('code', 'name', 'warehouse__code')


class ShelfInline(admin.TabularInline):
    model = Shelf
    extra = 0


@admin.register(Rack)
class RackAdmin(admin.ModelAdmin):
    list_display = (
        'code',
        'name',
        'warehouse',
        'floor',
        'row_index',
        'column_index',
        'barcode',
        'is_active',
    )
    list_filter = ('warehouse', 'floor')
    search_fields = ('code', 'name')
    inlines = [ShelfInline]


class PositionInline(admin.TabularInline):
    model = RackPosition
    extra = 0


@admin.register(Shelf)
class ShelfAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'rack')
    list_filter = ('rack__warehouse',)
    inlines = [PositionInline]


@admin.register(RackPosition)
class RackPositionAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'shelf')
    list_filter = ('shelf__rack__warehouse',)


@admin.register(RackTransfer)
class RackTransferAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'from_position',
        'to_position',
        'batch',
        'unit',
        'quantity',
        'user',
        'created_at',
    )
    list_filter = ('created_at',)
