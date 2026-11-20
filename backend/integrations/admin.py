from django.contrib import admin

from integrations.models import IntegrationLog


@admin.register(IntegrationLog)
class IntegrationLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'source', 'system', 'status', 'grn', 'created_at')
    list_filter = ('source', 'system', 'status')
    search_fields = ('message',)
    readonly_fields = ('source', 'system', 'status', 'grn', 'payload', 'message', 'created_at')
