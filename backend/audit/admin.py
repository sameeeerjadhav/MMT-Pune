from django.contrib import admin

from audit.models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'action', 'entity_type', 'entity_id', 'user', 'created_at')
    list_filter = ('action',)
    search_fields = ('entity_type', 'action')
    readonly_fields = ('user', 'action', 'entity_type', 'entity_id', 'details', 'ip_address', 'created_at')

    def has_delete_permission(self, request, obj=None):
        return False
