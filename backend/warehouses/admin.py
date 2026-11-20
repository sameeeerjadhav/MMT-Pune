from django.contrib import admin

from warehouses.models import Rack, RackPosition, RackTransfer, Shelf, Warehouse


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'is_active', 'created_at')
    search_fields = ('code', 'name')


class ShelfInline(admin.TabularInline):
    model = Shelf
    extra = 0


@admin.register(Rack)
class RackAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'warehouse', 'barcode', 'is_active')
    list_filter = ('warehouse',)
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
    list_display = ('id', 'from_position', 'to_position', 'batch', 'unit', 'quantity', 'user', 'created_at')
    list_filter = ('created_at',)
