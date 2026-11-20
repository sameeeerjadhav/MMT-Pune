from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.has_role('ADMIN'))


class IsSupervisorOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.has_role('ADMIN', 'SUPERVISOR')
        )


class IsWarehouseStaff(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.has_role('ADMIN', 'SUPERVISOR', 'WAREHOUSE_EMPLOYEE')
        )
