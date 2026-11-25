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


class BadIdHandlingTests(WithdrawalAllocationSyncTests):
    """Unknown or malformed ids must return 400/404, never a 500."""

    test_withdrawal_reduces_rack_allocation_quantity = None
    test_api_withdrawal_keeps_allocation_in_sync = None

    def test_withdrawal_create_missing_batch_or_unit_is_404(self):
        for payload in ({'batch_id': 999999, 'quantity': '1'}, {'unit_id': 999999}):
            res = self.client.post(
                '/api/withdrawals/', {'purpose': 'SHIPMENT', **payload}, format='json'
            )
            self.assertEqual(res.status_code, 404, payload)
            self.assertEqual(res.data['code'], 'NOT_FOUND')

    def test_withdrawal_validate_bad_input_is_4xx(self):
        cases = [
            ({'batch_id': 999999, 'quantity': '1'}, 404),
            ({'batch_id': 'abc', 'quantity': '1'}, 400),
            ({'unit_id': 'abc'}, 400),
            ({'batch_id': self.batch.id, 'quantity': 'lots'}, 400),
            ({'batch_id': self.batch.id, 'quantity': 'NaN'}, 400),
        ]
        for payload, expected in cases:
            res = self.client.post('/api/withdrawals/validate/', payload, format='json')
            self.assertEqual(res.status_code, expected, payload)

    def test_withdrawal_pdf_missing_is_404(self):
        self.assertEqual(self.client.get('/api/withdrawals/999999/pdf/').status_code, 404)

    def test_allocate_bad_ids_and_qty_are_4xx(self):
        cases = [
            ({'position_id': 999999, 'batch_id': self.batch.id, 'quantity': '1'}, 404),
            ({'position_id': 'x', 'batch_id': self.batch.id, 'quantity': '1'}, 400),
            ({'position_id': self.pos.id, 'batch_id': 999999, 'quantity': '1'}, 404),
            ({'position_id': self.pos.id, 'unit_id': 999999}, 404),
            ({'position_id': self.pos.id, 'batch_id': self.batch.id, 'quantity': 'abc'}, 400),
            (
                {
                    'position_id': self.pos.id,
                    'batch_id': self.batch.id,
                    'quantity': '1',
                    'allocation_type': 'BOGUS',
                },
                400,
            ),
        ]
        for payload, expected in cases:
            res = self.client.post('/api/locations/allocate/', payload, format='json')
            self.assertEqual(res.status_code, expected, payload)

    def test_transfer_missing_positions_or_stock_are_404(self):
        cases = [
            {'from_position_id': self.pos.id, 'to_position_id': 999999},
            {'from_position_id': 999999, 'to_position_id': self.pos.id},
        ]
        for ids in cases:
            res = self.client.post(
                '/api/locations/transfer/',
                {**ids, 'batch_id': self.batch.id, 'quantity': '1'},
                format='json',
            )
            self.assertEqual(res.status_code, 404, ids)

    def test_rack_inventory_and_history_missing_are_404(self):
        self.assertEqual(self.client.get('/api/racks/999999/inventory/').status_code, 404)
        self.assertEqual(
            self.client.get('/api/inventory/batch/999999/history/').status_code, 404
        )
        self.assertEqual(self.client.get('/api/inventory/unit/999999/history/').status_code, 404)
        self.assertEqual(
            self.client.get(f'/api/inventory/batch/{self.batch.id}/history/').status_code, 200
        )
        self.assertEqual(
            self.client.get(f'/api/racks/{self.pos.shelf.rack_id}/inventory/').status_code, 200
        )
