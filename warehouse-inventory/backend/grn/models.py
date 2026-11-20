from django.db import models


class GRN(models.Model):
    class ExternalSystem(models.TextChoices):
        M1 = 'M1', 'M1'
        WORKROOM = 'WORKROOM', 'Workroom'
        MANUAL = 'MANUAL', 'Manual'
        MOCK = 'MOCK', 'Mock'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        RECEIVED = 'RECEIVED', 'Received'
        CANCELLED = 'CANCELLED', 'Cancelled'

    grn_number = models.CharField(max_length=50, unique=True, db_index=True)
    external_system = models.CharField(
        max_length=16, choices=ExternalSystem.choices, default=ExternalSystem.MANUAL
    )
    external_ref = models.CharField(max_length=100, blank=True, null=True)
    vendor = models.ForeignKey(
        'inventory.Vendor', on_delete=models.SET_NULL, null=True, blank=True, related_name='grns'
    )
    received_date = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RECEIVED)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['external_system', 'external_ref'],
                name='uniq_external_grn',
                condition=~models.Q(external_ref=None) & ~models.Q(external_ref=''),
            )
        ]

    def __str__(self):
        return self.grn_number


class GRNLine(models.Model):
    class TestingStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PASSED = 'PASSED', 'Passed'
        FAILED = 'FAILED', 'Failed'

    class Classification(models.TextChoices):
        BULK = 'BULK', 'Bulk'
        UNIT = 'UNIT', 'Unit'

    grn = models.ForeignKey(GRN, on_delete=models.CASCADE, related_name='lines')
    item = models.ForeignKey('inventory.Item', on_delete=models.PROTECT, related_name='grn_lines')
    received_qty = models.DecimalField(max_digits=18, decimal_places=4)
    uom = models.CharField(max_length=20)
    testing_status = models.CharField(
        max_length=16, choices=TestingStatus.choices, default=TestingStatus.PENDING
    )
    classification = models.CharField(max_length=16, choices=Classification.choices)
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
