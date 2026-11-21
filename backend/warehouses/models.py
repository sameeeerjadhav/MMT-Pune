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


class Floor(models.Model):
    """A warehouse floor with an admin-defined rack grid (rows ? columns)."""

    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='floors')
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    level = models.IntegerField(default=1, help_text='Floor level number (1 = ground)')
    row_count = models.PositiveIntegerField(default=4, help_text='Number of rack rows on this floor')
    column_count = models.PositiveIntegerField(
        default=5, help_text='Number of rack columns on this floor'
    )
    description = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('warehouse', 'code')
        ordering = ['warehouse_id', 'level', 'code']

    def __str__(self):
        return f'{self.warehouse.code}/{self.code}'


class Rack(models.Model):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='racks')
    floor = models.ForeignKey(
        Floor, on_delete=models.SET_NULL, null=True, blank=True, related_name='racks'
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=150)
    # Placement on the floor grid (1-indexed). Null = not placed on a floor map yet.
    row_index = models.PositiveIntegerField(null=True, blank=True)
    column_index = models.PositiveIntegerField(null=True, blank=True)
    barcode = models.OneToOneField(
        'barcodes.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='rack'
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('warehouse', 'code')
        constraints = [
            models.UniqueConstraint(
                fields=['floor', 'row_index', 'column_index'],
                name='uniq_floor_rack_cell',
                condition=models.Q(floor__isnull=False)
                & models.Q(row_index__isnull=False)
                & models.Q(column_index__isnull=False),
            )
        ]

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
