from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from accounts.models import Role, User


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('code', 'name')


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ('username', 'email', 'role', 'employee_id', 'is_active')
    fieldsets = DjangoUserAdmin.fieldsets + (
        ('Warehouse', {'fields': ('role', 'employee_id')}),
    )
