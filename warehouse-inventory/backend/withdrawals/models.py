from django.conf import settings
from django.db import models


class Withdrawal(models.Model):
    class Purpose(models.TextChoices):
        SHIPMENT = 'SHIPMENT', 'Shipment'
        ASSEMBLY = 'ASSEMBLY', 'Assembly'

    purpose = models.CharField(max_length=16, choices=Purpose.choices)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='withdrawals')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']


class WithdrawalLine(models.Model):
    withdrawal = models.ForeignKey(Withdrawal, on_delete=models.CASCADE, related_name='lines')
    batch = models.ForeignKey(
        'inventory.InventoryBatch',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='withdrawal_lines',
    )
    unit = models.ForeignKey(
        'inventory.InventoryUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='withdrawal_lines',
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    fifo_ok = models.BooleanField(default=True)
    fifo_override = models.BooleanField(default=False)
    override_reason = models.TextField(blank=True)
    previous_location = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
