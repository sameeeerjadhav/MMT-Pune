from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from audit.models import AuditLog
from barcodes.services import create_barcode, label_payload, render_label_png_bytes
from grn.models import GRN, GRNLine
from inventory.models import Category, InventoryBatch, InventoryUnit, Item, StockAllocation, Vendor
from warehouses.models import Rack, RackPosition, Shelf, Warehouse


User = get_user_model()


class FifoApiTests(TestCase):
    def setUp(self):
        self.admin_role, _ = Role.objects.get_or_create(
            code='ADMIN', defaults={'name': 'Administrator'}
        )
        self.supervisor_role, _ = Role.objects.get_or_create(
            code='SUPERVISOR', defaults={'name': 'Supervisor'}
        )
        self.employee_role, _ = Role.objects.get_or_create(
            code='WAREHOUSE_EMPLOYEE', defaults={'name': 'Warehouse Employee'}
        )
        self.admin = User.objects.create_user(
            username='admin_tester', password='pass12345', role=self.admin_role
        )
        self.supervisor = User.objects.create_user(
            username='supervisor_tester', password='pass12345', role=self.supervisor_role
        )
        self.employee = User.objects.create_user(
            username='employee_tester', password='pass12345', role=self.employee_role
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        cat = Category.objects.create(code='T', name='Test')
        vendor = Vendor.objects.create(code='TV', name='Test Vendor')
        self.item = Item.objects.create(
            item_code='TEST-BOLT', name='Test Bolt', category=cat, inventory_type='BULK'
        )
        grn1 = GRN.objects.create(
            grn_number='G-OLD', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line1 = GRNLine.objects.create(
            grn=grn1,
            item=self.item,
            received_qty=100,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.old = InventoryBatch.objects.create(
            batch_code='OLD',
            item=self.item,
            grn_line=line1,
            received_qty=100,
            available_qty=100,
            testing_status='PASSED',
            received_at=timezone.now() - timezone.timedelta(days=2),
        )
        grn2 = GRN.objects.create(
            grn_number='G-NEW', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line2 = GRNLine.objects.create(
            grn=grn2,
            item=self.item,
            received_qty=50,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.new = InventoryBatch.objects.create(
            batch_code='NEW',
            item=self.item,
            grn_line=line2,
            received_qty=50,
            available_qty=50,
            testing_status='PASSED',
            received_at=timezone.now(),
        )

    def test_fifo_blocks_newer_batch(self):
        res = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'SHIPMENT', 'batch_id': self.new.id, 'quantity': '5'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'FIFO_VIOLATION')

    def test_older_batch_withdraw_ok(self):
        res = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'SHIPMENT', 'batch_id': self.old.id, 'quantity': '5'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.old.refresh_from_db()
        self.assertEqual(self.old.available_qty, Decimal('95'))

    def test_supervisor_can_override_fifo(self):
        self.client.force_authenticate(user=self.supervisor)
        res = self.client.post(
            '/api/withdrawals/',
            {
                'purpose': 'SHIPMENT',
                'batch_id': self.new.id,
                'quantity': '5',
                'override_reason': 'Urgent assembly line shortage',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.new.refresh_from_db()
        self.assertEqual(self.new.available_qty, Decimal('45'))
        self.assertTrue(
            AuditLog.objects.filter(action='FIFO_OVERRIDE', entity_id=self.new.id).exists()
        )

    def test_employee_cannot_override_fifo(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.post(
            '/api/withdrawals/',
            {
                'purpose': 'SHIPMENT',
                'batch_id': self.new.id,
                'quantity': '5',
                'override_reason': 'Trying to bypass',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'FORBIDDEN')


class UnitFifoApiTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='unit_tester', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        cat = Category.objects.create(code='U', name='Units')
        vendor = Vendor.objects.create(code='UV', name='Unit Vendor')
        item = Item.objects.create(
            item_code='TEST-MOTOR', name='Test Motor', category=cat, inventory_type='UNIT'
        )
        grn1 = GRN.objects.create(
            grn_number='GU-OLD', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line1 = GRNLine.objects.create(
            grn=grn1,
            item=item,
            received_qty=1,
            uom='EA',
            testing_status='PASSED',
            classification='UNIT',
        )
        self.old_unit = InventoryUnit.objects.create(
            unit_code='UNIT-OLD',
            item=item,
            grn_line=line1,
            status='AVAILABLE',
            testing_status='PASSED',
            received_at=timezone.now() - timezone.timedelta(days=3),
        )
        grn2 = GRN.objects.create(
            grn_number='GU-NEW', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line2 = GRNLine.objects.create(
            grn=grn2,
            item=item,
            received_qty=1,
            uom='EA',
            testing_status='PASSED',
            classification='UNIT',
        )
        self.new_unit = InventoryUnit.objects.create(
            unit_code='UNIT-NEW',
            item=item,
            grn_line=line2,
            status='AVAILABLE',
            testing_status='PASSED',
            received_at=timezone.now(),
        )

    def test_fifo_blocks_newer_unit(self):
        res = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'ASSEMBLY', 'unit_id': self.new_unit.id},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'FIFO_VIOLATION')

    def test_older_unit_withdraw_ok(self):
        res = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'ASSEMBLY', 'unit_id': self.old_unit.id},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.old_unit.refresh_from_db()
        self.assertEqual(self.old_unit.status, 'WITHDRAWN')


class BarcodeLabelTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='label_tester', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.barcode = create_barcode(
            'BATCH',
            999001,
            label_payload(
                item_name='Steel Bolt',
                item_code='STL-BOLT',
                grn_number='GRN-1001',
                batch_or_unit='BATCH-001',
                quantity=100,
            ),
        )

    def test_render_code128_png(self):
        png = render_label_png_bytes(self.barcode)
        self.assertTrue(png.startswith(b'\x89PNG'))

    def test_label_image_endpoint(self):
        res = self.client.get(f'/api/barcodes/{self.barcode.value}/label.png')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'image/png')
        self.assertTrue(res.content.startswith(b'\x89PNG'))

    def test_barcode_detail_includes_base64_label(self):
        res = self.client.get(f'/api/barcodes/{self.barcode.value}/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('label_image_base64', res.data)
        self.assertTrue(len(res.data['label_image_base64']) > 100)


class GrnImportDuplicateTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='grn_tester', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        Category.objects.create(code='FAST', name='Fasteners')
        Vendor.objects.create(code='V1', name='Vendor 1')
        self.payload = {
            'grn_number': 'GRN-DUP-1',
            'external_system': 'MOCK',
            'external_ref': 'MOCK-DUP-1',
            'vendor_code': 'V1',
            'vendor_name': 'Vendor 1',
            'received_date': timezone.now().isoformat(),
            'lines': [
                {
                    'item_code': 'DUP-ITEM',
                    'item_name': 'Dup Item',
                    'category_code': 'FAST',
                    'category_name': 'Fasteners',
                    'received_qty': '10',
                    'uom': 'EA',
                    'classification': 'BULK',
                    'testing_status': 'PASSED',
                    'batch_number': 'DUP-BATCH-1',
                }
            ],
        }

    def test_duplicate_import_rejected(self):
        first = self.client.post('/api/grns/import/', self.payload, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/grns/import/', self.payload, format='json')
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data['code'], 'DUPLICATE_GRN')


class ConcurrentWithdrawSmokeTests(TestCase):
    """Sequential stock protection (parallel coverage lives in warehouses.tests)."""

    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='concurrent', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        cat = Category.objects.create(code='C', name='Conc')
        vendor = Vendor.objects.create(code='CV', name='Conc Vendor')
        item = Item.objects.create(
            item_code='CONC-BOLT', name='Conc Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-CONC', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line = GRNLine.objects.create(
            grn=grn,
            item=item,
            received_qty=10,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.batch = InventoryBatch.objects.create(
            batch_code='CONC-BATCH',
            item=item,
            grn_line=line,
            received_qty=10,
            available_qty=10,
            testing_status='PASSED',
            received_at=timezone.now(),
        )

    def test_cannot_overdraw_remaining_stock(self):
        first = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'SHIPMENT', 'batch_id': self.batch.id, 'quantity': '7'},
            format='json',
        )
        self.assertEqual(first.status_code, 201)
        second = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'SHIPMENT', 'batch_id': self.batch.id, 'quantity': '5'},
            format='json',
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data['code'], 'INSUFFICIENT_STOCK')
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.available_qty, Decimal('3'))


class AllocationSyncTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='alloc_tester', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        cat = Category.objects.create(code='AS', name='Alloc Sync')
        vendor = Vendor.objects.create(code='ASV', name='Alloc Vendor')
        item = Item.objects.create(
            item_code='ALLOC-BOLT', name='Alloc Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-ALLOC', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line = GRNLine.objects.create(
            grn=grn,
            item=item,
            received_qty=100,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.batch = InventoryBatch.objects.create(
            batch_code='ALLOC-BATCH',
            item=item,
            grn_line=line,
            received_qty=100,
            available_qty=100,
            testing_status='PASSED',
            received_at=timezone.now(),
        )
        wh = Warehouse.objects.create(code='WH-AS', name='Alloc WH')
        rack = Rack.objects.create(warehouse=wh, code='R-AS', name='Rack AS')
        shelf = Shelf.objects.create(rack=rack, code='A')
        self.pos = RackPosition.objects.create(shelf=shelf, code='01')
        self.pos2 = RackPosition.objects.create(shelf=shelf, code='02')
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=self.batch,
            position=self.pos,
            quantity=Decimal('100'),
        )

    def test_partial_withdraw_reduces_allocation_qty(self):
        res = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'SHIPMENT', 'batch_id': self.batch.id, 'quantity': '30'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.batch.refresh_from_db()
        alloc = StockAllocation.objects.get(
            batch=self.batch, allocation_type='ACTUAL', is_active=True
        )
        self.assertEqual(self.batch.available_qty, Decimal('70'))
        self.assertEqual(alloc.quantity, Decimal('70'))

    def test_validate_does_not_write_fifo_check(self):
        from inventory.models import InventoryTransaction

        before = InventoryTransaction.objects.filter(type='FIFO_CHECK').count()
        res = self.client.post(
            '/api/withdrawals/validate/',
            {'batch_id': self.batch.id, 'quantity': '5'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        after = InventoryTransaction.objects.filter(type='FIFO_CHECK').count()
        self.assertEqual(before, after)

    def test_transfer_merges_destination_allocation(self):
        # Split 40 to position 02 first
        source = StockAllocation.objects.get(batch=self.batch, position=self.pos, is_active=True)
        source.quantity = Decimal('60')
        source.save(update_fields=['quantity'])
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=self.batch,
            position=self.pos2,
            quantity=Decimal('40'),
        )
        res = self.client.post(
            '/api/locations/transfer/',
            {
                'batch_id': self.batch.id,
                'from_position_id': self.pos.id,
                'to_position_id': self.pos2.id,
                'quantity': '10',
                'reason': 'merge test',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        dest = StockAllocation.objects.get(
            batch=self.batch, position=self.pos2, allocation_type='ACTUAL', is_active=True
        )
        self.assertEqual(dest.quantity, Decimal('50'))
        self.assertEqual(
            StockAllocation.objects.filter(
                batch=self.batch, position=self.pos2, allocation_type='ACTUAL', is_active=True
            ).count(),
            1,
        )


class BarcodeGenerateValidationTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='bc_val', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_invalid_entity_id_returns_400(self):
        res = self.client.post(
            '/api/barcodes/generate/',
            {'entity_type': 'BATCH', 'entity_id': 'abc'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['code'], 'VALIDATION_ERROR')
