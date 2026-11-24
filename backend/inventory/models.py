from django.conf import settings
from django.db import models


class Category(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=150)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'categories'

    def __str__(self):
        return self.name


class Vendor(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=150)
    contact = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Item(models.Model):
    class InventoryType(models.TextChoices):
        BULK = 'BULK', 'Bulk / Batch'
        UNIT = 'UNIT', 'Individual Unit'

    item_code = models.CharField(max_length=50, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name='items')
    inventory_type = models.CharField(max_length=16, choices=InventoryType.choices)
    uom = models.CharField(max_length=20, default='EA')
    image = models.ImageField(upload_to='items/%Y/%m/', blank=True, null=True)
    reorder_level = models.DecimalField(
        max_digits=18,
        decimal_places=4,
        default=0,
        help_text='Raise a low-stock alert when withdrawable stock is at or below this. 0 = off.',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.item_code} - {self.name}'


class InventoryBatch(models.Model):
    class TestingStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PASSED = 'PASSED', 'Passed'
        FAILED = 'FAILED', 'Failed'

    batch_code = models.CharField(max_length=50, unique=True, db_index=True)
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name='batches')
    grn_line = models.ForeignKey('grn.GRNLine', on_delete=models.PROTECT, related_name='batches')
    received_qty = models.DecimalField(max_digits=18, decimal_places=4)
    available_qty = models.DecimalField(max_digits=18, decimal_places=4)
    withdrawn_qty = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    reserved_qty = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    testing_status = models.CharField(
        max_length=16, choices=TestingStatus.choices, default=TestingStatus.PENDING
    )
    received_at = models.DateTimeField(db_index=True)
    expiry_date = models.DateField(null=True, blank=True, db_index=True)
    barcode = models.OneToOneField(
        'barcodes.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='batch'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['item', 'received_at']),
        ]

    def __str__(self):
        return self.batch_code


class InventoryUnit(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = 'AVAILABLE', 'Available'
        RESERVED = 'RESERVED', 'Reserved'
        WITHDRAWN = 'WITHDRAWN', 'Withdrawn'
        FAILED = 'FAILED', 'Failed'

    class TestingStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PASSED = 'PASSED', 'Passed'
        FAILED = 'FAILED', 'Failed'

    unit_code = models.CharField(max_length=50, unique=True, db_index=True)
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name='units')
    grn_line = models.ForeignKey('grn.GRNLine', on_delete=models.PROTECT, related_name='units')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.AVAILABLE)
    testing_status = models.CharField(
        max_length=16, choices=TestingStatus.choices, default=TestingStatus.PENDING
    )
    received_at = models.DateTimeField(db_index=True)
    barcode = models.OneToOneField(
        'barcodes.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='unit'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['item', 'received_at']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return self.unit_code


class StockAllocation(models.Model):
    class AllocationType(models.TextChoices):
        PLANNED = 'PLANNED', 'Planned'
        ACTUAL = 'ACTUAL', 'Actual'

    allocation_type = models.CharField(max_length=16, choices=AllocationType.choices)
    batch = models.ForeignKey(
        InventoryBatch, on_delete=models.CASCADE, null=True, blank=True, related_name='allocations'
    )
    unit = models.ForeignKey(
        InventoryUnit, on_delete=models.CASCADE, null=True, blank=True, related_name='allocations'
    )
    position = models.ForeignKey(
        'warehouses.RackPosition', on_delete=models.PROTECT, related_name='allocations'
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['allocation_type', 'is_active']),
        ]


class InventoryTransaction(models.Model):
    class Type(models.TextChoices):
        RECEIVE = 'RECEIVE', 'Receive'
        ALLOCATE = 'ALLOCATE', 'Allocate'
        TRANSFER = 'TRANSFER', 'Transfer'
        WITHDRAW = 'WITHDRAW', 'Withdraw'
        FIFO_CHECK = 'FIFO_CHECK', 'Older-stock check'
        FIFO_OVERRIDE = 'FIFO_OVERRIDE', 'Older-stock override'
        ADJUST = 'ADJUST', 'Adjust'

    class Purpose(models.TextChoices):
        SHIPMENT = 'SHIPMENT', 'Shipment'
        ASSEMBLY = 'ASSEMBLY', 'Assembly'

    type = models.CharField(max_length=32, choices=Type.choices, db_index=True)
    batch = models.ForeignKey(
        InventoryBatch, on_delete=models.PROTECT, null=True, blank=True, related_name='transactions'
    )
    unit = models.ForeignKey(
        InventoryUnit, on_delete=models.PROTECT, null=True, blank=True, related_name='transactions'
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    purpose = models.CharField(max_length=16, choices=Purpose.choices, blank=True)
    from_position = models.ForeignKey(
        'warehouses.RackPosition',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tx_from',
    )
    to_position = models.ForeignKey(
        'warehouses.RackPosition',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tx_to',
    )
    withdrawal = models.ForeignKey(
        'withdrawals.Withdrawal',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
    )
    transfer = models.ForeignKey(
        'warehouses.RackTransfer',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    notes = models.TextField(blank=True)
    override_reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
