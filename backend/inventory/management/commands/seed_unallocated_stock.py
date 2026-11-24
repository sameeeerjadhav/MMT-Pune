from datetime import datetime
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from barcodes.services import create_barcode, label_payload
from grn.models import GRN, GRNLine
from inventory.models import Category, InventoryBatch, InventoryTransaction, Item, Vendor


def aware(year, month, day):
    return timezone.make_aware(datetime(year, month, day, 10, 0, 0))


# Ten bulk lots — received & QA-passed, intentionally NOT put away on any rack.
STOCK_LINES = [
    ('HYD-HOSE-01', 'Hydraulic Hose 1/2"', 40, 'BATCH-UA-01'),
    ('FILTER-OIL-20', 'Oil Filter Cartridge', 120, 'BATCH-UA-02'),
    ('BEARING-6205', 'Deep Groove Bearing 6205', 80, 'BATCH-UA-03'),
    ('SEAL-KIT-A', 'Pump Seal Kit A', 35, 'BATCH-UA-04'),
    ('BOLT-M12-50', 'Hex Bolt M12x50', 500, 'BATCH-UA-05'),
    ('GASKET-FL-08', 'Flange Gasket DN80', 60, 'BATCH-UA-06'),
    ('CABLE-4C-2.5', '4-Core Cable 2.5mm', 250, 'BATCH-UA-07'),
    ('VALVE-BV-25', 'Ball Valve 25mm', 45, 'BATCH-UA-08'),
    ('GREASE-EP2', 'EP2 Lithium Grease', 90, 'BATCH-UA-09'),
    ('COUPLING-FC-3', 'Flexible Coupling 3"', 28, 'BATCH-UA-10'),
]


class Command(BaseCommand):
    help = 'Add 10 QA-passed bulk stock lots with no rack allocations (putaway later).'

    @transaction.atomic
    def handle(self, *args, **options):
        category, _ = Category.objects.get_or_create(
            code='UA-STOCK', defaults={'name': 'Unallocated stock'}
        )
        vendor, _ = Vendor.objects.get_or_create(
            code='UA-VEND', defaults={'name': 'Unallocated Stock Vendor'}
        )
        received_at = aware(2026, 11, 20)
        grn_number = 'GRN-UA-STOCK-10'
        grn, grn_created = GRN.objects.get_or_create(
            grn_number=grn_number,
            defaults={
                'external_system': 'SEED',
                'external_ref': 'UA-STOCK-10',
                'vendor': vendor,
                'received_date': received_at,
                'status': 'RECEIVED',
                'notes': 'Ten unallocated stock lots for putaway testing',
            },
        )

        created = 0
        skipped = 0
        for item_code, name, qty, batch_code in STOCK_LINES:
            item, _ = Item.objects.get_or_create(
                item_code=item_code,
                defaults={
                    'name': name,
                    'category': category,
                    'inventory_type': 'BULK',
                    'uom': 'EA',
                    'is_active': True,
                },
            )
            if InventoryBatch.objects.filter(batch_code=batch_code).exists():
                skipped += 1
                self.stdout.write(f'  skip existing {batch_code}')
                continue

            line = GRNLine.objects.create(
                grn=grn,
                item=item,
                received_qty=Decimal(str(qty)),
                uom=item.uom,
                testing_status='PASSED',
                classification='BULK',
                description=name,
            )
            batch = InventoryBatch.objects.create(
                batch_code=batch_code,
                item=item,
                grn_line=line,
                received_qty=Decimal(str(qty)),
                available_qty=Decimal(str(qty)),
                testing_status='PASSED',
                received_at=received_at,
            )
            barcode = create_barcode(
                'BATCH',
                batch.id,
                label_payload(
                    item_name=item.name,
                    item_code=item.item_code,
                    grn_number=grn.grn_number,
                    batch_or_unit=batch.batch_code,
                    quantity=qty,
                ),
            )
            batch.barcode = barcode
            batch.save(update_fields=['barcode', 'updated_at'])
            InventoryTransaction.objects.create(
                type='RECEIVE',
                batch=batch,
                quantity=Decimal(str(qty)),
                notes=f'Received via GRN {grn.grn_number} (unallocated seed)',
                metadata={'grn_id': grn.id, 'grn_line_id': line.id, 'unallocated': True},
            )
            created += 1
            self.stdout.write(self.style.SUCCESS(f'  + {batch_code} qty={qty} (no allocation)'))

        self.stdout.write(
            self.style.SUCCESS(
                f'Done. created={created} skipped={skipped} grn={grn_number} '
                f'({"new" if grn_created else "existing"}) — none allocated to racks.'
            )
        )
