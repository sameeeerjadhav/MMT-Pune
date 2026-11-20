from django.contrib.auth.models import AbstractUser
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


class User(AbstractUser):
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name='users', null=True)
    employee_id = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def role_code(self):
        return self.role.code if self.role_id else None

    def has_role(self, *codes):
        return bool(self.role_id and self.role.code in codes)
