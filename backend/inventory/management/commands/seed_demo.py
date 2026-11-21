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
from warehouses.models import Floor, Rack, RackPosition, RackTransfer, Shelf, Warehouse
from warehouses.services import create_floor, create_rack, place_rack_on_floor
from withdrawals.models import Withdrawal, WithdrawalLine


def aware(year, month, day):
    return timezone.make_aware(datetime(year, month, day, 10, 0, 0))


class Command(BaseCommand):
    help = 'Seed realistic demo data for client demonstration'

    @transaction.atomic
    def handle(self, *args, **options):
        from django.conf import settings

        db = settings.DATABASES['default']
        self.stdout.write(
            f"Seeding demo data... (db={db.get('ENGINE')} name={db.get('NAME')} host={db.get('HOST') or 'n/a'})"
        )

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

        # Floors with admin-defined rack grids (rows × columns)
        floors_by_wh = {}
        floor_defs = [
            # warehouse index, code, name, level, rows, cols
            (0, 'G', 'Ground Floor', 1, 3, 4),
            (0, 'L1', 'Level 1', 2, 2, 3),
            (1, 'G', 'Ground Floor', 1, 2, 3),
            (2, 'G', 'Staging Floor', 1, 2, 2),
        ]
        for wh_idx, code, name, level, rows, cols in floor_defs:
            wh = warehouses[wh_idx]
            floor, created = Floor.objects.get_or_create(
                warehouse=wh,
                code=code,
                defaults={
                    'name': name,
                    'level': level,
                    'row_count': rows,
                    'column_count': cols,
                    'description': f'{name} rack grid {rows}×{cols}',
                },
            )
            if not created:
                floor.row_count = rows
                floor.column_count = cols
                floor.name = name
                floor.level = level
                floor.save(update_fields=['row_count', 'column_count', 'name', 'level', 'updated_at'])
            floors_by_wh.setdefault(wh.id, []).append(floor)

        # Create 10 racks across warehouses and place them on floor grids
        if Rack.objects.count() < 10:
            for i in range(1, 11):
                wh = warehouses[(i - 1) % 3]
                code = f'R-{i:02d}'
                if not Rack.objects.filter(warehouse=wh, code=code).exists():
                    create_rack(warehouse_id=wh.id, code=code, name=f'Rack {i:02d}')

        # Place racks onto floors in reading order (row-major)
        for wh in warehouses:
            floor_list = floors_by_wh.get(wh.id) or list(Floor.objects.filter(warehouse=wh))
            if not floor_list:
                continue
            racks = list(Rack.objects.filter(warehouse=wh, is_active=True).order_by('code'))
            rack_idx = 0
            for floor in floor_list:
                for r in range(1, floor.row_count + 1):
                    for c in range(1, floor.column_count + 1):
                        if rack_idx >= len(racks):
                            break
                        rack = racks[rack_idx]
                        rack_idx += 1
                        if rack.floor_id == floor.id and rack.row_index == r and rack.column_index == c:
                            continue
                        try:
                            place_rack_on_floor(
                                floor_id=floor.id, rack_id=rack.id, row_index=r, column_index=c
                            )
                        except Exception:
                            # Skip conflicts on re-seed
                            pass
                    if rack_idx >= len(racks):
                        break

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
        # Must reduce rack allocations too (available_qty alone leaves map/allocate inconsistent).
        from withdrawals.services import create_withdrawal

        batch_001 = InventoryBatch.objects.filter(batch_code='BATCH-001').first()
        if batch_001 and batch_001.withdrawn_qty == 0:
            create_withdrawal(
                user=employee,
                purpose='SHIPMENT',
                batch_id=batch_001.id,
                quantity=Decimal('20'),
                reference='SHP-DEMO-1',
                notes='Demo partial withdraw',
            )

        # Individual unit withdrawal — assembly
        unit = InventoryUnit.objects.filter(status='AVAILABLE', item__item_code='MOT-ASM').first()
        if unit:
            create_withdrawal(
                user=employee,
                purpose='ASSEMBLY',
                unit_id=unit.id,
                reference='ASM-DEMO-1',
            )

        # Repair any legacy seed mismatch: active ACTUAL qty should not exceed available_qty.
        for batch in InventoryBatch.objects.all():
            allocs = list(
                StockAllocation.objects.filter(
                    batch=batch, allocation_type='ACTUAL', is_active=True
                ).order_by('id')
            )
            if not allocs:
                continue
            total = sum((a.quantity or Decimal('0')) for a in allocs)
            target = batch.available_qty or Decimal('0')
            if total <= target:
                continue
            excess = total - target
            for alloc in reversed(allocs):
                if excess <= 0:
                    break
                current = alloc.quantity or Decimal('0')
                take = min(current, excess)
                new_qty = current - take
                excess -= take
                if new_qty <= 0:
                    alloc.is_active = False
                    alloc.quantity = Decimal('0')
                    alloc.save(update_fields=['is_active', 'quantity', 'updated_at'])
                else:
                    alloc.quantity = new_qty
                    alloc.save(update_fields=['quantity', 'updated_at'])

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
