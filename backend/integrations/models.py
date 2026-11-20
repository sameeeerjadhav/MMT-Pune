from django.db import models


class IntegrationLog(models.Model):
    class Source(models.TextChoices):
        MOCK = 'MOCK', 'Mock'
        REST = 'REST', 'REST'
        WEBHOOK = 'WEBHOOK', 'Webhook'
        SCHEDULED = 'SCHEDULED', 'Scheduled'
        DATABASE = 'DATABASE', 'Database'
        CSV = 'CSV', 'CSV'

    class System(models.TextChoices):
        M1 = 'M1', 'M1'
        WORKROOM = 'WORKROOM', 'Workroom'
        MANUAL = 'MANUAL', 'Manual'
        MOCK = 'MOCK', 'Mock'

    class Status(models.TextChoices):
        SUCCESS = 'SUCCESS', 'Success'
        FAILED = 'FAILED', 'Failed'
        DUPLICATE = 'DUPLICATE', 'Duplicate'

    source = models.CharField(max_length=16, choices=Source.choices)
    system = models.CharField(max_length=16, choices=System.choices)
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices)
    message = models.TextField(blank=True)
    grn = models.ForeignKey(
        'grn.GRN', on_delete=models.SET_NULL, null=True, blank=True, related_name='integration_logs'
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
