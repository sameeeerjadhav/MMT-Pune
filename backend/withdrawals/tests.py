from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from grn.models import GRN, GRNLine
from inventory.models import Category, InventoryBatch, Item, StockAllocation, Vendor
from warehouses.models import Rack, RackPosition, Shelf, Warehouse
from withdrawals.services import create_withdrawal

User = get_user_model()


class WithdrawalAllocationSyncTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='wd_alloc', password='pass12345', role=role)
        cat = Category.objects.create(code='WA', name='Withdraw Alloc')
        vendor = Vendor.objects.create(code='WAV', name='WA Vendor')
        item = Item.objects.create(
            item_code='WA-BOLT', name='WA Bolt', category=cat, inventory_type='BULK'
        )
        grn = GRN.objects.create(
            grn_number='G-WA', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
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
            batch_code='WA-BATCH',
            item=item,
            grn_line=line,
            received_qty=100,
            available_qty=100,
            testing_status='PASSED',
            received_at=timezone.now(),
        )
        wh = Warehouse.objects.create(code='WH-WA', name='WA WH')
        rack = Rack.objects.create(warehouse=wh, code='R-WA', name='Rack WA')
        shelf = Shelf.objects.create(rack=rack, code='A')
        self.pos = RackPosition.objects.create(shelf=shelf, code='01')
        StockAllocation.objects.create(
            allocation_type='ACTUAL',
            batch=self.batch,
            position=self.pos,
            quantity=Decimal('100'),
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_withdrawal_reduces_rack_allocation_quantity(self):
        create_withdrawal(
            user=self.user,
            purpose='SHIPMENT',
            batch_id=self.batch.id,
            quantity=Decimal('25'),
        )
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.available_qty, Decimal('75'))
        alloc = StockAllocation.objects.get(batch=self.batch, is_active=True, allocation_type='ACTUAL')
        self.assertEqual(alloc.quantity, Decimal('75'))

    def test_api_withdrawal_keeps_allocation_in_sync(self):
        res = self.client.post(
            '/api/withdrawals/',
            {'purpose': 'SHIPMENT', 'batch_id': self.batch.id, 'quantity': '10'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        alloc = StockAllocation.objects.get(batch=self.batch, is_active=True, allocation_type='ACTUAL')
        self.batch.refresh_from_db()
        self.assertEqual(alloc.quantity, self.batch.available_qty)
