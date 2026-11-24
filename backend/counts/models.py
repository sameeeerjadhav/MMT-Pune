from django.conf import settings
from django.db import models


class CountSession(models.Model):
    """A cycle count of one rack: staff scan what is physically there, the system flags differences."""

    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        SUBMITTED = 'SUBMITTED', 'Submitted'

    rack = models.ForeignKey('warehouses.Rack', on_delete=models.PROTECT, related_name='count_sessions')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN, db_index=True)
    notes = models.CharField(max_length=255, blank=True)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='count_sessions_started'
    )
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='count_sessions_submitted',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    # Frozen result written on submit, so later stock movements don't rewrite history.
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-started_at', '-id']

    def __str__(self):
        return f'Count #{self.pk} · {self.rack.code} · {self.status}'


class CountLine(models.Model):
    session = models.ForeignKey(CountSession, on_delete=models.CASCADE, related_name='lines')
    barcode_value = models.CharField(max_length=100)
    batch = models.ForeignKey(
        'inventory.InventoryBatch',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='count_lines',
    )
    unit = models.ForeignKey(
        'inventory.InventoryUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='count_lines',
    )
    # Counted quantity: always 1 for units, the physically counted amount for batches.
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    scanned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='count_lines'
    )
    scanned_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-scanned_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['session', 'batch'],
                name='uniq_count_session_batch',
                condition=models.Q(batch__isnull=False),
            ),
            models.UniqueConstraint(
                fields=['session', 'unit'],
                name='uniq_count_session_unit',
                condition=models.Q(unit__isnull=False),
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(batch__isnull=False, unit__isnull=True)
                    | models.Q(batch__isnull=True, unit__isnull=False)
                ),
                name='count_line_batch_xor_unit',
            ),
        ]
