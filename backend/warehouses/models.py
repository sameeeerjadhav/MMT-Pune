from django.conf import settings
from django.db import models


class Warehouse(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=150)
    address = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.code} - {self.name}'


class Rack(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='racks')
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    barcode = models.OneToOneField(
        'barcodes.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='rack'
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('warehouse', 'code')

    def __str__(self):
        return self.code


class Shelf(models.Model):
    rack = models.ForeignKey(Rack, on_delete=models.CASCADE, related_name='shelves')
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('rack', 'code')
        verbose_name_plural = 'shelves'

    def __str__(self):
        return f'{self.rack.code}-{self.code}'


class RackPosition(models.Model):
    shelf = models.ForeignKey(Shelf, on_delete=models.CASCADE, related_name='positions')
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('shelf', 'code')

    def __str__(self):
        return f'{self.shelf}-{self.code}'


class RackTransfer(models.Model):
    from_position = models.ForeignKey(
        RackPosition, on_delete=models.PROTECT, related_name='transfers_from'
    )
    to_position = models.ForeignKey(
        RackPosition, on_delete=models.PROTECT, related_name='transfers_to'
    )
    batch = models.ForeignKey(
        'inventory.InventoryBatch', on_delete=models.PROTECT, null=True, blank=True
    )
    unit = models.ForeignKey(
        'inventory.InventoryUnit', on_delete=models.PROTECT, null=True, blank=True
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
