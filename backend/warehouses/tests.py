from decimal import Decimal
from unittest import skipIf

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from grn.models import GRN, GRNLine
from inventory.models import Category, InventoryBatch, Item, StockAllocation, Vendor
from warehouses.models import Rack, RackPosition, Shelf, Warehouse

User = get_user_model()


class WarehouseRbacTests(TestCase):
    def setUp(self):
        admin_role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        employee_role, _ = Role.objects.get_or_create(
            code='WAREHOUSE_EMPLOYEE', defaults={'name': 'Warehouse Employee'}
        )
        self.admin = User.objects.create_user(
            username='wh_admin', password='pass12345', role=admin_role
        )
        self.employee = User.objects.create_user(
            username='wh_emp', password='pass12345', role=employee_role
        )
        self.wh = Warehouse.objects.create(code='WH-RBAC', name='RBAC WH')
        self.client = APIClient()

    def test_employee_cannot_create_rack(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.post(
            '/api/racks/',
            {'warehouse': self.wh.id, 'code': 'R-EMP', 'name': 'Emp Rack'},
            format='json',
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_can_create_rack(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            '/api/racks/',
            {'warehouse': self.wh.id, 'code': 'R-ADM', 'name': 'Admin Rack'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['code'], 'R-ADM')


class OverAllocationTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='over_alloc', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        cat = Category.objects.create(code='OA', name='Over Alloc')
        vendor = Vendor.objects.create(code='OAV', name='OA Vendor')
        item = Item.objects.create(
            item_code='OA-BOLT', name='OA Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-OA', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
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
            batch_code='OA-BATCH',
            item=item,
            grn_line=line,
            received_qty=100,
            available_qty=100,
            testing_status='PASSED',
            received_at=timezone.now(),
        )
        wh = Warehouse.objects.create(code='WH-OA', name='OA WH')
        rack = Rack.objects.create(warehouse=wh, code='R-OA', name='Rack OA')
        shelf = Shelf.objects.create(rack=rack, code='A')
        self.pos1 = RackPosition.objects.create(shelf=shelf, code='01')
        self.pos2 = RackPosition.objects.create(shelf=shelf, code='02')

    def test_partial_allocations_cannot_exceed_available(self):
        first = self.client.post(
            '/api/locations/allocate/',
            {
                'batch_id': self.batch.id,
                'position_id': self.pos1.id,
                'quantity': '60',
                'allocation_type': 'ACTUAL',
            },
            format='json',
        )
        self.assertEqual(first.status_code, 201)
        second = self.client.post(
            '/api/locations/allocate/',
            {
                'batch_id': self.batch.id,
                'position_id': self.pos2.id,
                'quantity': '50',
                'allocation_type': 'ACTUAL',
            },
            format='json',
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data['code'], 'INVALID_QTY')
        from django.db.models import Sum

        total = (
            StockAllocation.objects.filter(
                batch=self.batch, allocation_type='ACTUAL', is_active=True
            ).aggregate(total=Sum('quantity'))['total']
            or Decimal('0')
        )
        self.assertEqual(total, Decimal('60'))


@skipIf(connection.vendor == 'sqlite', 'Parallel withdraw locking requires PostgreSQL')
class ConcurrentWithdrawParallelTests(TransactionTestCase):
    """True parallel withdraw attempts against select_for_update stock lock."""

    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='conc_par', password='pass12345', role=role)
        cat = Category.objects.create(code='CP', name='Conc Par')
        vendor = Vendor.objects.create(code='CPV', name='Conc Par Vendor')
        item = Item.objects.create(
            item_code='CP-BOLT', name='CP Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-CP', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
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
            batch_code='CP-BATCH',
            item=item,
            grn_line=line,
            received_qty=10,
            available_qty=10,
            testing_status='PASSED',
            received_at=timezone.now(),
        )

    def test_parallel_withdraws_do_not_overdraw(self):
        from concurrent.futures import ThreadPoolExecutor, as_completed

        batch_id = self.batch.id
        user_id = self.user.id

        def attempt(qty: str):
            client = APIClient()
            user = User.objects.get(pk=user_id)
            client.force_authenticate(user=user)
            return client.post(
                '/api/withdrawals/',
                {'purpose': 'SHIPMENT', 'batch_id': batch_id, 'quantity': qty},
                format='json',
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(attempt, '7'), pool.submit(attempt, '7')]
            statuses = [f.result() for f in as_completed(futures)]

        self.assertEqual(statuses.count(201), 1)
        self.assertTrue(any(s >= 400 for s in statuses))
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.available_qty, Decimal('3'))


class RackMapViewTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='map_admin', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        cat = Category.objects.create(code='MAP', name='Map Cat')
        vendor = Vendor.objects.create(code='MAPV', name='Map Vendor')
        item = Item.objects.create(
            item_code='MAP-BOLT', name='Map Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-MAP', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line = GRNLine.objects.create(
            grn=grn,
            item=item,
            received_qty=50,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.batch = InventoryBatch.objects.create(
            batch_code='MAP-BATCH',
            item=item,
            grn_line=line,
            received_qty=50,
            available_qty=50,
            testing_status='PASSED',
            received_at=timezone.now(),
        )

        self.wh = Warehouse.objects.create(code='WH-MAP', name='Map WH')
        self.rack = Rack.objects.create(warehouse=self.wh, code='R-MAP', name='Rack Map')
        # Create out of natural order to verify sorting (2 before 10).
        shelf_b = Shelf.objects.create(rack=self.rack, code='10')
        shelf_a = Shelf.objects.create(rack=self.rack, code='2')
        self.pos_empty = RackPosition.objects.create(shelf=shelf_a, code='10')
        self.pos_stock = RackPosition.objects.create(shelf=shelf_a, code='2')
        RackPosition.objects.create(shelf=shelf_b, code='1')

        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=self.batch,
            position=self.pos_stock,
            quantity=Decimal('12'),
            is_active=True,
        )

    def test_map_returns_rows_cells_and_occupancy(self):
        res = self.client.get(f'/api/racks/{self.rack.id}/map/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['rack']['code'], 'R-MAP')
        self.assertEqual(res.data['summary']['shelves'], 2)
        self.assertEqual(res.data['summary']['cells'], 3)
        self.assertEqual(res.data['summary']['occupied'], 1)
        self.assertEqual(res.data['summary']['empty'], 2)

        # Natural order: shelf "2" then "10"
        shelf_codes = [row['shelf_code'] for row in res.data['rows']]
        self.assertEqual(shelf_codes, ['2', '10'])

        first_row = res.data['rows'][0]
        pos_codes = [c['position_code'] for c in first_row['cells']]
        self.assertEqual(pos_codes, ['2', '10'])

        occupied = next(c for c in first_row['cells'] if c['position_id'] == self.pos_stock.id)
        self.assertTrue(occupied['occupied'])
        self.assertEqual(occupied['stock_count'], 1)
        self.assertEqual(occupied['stock'][0]['batch_code'], 'MAP-BATCH')
        self.assertEqual(Decimal(occupied['stock'][0]['quantity']), Decimal('12'))

    def test_map_missing_rack_returns_404(self):
        res = self.client.get('/api/racks/999999/map/')
        self.assertEqual(res.status_code, 404)


class MasterDataCrudAndSearchTests(TestCase):
    def setUp(self):
        admin_role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        employee_role, _ = Role.objects.get_or_create(
            code='WAREHOUSE_EMPLOYEE', defaults={'name': 'Warehouse Employee'}
        )
        self.admin = User.objects.create_user(username='md_admin', password='pass12345', role=admin_role)
        self.employee = User.objects.create_user(
            username='md_emp', password='pass12345', role=employee_role
        )
        self.client = APIClient()
        self.wh = Warehouse.objects.create(code='WH-MD', name='Master Data WH')
        self.rack = Rack.objects.create(warehouse=self.wh, code='R-MD', name='Rack MD')
        shelf = Shelf.objects.create(rack=self.rack, code='A')
        self.pos = RackPosition.objects.create(shelf=shelf, code='01')
        cat = Category.objects.create(code='MD', name='MD Cat')
        vendor = Vendor.objects.create(code='MDV', name='MD Vendor')
        self.item = Item.objects.create(
            item_code='MD-BOLT', name='MD Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-MD', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line = GRNLine.objects.create(
            grn=grn,
            item=self.item,
            received_qty=40,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.batch = InventoryBatch.objects.create(
            batch_code='MD-BATCH',
            item=self.item,
            grn_line=line,
            received_qty=40,
            available_qty=40,
            testing_status='PENDING',
            received_at=timezone.now(),
        )
        self.alloc = StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=self.batch,
            position=self.pos,
            quantity=Decimal('40'),
            is_active=True,
        )

    def test_employee_cannot_patch_warehouse_or_deallocate(self):
        self.client.force_authenticate(user=self.employee)
        wh = self.client.patch(
            f'/api/warehouses/{self.wh.id}/', {'name': 'Hacked'}, format='json'
        )
        self.assertEqual(wh.status_code, 403)
        de = self.client.post(
            '/api/locations/deallocate/',
            {'allocation_id': self.alloc.id},
            format='json',
        )
        self.assertEqual(de.status_code, 403)

    def test_admin_can_update_warehouse_rack_item_and_testing(self):
        self.client.force_authenticate(user=self.admin)
        wh = self.client.patch(
            f'/api/warehouses/{self.wh.id}/',
            {'name': 'Updated WH', 'is_active': True},
            format='json',
        )
        self.assertEqual(wh.status_code, 200)
        self.assertEqual(wh.data['name'], 'Updated WH')

        rack = self.client.patch(
            f'/api/racks/{self.rack.id}/', {'name': 'Updated Rack'}, format='json'
        )
        self.assertEqual(rack.status_code, 200)
        self.assertEqual(rack.data['name'], 'Updated Rack')

        item = self.client.post(
            '/api/inventory/items/',
            {
                'item_code': 'MD-NEW',
                'name': 'New Item',
                'inventory_type': 'BULK',
                'uom': 'EA',
                'category_code_input': 'MD-NEW-CAT',
            },
            format='json',
        )
        self.assertEqual(item.status_code, 201)
        self.assertEqual(item.data['item_code'], 'MD-NEW')

        ts = self.client.patch(
            f'/api/inventory/batches/{self.batch.id}/',
            {'testing_status': 'PASSED'},
            format='json',
        )
        self.assertEqual(ts.status_code, 200)
        self.assertEqual(ts.data['testing_status'], 'PASSED')

    def test_admin_deallocate_clears_active_allocation(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            '/api/locations/deallocate/',
            {'allocation_id': self.alloc.id, 'reason': 'Correction'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.alloc.refresh_from_db()
        self.assertFalse(self.alloc.is_active)
        map_res = self.client.get(f'/api/racks/{self.rack.id}/map/')
        cell = map_res.data['rows'][0]['cells'][0]
        self.assertFalse(cell['occupied'])

    def test_search_racks_and_locations(self):
        self.client.force_authenticate(user=self.employee)
        racks = self.client.get('/api/racks/', {'q': 'R-MD'})
        self.assertEqual(racks.status_code, 200)
        self.assertTrue(any(r['code'] == 'R-MD' for r in racks.data))

        locs = self.client.get('/api/locations/', {'q': 'WH-MD'})
        self.assertEqual(locs.status_code, 200)
        self.assertTrue(any(l['warehouse'] == 'WH-MD' for l in locs.data))

    def test_inactive_warehouse_hidden_unless_flag(self):
        self.wh.is_active = False
        self.wh.save(update_fields=['is_active'])
        self.client.force_authenticate(user=self.employee)
        hidden = self.client.get('/api/warehouses/')
        self.assertFalse(any(w['id'] == self.wh.id for w in hidden.data))

        self.client.force_authenticate(user=self.admin)
        shown = self.client.get('/api/warehouses/', {'include_inactive': '1'})
        self.assertTrue(any(w['id'] == self.wh.id for w in shown.data))

    def test_employee_cannot_delete_master_data(self):
        self.client.force_authenticate(user=self.employee)
        self.assertEqual(self.client.delete(f'/api/warehouses/{self.wh.id}/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/racks/{self.rack.id}/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/inventory/items/{self.item.id}/').status_code, 403)

    def test_admin_can_delete_unused_item_and_blocked_when_stocked(self):
        self.client.force_authenticate(user=self.admin)
        # Item with batches cannot be hard-deleted
        blocked = self.client.delete(f'/api/inventory/items/{self.item.id}/')
        self.assertEqual(blocked.status_code, 409)

        created = self.client.post(
            '/api/inventory/items/',
            {
                'item_code': 'MD-DEL',
                'name': 'Disposable',
                'inventory_type': 'BULK',
                'uom': 'EA',
                'category_code_input': 'MD-DEL-CAT',
            },
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        deleted = self.client.delete(f'/api/inventory/items/{created.data["id"]}/')
        self.assertEqual(deleted.status_code, 204)

    def test_employee_cannot_patch_testing_or_upload_image(self):
        self.client.force_authenticate(user=self.employee)
        ts = self.client.patch(
            f'/api/inventory/batches/{self.batch.id}/',
            {'testing_status': 'PASSED'},
            format='json',
        )
        self.assertEqual(ts.status_code, 403)

        img = self.client.post(
            f'/api/inventory/items/{self.item.id}/image/',
            {},
            format='multipart',
        )
        self.assertEqual(img.status_code, 403)

    def test_employee_cannot_get_inactive_master_detail(self):
        self.wh.is_active = False
        self.wh.save(update_fields=['is_active'])
        self.rack.is_active = False
        self.rack.save(update_fields=['is_active'])
        self.item.is_active = False
        self.item.save(update_fields=['is_active'])

        self.client.force_authenticate(user=self.employee)
        self.assertEqual(self.client.get(f'/api/warehouses/{self.wh.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/racks/{self.rack.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/inventory/items/{self.item.id}/').status_code, 404)

        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get(f'/api/warehouses/{self.wh.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/racks/{self.rack.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/inventory/items/{self.item.id}/').status_code, 200)

    def test_allocate_rejected_on_inactive_rack(self):
        self.rack.is_active = False
        self.rack.save(update_fields=['is_active'])
        self.client.force_authenticate(user=self.employee)
        res = self.client.post(
            '/api/locations/allocate/',
            {
                'batch_id': self.batch.id,
                'position_id': self.pos.id,
                'quantity': '1',
                'allocation_type': 'ACTUAL',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data.get('code'), 'INACTIVE_LOCATION')

    def test_rack_create_requires_warehouse_and_code(self):
        self.client.force_authenticate(user=self.admin)
        missing = self.client.post('/api/racks/', {'name': 'No code'}, format='json')
        self.assertEqual(missing.status_code, 400)
