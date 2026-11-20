from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import Role, User
from barcodes.services import create_barcode, label_payload
from grn.models import GRN, GRNLine
from inventory.models import (
    Category,
    InventoryBatch,
    InventoryTransaction,
    InventoryUnit,
    Item,
    StockAllocation,
    Vendor,
)
from warehouses.models import Rack, RackPosition, RackTransfer, Shelf, Warehouse
from warehouses.services import create_rack
from withdrawals.models import Withdrawal, WithdrawalLine


def aware(year, month, day):
    return timezone.make_aware(datetime(year, month, day, 10, 0, 0))


class Command(BaseCommand):
    help = 'Seed realistic demo data for client demonstration'

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write('Seeding demo data...')

        roles = {}
        for code, name in [
            ('ADMIN', 'Administrator'),
            ('SUPERVISOR', 'Supervisor'),
            ('WAREHOUSE_EMPLOYEE', 'Warehouse Employee'),
        ]:
            roles[code], _ = Role.objects.get_or_create(code=code, defaults={'name': name})

        users = [
            ('admin', 'admin@warehouse.local', 'Demo@12345', 'Admin', 'User', 'ADMIN', 'EMP-001'),
            ('supervisor', 'supervisor@warehouse.local', 'Demo@12345', 'Sara', 'Supervisor', 'SUPERVISOR', 'EMP-002'),
            ('employee', 'employee@warehouse.local', 'Demo@12345', 'Raj', 'Employee', 'WAREHOUSE_EMPLOYEE', 'EMP-003'),
        ]
        for username, email, password, first, last, role_code, emp in users:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    'email': email,
                    'first_name': first,
                    'last_name': last,
                    'role': roles[role_code],
                    'employee_id': emp,
                    'is_staff': role_code == 'ADMIN',
                    'is_superuser': role_code == 'ADMIN',
                },
            )
            if created:
                user.set_password(password)
                user.save()
            else:
                user.role = roles[role_code]
                user.set_password(password)
                user.save()

        admin = User.objects.get(username='admin')
        supervisor = User.objects.get(username='supervisor')
        employee = User.objects.get(username='employee')

        warehouses = []
        for code, name in [
            ('WH-MAIN', 'Main Warehouse'),
            ('WH-AIR', 'Airport Components Store'),
            ('WH-ASM', 'Assembly Staging'),
        ]:
            wh, _ = Warehouse.objects.get_or_create(code=code, defaults={'name': name, 'address': f'{name} Yard'})
            warehouses.append(wh)

        # Clear racks if re-seeding lightly — create 10 racks across warehouses
        if Rack.objects.count() < 10:
            for i in range(1, 11):
                wh = warehouses[(i - 1) % 3]
                code = f'R-{i:02d}'
                if not Rack.objects.filter(warehouse=wh, code=code).exists():
                    create_rack(warehouse_id=wh.id, code=code, name=f'Rack {i:02d}')

        categories = []
        for code, name in [
            ('FAST', 'Fasteners'),
            ('BEAR', 'Bearings'),
            ('ELEC', 'Electrical'),
            ('HYDR', 'Hydraulics'),
            ('ASM', 'Assemblies'),
        ]:
            cat, _ = Category.objects.get_or_create(code=code, defaults={'name': name})
            categories.append(cat)

        vendors = []
        for code, name in [
            ('V-ABC', 'ABC Industries'),
            ('V-SKY', 'Skyline Aviation Parts'),
            ('V-MET', 'Metro Metal Works'),
            ('V-PWR', 'PowerDrive Systems'),
            ('V-ORB', 'Orbit Components'),
        ]:
            v, _ = Vendor.objects.get_or_create(code=code, defaults={'name': name})
            vendors.append(v)

        item_defs = [
            ('STL-BOLT', 'Steel Bolt', 'FAST', 'BULK'),
            ('IND-BEAR', 'Industrial Bearing', 'BEAR', 'BULK'),
            ('MOT-ASM', 'Motor Assembly', 'ASM', 'UNIT'),
            ('HYD-SEAL', 'Hydraulic Seal Kit', 'HYDR', 'BULK'),
            ('LED-RWY', 'Runway LED Module', 'ELEC', 'UNIT'),
            ('CAB-AIR', 'Airport Cable Spool', 'ELEC', 'BULK'),
            ('PUMP-ASM', 'Fuel Pump Assembly', 'HYDR', 'UNIT'),
            ('NUT-M12', 'M12 Lock Nut', 'FAST', 'BULK'),
            ('BRG-RAD', 'Radial Bearing', 'BEAR', 'BULK'),
            ('CTRL-BOX', 'Control Box Unit', 'ELEC', 'UNIT'),
            ('GASK-FL', 'Flange Gasket', 'HYDR', 'BULK'),
            ('SEN-PROX', 'Proximity Sensor', 'ELEC', 'UNIT'),
            ('WASHER', 'Industrial Washer', 'FAST', 'BULK'),
            ('GEAR-ASM', 'Gearbox Assembly', 'ASM', 'UNIT'),
            ('HOSE-HYD', 'Hydraulic Hose', 'HYDR', 'BULK'),
        ]
        items = {}
        for code, name, cat_code, inv_type in item_defs:
            cat = Category.objects.get(code=cat_code)
            item, _ = Item.objects.get_or_create(
                item_code=code,
                defaults={
                    'name': name,
                    'category': cat,
                    'inventory_type': inv_type,
                    'uom': 'EA',
                    'description': f'{name} for airport equipment operations',
                },
            )
            items[code] = item

        # Mandatory FIFO scenario + other GRNs
        if not GRN.objects.filter(grn_number='GRN-1001').exists():
            self._create_grn(
                'GRN-1001', vendors[0], aware(2025, 11, 10), 'M1', 'M1-1001',
                [('STL-BOLT', 100, 'BULK', 'PASSED', 'BATCH-001')],
            )
        if not GRN.objects.filter(grn_number='GRN-1002').exists():
            self._create_grn(
                'GRN-1002', vendors[0], aware(2025, 11, 12), 'M1', 'M1-1002',
                [('STL-BOLT', 50, 'BULK', 'PASSED', 'BATCH-002')],
            )

        # Industrial Bearing FIFO pair
        if not GRN.objects.filter(grn_number='GRN-1003').exists():
            self._create_grn(
                'GRN-1003', vendors[1], aware(2025, 11, 10), 'WORKROOM', 'WR-1003',
                [('IND-BEAR', 50, 'BULK', 'PASSED', 'BATCH-BEAR-A')],
            )
        if not GRN.objects.filter(grn_number='GRN-1004').exists():
            self._create_grn(
                'GRN-1004', vendors[1], aware(2025, 11, 12), 'WORKROOM', 'WR-1004',
                [('IND-BEAR', 50, 'BULK', 'PASSED', 'BATCH-BEAR-B')],
            )

        extra_grns = [
            ('GRN-1005', vendors[2], aware(2025, 11, 8), 'MOCK', 'MOCK-1005',
             [('MOT-ASM', 10, 'UNIT', 'PASSED', None)]),
            ('GRN-1006', vendors[3], aware(2025, 11, 9), 'MANUAL', None,
             [('HYD-SEAL', 80, 'BULK', 'PENDING', 'BATCH-SEAL-01')]),
            ('GRN-1007', vendors[4], aware(2025, 11, 11), 'M1', 'M1-1007',
             [('LED-RWY', 8, 'UNIT', 'PASSED', None)]),
            ('GRN-1008', vendors[0], aware(2025, 11, 7), 'WORKROOM', 'WR-1008',
             [('CAB-AIR', 200, 'BULK', 'PASSED', 'BATCH-CAB-01')]),
            ('GRN-1009', vendors[3], aware(2025, 11, 13), 'MOCK', 'MOCK-1009',
             [('PUMP-ASM', 5, 'UNIT', 'FAILED', None)]),
            ('GRN-1010', vendors[2], aware(2025, 11, 14), 'MANUAL', None,
             [('NUT-M12', 500, 'BULK', 'PASSED', 'BATCH-NUT-01'),
              ('CTRL-BOX', 4, 'UNIT', 'PASSED', None)]),
        ]
        for grn_number, vendor, dt, system, ref, lines in extra_grns:
            if not GRN.objects.filter(grn_number=grn_number).exists():
                self._create_grn(grn_number, vendor, dt, system, ref, lines)

        # Allocate stock to racks
        positions = list(RackPosition.objects.select_related('shelf__rack').order_by('id'))
        if positions:
            batch_001 = InventoryBatch.objects.filter(batch_code='BATCH-001').first()
            batch_002 = InventoryBatch.objects.filter(batch_code='BATCH-002').first()
            if batch_001 and not batch_001.allocations.filter(is_active=True, allocation_type='ACTUAL').exists():
                StockAllocation.objects.create(
                    allocation_type='ACTUAL', batch=batch_001, position=positions[0], quantity=batch_001.available_qty
                )
            if batch_002 and not batch_002.allocations.filter(is_active=True, allocation_type='ACTUAL').exists():
                StockAllocation.objects.create(
                    allocation_type='ACTUAL', batch=batch_002, position=positions[1], quantity=batch_002.available_qty
                )
            for idx, batch in enumerate(InventoryBatch.objects.exclude(batch_code__in=['BATCH-001', 'BATCH-002'])):
                if not batch.allocations.filter(is_active=True).exists():
                    StockAllocation.objects.create(
                        allocation_type='ACTUAL',
                        batch=batch,
                        position=positions[(idx + 2) % len(positions)],
                        quantity=batch.available_qty,
                    )
            for idx, unit in enumerate(InventoryUnit.objects.filter(status='AVAILABLE')):
                if not unit.allocations.filter(is_active=True).exists():
                    StockAllocation.objects.create(
                        allocation_type='ACTUAL',
                        unit=unit,
                        position=positions[(idx + 5) % len(positions)],
                        quantity=Decimal('1'),
                    )

        # Partial bulk withdrawal from BATCH-001 (older) — shipment
        batch_001 = InventoryBatch.objects.filter(batch_code='BATCH-001').first()
        if batch_001 and batch_001.withdrawn_qty == 0:
            qty = Decimal('20')
            prev = {'warehouse': 'WH-MAIN', 'rack': 'R-01', 'shelf': 'A', 'position': '01'}
            batch_001.available_qty -= qty
            batch_001.withdrawn_qty += qty
            batch_001.save()
            w = Withdrawal.objects.create(purpose='SHIPMENT', reference='SHP-DEMO-1', user=employee, notes='Demo partial withdraw')
            WithdrawalLine.objects.create(withdrawal=w, batch=batch_001, quantity=qty, fifo_ok=True, previous_location=prev)
            InventoryTransaction.objects.create(
                type='WITHDRAW', batch=batch_001, quantity=qty, purpose='SHIPMENT', withdrawal=w, user=employee
            )

        # Individual unit withdrawal — assembly
        unit = InventoryUnit.objects.filter(status='AVAILABLE', item__item_code='MOT-ASM').first()
        if unit:
            unit.status = 'WITHDRAWN'
            unit.save(update_fields=['status'])
            w = Withdrawal.objects.create(purpose='ASSEMBLY', reference='ASM-DEMO-1', user=employee)
            WithdrawalLine.objects.create(
                withdrawal=w, unit=unit, quantity=Decimal('1'), fifo_ok=True, previous_location={}
            )
            InventoryTransaction.objects.create(
                type='WITHDRAW', unit=unit, quantity=Decimal('1'), purpose='ASSEMBLY', withdrawal=w, user=employee
            )

        # Sample rack transfer
        batch_seal = InventoryBatch.objects.filter(batch_code='BATCH-SEAL-01').first()
        if batch_seal and positions and len(positions) > 3:
            from_alloc = batch_seal.allocations.filter(is_active=True, allocation_type='ACTUAL').first()
            if from_alloc and from_alloc.position_id != positions[3].id:
                from_pos = from_alloc.position
                to_pos = positions[3]
                from_alloc.is_active = False
                from_alloc.save(update_fields=['is_active'])
                StockAllocation.objects.create(
                    allocation_type='ACTUAL',
                    batch=batch_seal,
                    position=to_pos,
                    quantity=batch_seal.available_qty,
                )
                transfer = RackTransfer.objects.create(
                    from_position=from_pos,
                    to_position=to_pos,
                    batch=batch_seal,
                    quantity=batch_seal.available_qty,
                    reason='Demo rack transfer',
                    user=employee,
                )
                InventoryTransaction.objects.create(
                    type='TRANSFER',
                    batch=batch_seal,
                    quantity=batch_seal.available_qty,
                    from_position=from_pos,
                    to_position=to_pos,
                    transfer=transfer,
                    user=employee,
                )

        # Demo supervisor FIFO override record (historical sample)
        if not InventoryTransaction.objects.filter(type='FIFO_OVERRIDE').exists():
            InventoryTransaction.objects.create(
                type='FIFO_OVERRIDE',
                batch=InventoryBatch.objects.filter(batch_code='BATCH-002').first(),
                quantity=Decimal('1'),
                purpose='SHIPMENT',
                user=supervisor,
                override_reason='Urgent aircraft gate repair — demo override sample',
                notes='Historical demo FIFO override',
            )

        self.stdout.write(self.style.SUCCESS('Demo data seeded successfully.'))
        self.stdout.write('Login: admin / Demo@12345 | supervisor / Demo@12345 | employee / Demo@12345')

    def _create_grn(self, grn_number, vendor, received_date, system, external_ref, lines):
        grn = GRN.objects.create(
            grn_number=grn_number,
            external_system=system,
            external_ref=external_ref,
            vendor=vendor,
            received_date=received_date,
            status='RECEIVED',
        )
        for item_code, qty, classification, testing, batch_code in lines:
            item = Item.objects.get(item_code=item_code)
            line = GRNLine.objects.create(
                grn=grn,
                item=item,
                received_qty=Decimal(str(qty)),
                uom=item.uom,
                testing_status=testing,
                classification=classification,
            )
            if classification == 'BULK':
                batch = InventoryBatch.objects.create(
                    batch_code=batch_code or f'BATCH-TMP-{line.id}',
                    item=item,
                    grn_line=line,
                    received_qty=Decimal(str(qty)),
                    available_qty=Decimal(str(qty)),
                    testing_status=testing,
                    received_at=received_date,
                )
                if not batch_code:
                    batch.batch_code = f'BATCH-{batch.id:04d}'
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
                batch.save()
            else:
                for _ in range(int(qty)):
                    unit = InventoryUnit.objects.create(
                        unit_code=f'TMP-{line.id}',
                        item=item,
                        grn_line=line,
                        status='FAILED' if testing == 'FAILED' else 'AVAILABLE',
                        testing_status=testing,
                        received_at=received_date,
                    )
                    unit.unit_code = f'{item.item_code}-{unit.id:04d}'
                    barcode = create_barcode(
                        'UNIT',
                        unit.id,
                        label_payload(
                            item_name=item.name,
                            item_code=item.item_code,
                            grn_number=grn.grn_number,
                            batch_or_unit=unit.unit_code,
                            quantity=1,
                        ),
                    )
                    unit.barcode = barcode
                    unit.save()
            InventoryTransaction.objects.create(
                type='RECEIVE',
                quantity=Decimal(str(qty)),
                notes=f'Received via GRN {grn.grn_number}',
                metadata={'grn_id': grn.id},
            )
        return grn
