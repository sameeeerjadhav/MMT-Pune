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
