from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from inventory.models import Category, InventoryBatch, Item, Vendor
from grn.models import GRN, GRNLine


User = get_user_model()


class FifoApiTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        self.user = User.objects.create_user(username='tester', password='pass12345', role=role)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        cat = Category.objects.create(code='T', name='Test')
        vendor = Vendor.objects.create(code='TV', name='Test Vendor')
        item = Item.objects.create(
            item_code='TEST-BOLT', name='Test Bolt', category=cat, inventory_type='BULK'
        )
        grn1 = GRN.objects.create(
            grn_number='G-OLD', vendor=vendor, received_date=timezone.now(), external_system='MANUAL'
        )
        line1 = GRNLine.objects.create(
            grn=grn1, item=item, received_qty=100, uom='EA', testing_status='PASSED', classification='BULK'
        )
        self.old = InventoryBatch.objects.create(
            batch_code='OLD',
            item=item,
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
            grn=grn2, item=item, received_qty=50, uom='EA', testing_status='PASSED', classification='BULK'
        )
        self.new = InventoryBatch.objects.create(
            batch_code='NEW',
            item=item,
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
