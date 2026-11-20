from django.contrib import admin

from grn.models import GRN, GRNLine


class GRNLineInline(admin.TabularInline):
    model = GRNLine
    extra = 0


@admin.register(GRN)
class GRNAdmin(admin.ModelAdmin):
    list_display = ('grn_number', 'external_system', 'vendor', 'received_date', 'status')
    list_filter = ('external_system', 'status')
    search_fields = ('grn_number', 'external_ref')
    inlines = [GRNLineInline]


@admin.register(GRNLine)
class GRNLineAdmin(admin.ModelAdmin):
    list_display = ('grn', 'item', 'received_qty', 'uom', 'classification', 'testing_status')
    list_filter = ('classification', 'testing_status')
