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
from warehouses.models import Floor, Rack, RackPosition, Shelf, Warehouse

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

    def test_admin_can_resize_rack_layout(self):
        res = self.client.patch(
            f'/api/racks/{self.rack.id}/layout/',
            {'row_count': 3, 'column_count': 4},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['summary']['row_count'], 3)
        self.assertEqual(res.data['summary']['column_count'], 4)
        self.assertEqual(res.data['summary']['cells'], 12)
        self.assertTrue(res.data['can_edit_layout'])

    def test_cannot_remove_stocked_shelf(self):
        # Only keep 1 shelf — natural order drops shelf "10" first, then would drop "2" which has stock.
        # Cutting to 0 rows is invalid; cutting to 1 keeps shelf "2" (stocked) and removes "10".
        ok = self.client.patch(
            f'/api/racks/{self.rack.id}/layout/',
            {'row_count': 1, 'column_count': 2},
            format='json',
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data['summary']['row_count'], 1)
        # Trying to remove the remaining stocked shelf fails.
        bad = self.client.patch(
            f'/api/racks/{self.rack.id}/layout/',
            {'row_count': 1, 'column_count': 0},
            format='json',
        )
        self.assertEqual(bad.status_code, 400)


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


class FloorMapViewTests(TestCase):
    def setUp(self):
        admin_role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        emp_role, _ = Role.objects.get_or_create(
            code='WAREHOUSE_EMPLOYEE', defaults={'name': 'Warehouse Employee'}
        )
        self.admin = User.objects.create_user(username='floor_admin', password='pass12345', role=admin_role)
        self.employee = User.objects.create_user(username='floor_emp', password='pass12345', role=emp_role)
        self.client = APIClient()

        cat = Category.objects.create(code='FL', name='Floor Cat')
        vendor = Vendor.objects.create(code='FLV', name='Floor Vendor')
        item = Item.objects.create(
            item_code='FL-BOLT', name='Floor Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-FL', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line = GRNLine.objects.create(
            grn=grn,
            item=item,
            received_qty=40,
            uom='EA',
            testing_status='PASSED',
            classification='BULK',
        )
        self.batch = InventoryBatch.objects.create(
            batch_code='FL-BATCH',
            item=item,
            grn_line=line,
            received_qty=40,
            available_qty=40,
            testing_status='PASSED',
            received_at=timezone.now(),
        )

        self.wh = Warehouse.objects.create(code='WH-FL', name='Floor WH')
        self.floor = Floor.objects.create(
            warehouse=self.wh, code='G', name='Ground', level=1, row_count=2, column_count=3
        )
        self.rack = Rack.objects.create(
            warehouse=self.wh,
            floor=self.floor,
            code='R-FL',
            name='Floor Rack',
            row_index=1,
            column_index=2,
        )
        shelf = Shelf.objects.create(rack=self.rack, code='A')
        pos = RackPosition.objects.create(shelf=shelf, code='01')
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=self.batch,
            position=pos,
            quantity=Decimal('15'),
            is_active=True,
        )
        self.spare = Rack.objects.create(warehouse=self.wh, code='R-SPARE', name='Spare Rack')

    def test_floor_map_grid_and_stock(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.get(f'/api/floors/{self.floor.id}/map/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['floor']['code'], 'G')
        self.assertEqual(res.data['summary']['cells'], 6)
        self.assertEqual(res.data['summary']['placed_racks'], 1)
        self.assertTrue(res.data['can_edit_layout'])
        cell = res.data['grid'][0]['cells'][1]
        self.assertFalse(cell['empty'])
        self.assertEqual(cell['rack']['code'], 'R-FL')
        self.assertEqual(cell['rack']['stock_lines'], 1)
        self.assertEqual(cell['rack']['stock'][0]['batch_code'], 'FL-BATCH')

    def test_employee_sees_map_but_cannot_edit_layout(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.get(f'/api/floors/{self.floor.id}/map/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['can_edit_layout'])
        patch = self.client.patch(
            f'/api/floors/{self.floor.id}/layout/',
            {'row_count': 5, 'column_count': 5},
            format='json',
        )
        self.assertEqual(patch.status_code, 403)

    def test_admin_updates_layout_and_places_rack(self):
        self.client.force_authenticate(user=self.admin)
        patch = self.client.patch(
            f'/api/floors/{self.floor.id}/layout/',
            {'row_count': 3, 'column_count': 3},
            format='json',
        )
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(patch.data['row_count'], 3)
        place = self.client.post(
            f'/api/floors/{self.floor.id}/place-rack/',
            {'rack_id': self.spare.id, 'row_index': 2, 'column_index': 1},
            format='json',
        )
        self.assertEqual(place.status_code, 200)
        self.spare.refresh_from_db()
        self.assertEqual(self.spare.floor_id, self.floor.id)
        self.assertEqual(self.spare.row_index, 2)
        self.assertEqual(self.spare.column_index, 1)

    def test_shrink_blocked_when_stocked_rack_would_leave_grid(self):
        """Stocked rack at C2 must not be orphaned by shrinking columns to 1."""
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.rack.column_index, 2)
        blocked = self.client.patch(
            f'/api/floors/{self.floor.id}/layout/',
            {'row_count': 2, 'column_count': 1},
            format='json',
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data.get('code'), 'CELL_OCCUPIED')
        self.rack.refresh_from_db()
        self.assertEqual(self.rack.column_index, 2)
        self.assertEqual(self.floor.column_count, 3)

        # Empty outside rack can be cleared; stocked rack still blocks.
        empty = Rack.objects.create(
            warehouse=self.wh,
            floor=self.floor,
            code='R-EMPTY-EDGE',
            name='Empty edge',
            row_index=2,
            column_index=3,
        )
        still_blocked = self.client.patch(
            f'/api/floors/{self.floor.id}/layout/',
            {'row_count': 2, 'column_count': 1},
            format='json',
        )
        self.assertEqual(still_blocked.status_code, 409)

        # Growing is fine.
        grow = self.client.patch(
            f'/api/floors/{self.floor.id}/layout/',
            {'row_count': 3, 'column_count': 4},
            format='json',
        )
        self.assertEqual(grow.status_code, 200)
        empty.refresh_from_db()
        self.assertEqual(empty.column_index, 3)

    def test_employee_cannot_create_floor(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.post(
            '/api/floors/',
            {
                'warehouse_id': self.wh.id,
                'code': 'L2',
                'name': 'Level 2',
                'row_count': 2,
                'column_count': 2,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 403)


class ItemImageUploadTests(TestCase):
    def setUp(self):
        from io import BytesIO

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image as PilImage

        admin_role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.admin = User.objects.create_user(username='img_admin', password='pass12345', role=admin_role)
        cat = Category.objects.create(code='IMG', name='Img Cat')
        self.item = Item.objects.create(
            item_code='IMG-1', name='Image Item', category=cat, inventory_type='BULK'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        buf = BytesIO()
        PilImage.new('RGB', (8, 8), color=(20, 40, 60)).save(buf, format='PNG')
        self.png = SimpleUploadedFile('dot.png', buf.getvalue(), content_type='image/png')
        self.bogus = SimpleUploadedFile('x.bin', b'not-an-image', content_type='application/octet-stream')

    def test_upload_clear_and_signed_media(self):
        from io import BytesIO

        from django.core.files.uploadedfile import SimpleUploadedFile
        from PIL import Image as PilImage

        from inventory.media_urls import sign_media_name

        up = self.client.post(
            f'/api/inventory/items/{self.item.id}/image/',
            {'image': self.png},
            format='multipart',
        )
        self.assertEqual(up.status_code, 200)
        self.assertTrue(up.data.get('image_url'))
        self.assertIn('sig=', up.data['image_url'])

        # Clear before opening the file via /media/ (Windows can lock open files).
        cleared = self.client.post(
            f'/api/inventory/items/{self.item.id}/image/?clear=1',
            {'clear': True},
            format='json',
        )
        self.assertEqual(cleared.status_code, 200, cleared.content)
        self.assertIsNone(cleared.data.get('image_url'))
        self.item.refresh_from_db()
        self.assertFalse(bool(self.item.image))

        buf = BytesIO()
        PilImage.new('RGB', (8, 8), color=(9, 9, 9)).save(buf, format='PNG')
        png2 = SimpleUploadedFile('dot2.png', buf.getvalue(), content_type='image/png')
        up2 = self.client.post(
            f'/api/inventory/items/{self.item.id}/image/',
            {'image': png2},
            format='multipart',
        )
        self.assertEqual(up2.status_code, 200)
        self.item.refresh_from_db()
        media_path = self.item.image.name
        bare = self.client.get(f'/media/{media_path}')
        self.assertEqual(bare.status_code, 404)
        ok = self.client.get(f'/media/{media_path}', {'sig': sign_media_name(media_path)})
        self.assertEqual(ok.status_code, 200)
        # Fully consume streaming FileResponse so the file handle closes on Windows.
        b''.join(ok.streaming_content)

    def test_rejects_non_image_bytes(self):
        bad = self.client.post(
            f'/api/inventory/items/{self.item.id}/image/',
            {'image': self.bogus},
            format='multipart',
        )
        self.assertEqual(bad.status_code, 400)
