from django.core.management.base import BaseCommand
from django.db import transaction

from audit.models import AuditLog
from barcodes.models import Barcode, PrintLog
from grn.models import GRN, GRNLine
from integrations.models import IntegrationLog
from inventory.models import (
    Category,
    InventoryBatch,
    InventoryTransaction,
    InventoryUnit,
    Item,
    StockAllocation,
    Vendor,
)
from warehouses.models import Rack, RackTransfer, Warehouse
from withdrawals.models import Withdrawal, WithdrawalLine


class Command(BaseCommand):
    help = (
        'Remove all operational/demo warehouse data so you can enter your own. '
        'Keeps login users and roles (admin / supervisor / employee).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--yes',
            action='store_true',
            help='Skip confirmation prompt',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not options['yes']:
            self.stdout.write(self.style.WARNING(
                'This deletes warehouses, racks, items, stock, GRNs, withdrawals, and barcodes.'
            ))
            self.stdout.write('Login users are kept.')
            confirm = input('Type YES to continue: ').strip()
            if confirm != 'YES':
                self.stdout.write('Cancelled.')
                return

        from django.conf import settings

        db = settings.DATABASES['default']
        self.stdout.write(
            f"Clearing demo data... (db={db.get('ENGINE')} name={db.get('NAME')})"
        )

        # Delete in dependency order (PROTECT / history first).
        counts = {}

        def wipe(label, qs):
            n, _ = qs.delete()
            counts[label] = n
            self.stdout.write(f'  {label}: {n}')

        wipe('inventory_transactions', InventoryTransaction.objects.all())
        wipe('withdrawal_lines', WithdrawalLine.objects.all())
        wipe('withdrawals', Withdrawal.objects.all())
        wipe('stock_allocations', StockAllocation.objects.all())
        wipe('rack_transfers', RackTransfer.objects.all())
        wipe('print_logs', PrintLog.objects.all())
        wipe('inventory_batches', InventoryBatch.objects.all())
        wipe('inventory_units', InventoryUnit.objects.all())
        wipe('grn_lines', GRNLine.objects.all())
        wipe('grns', GRN.objects.all())
        wipe('items', Item.objects.all())
        wipe('categories', Category.objects.all())
        wipe('vendors', Vendor.objects.all())
        # Racks cascade shelves + positions
        wipe('racks', Rack.objects.all())
        wipe('warehouses', Warehouse.objects.all())
        wipe('barcodes', Barcode.objects.all())
        wipe('audit_logs', AuditLog.objects.all())
        wipe('integration_logs', IntegrationLog.objects.all())

        self.stdout.write(self.style.SUCCESS(
            'Demo data cleared. Sign in with admin / supervisor / employee and add your own data.'
        ))
