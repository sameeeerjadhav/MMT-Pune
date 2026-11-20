from django.contrib import admin

from barcodes.models import Barcode, PrintLog


@admin.register(Barcode)
class BarcodeAdmin(admin.ModelAdmin):
    list_display = ('value', 'entity_type', 'entity_id', 'created_at')
    search_fields = ('value',)
    list_filter = ('entity_type',)


@admin.register(PrintLog)
class PrintLogAdmin(admin.ModelAdmin):
    list_display = ('barcode', 'user', 'printer', 'created_at')
    search_fields = ('barcode__value',)
