from django.contrib.auth.models import AbstractUser, UserManager as DjangoUserManager
from django.db import models


class Role(models.Model):
    class Code(models.TextChoices):
        ADMIN = 'ADMIN', 'Administrator'
        SUPERVISOR = 'SUPERVISOR', 'Supervisor'
        WAREHOUSE_EMPLOYEE = 'WAREHOUSE_EMPLOYEE', 'Warehouse Employee'

    code = models.CharField(max_length=32, choices=Code.choices, unique=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.code


class UserManager(DjangoUserManager):
    def ensure_default_roles(self):
        roles = {}
        for code, name in (
            (Role.Code.ADMIN, 'Administrator'),
            (Role.Code.SUPERVISOR, 'Supervisor'),
            (Role.Code.WAREHOUSE_EMPLOYEE, 'Warehouse Employee'),
        ):
            roles[code], _ = Role.objects.get_or_create(code=code, defaults={'name': name})
        return roles

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        """Assign warehouse ADMIN role — Django is_superuser alone is not enough for the app."""
        roles = self.ensure_default_roles()
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        if not extra_fields.get('role') and not extra_fields.get('role_id'):
            extra_fields['role'] = roles[Role.Code.ADMIN]
        if not extra_fields.get('employee_id'):
            extra_fields['employee_id'] = 'ADMIN'
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    objects = UserManager()
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name='users', null=True)
    employee_id = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def role_code(self):
        if self.role_id:
            return self.role.code
        # Legacy / createsuperuser without Role FK — still treat Django superusers as ADMIN.
        if self.is_superuser:
            return Role.Code.ADMIN
        return None

    def has_role(self, *codes):
        code = self.role_code
        return bool(code and code in codes)
