from django.conf import settings
from django.db import models


class Barcode(models.Model):
    class EntityType(models.TextChoices):
        BATCH = 'BATCH', 'Batch'
        UNIT = 'UNIT', 'Unit'
        RACK = 'RACK', 'Rack'

    value = models.CharField(max_length=100, unique=True, db_index=True)
    entity_type = models.CharField(max_length=16, choices=EntityType.choices)
    entity_id = models.PositiveIntegerField()
    label_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
        ]

    def __str__(self):
        return self.value


class Printer(models.Model):
    """A network (Wi-Fi / LAN) label printer that accepts raw ZPL or TSPL over TCP."""

    class Language(models.TextChoices):
        ZPL = 'ZPL', 'ZPL (Zebra and compatible)'
        TSPL = 'TSPL', 'TSPL (TSC and compatible)'

    name = models.CharField(max_length=100, unique=True)
    language = models.CharField(max_length=8, choices=Language.choices, default=Language.ZPL)
    host = models.CharField(max_length=255, help_text='Printer IP address or hostname on the warehouse Wi-Fi')
    port = models.PositiveIntegerField(default=9100)
    label_width_mm = models.PositiveSmallIntegerField(default=50)
    label_height_mm = models.PositiveSmallIntegerField(default=25)
    dpi = models.PositiveSmallIntegerField(default=203)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.host}:{self.port})'


class PrintLog(models.Model):
    barcode = models.ForeignKey(Barcode, on_delete=models.PROTECT, related_name='print_logs')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    printer = models.CharField(max_length=100, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
