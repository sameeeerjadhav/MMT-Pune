from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from config.factories import WarehouseTestMixin


class AlertsTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        self.today = timezone.localdate()

    def alerts(self, query='', api=None):
        return (api or self.emp_api).get(f'/api/alerts/{query}')

    def test_low_stock_uses_only_passed_available_stock(self):
        bolt = self.make_item('BOLT', 'BULK', reorder_level=Decimal('50'))
        self.make_batch(bolt, 30)  # passed
        self.make_batch(bolt, 500, testing='PENDING')  # not withdrawable, must not count
        data = self.alerts().data
        row = data['low_stock'][0]
        self.assertEqual(row['item_code'], 'BOLT')
        self.assertEqual(Decimal(row['available_qty']), Decimal('30'))
        self.assertFalse(row['out_of_stock'])

    def test_units_count_toward_stock(self):
        tv = self.make_item('TV', 'UNIT', reorder_level=Decimal('2'))
        self.make_unit(tv)
        self.make_unit(tv)
        self.make_unit(tv)
        self.assertEqual(self.alerts().data['low_stock'], [])  # 3 > 2
        unit = self.make_unit(tv)
        unit.status = 'WITHDRAWN'
        unit.save()
        self.assertEqual(self.alerts().data['low_stock'], [])
        tv.reorder_level = Decimal('3')
        tv.save()
        self.assertEqual(len(self.alerts().data['low_stock']), 1)

    def test_zero_reorder_level_is_not_monitored_and_empty_item_is_out_of_stock(self):
        self.make_item('QUIET', 'BULK')  # reorder_level 0 -> off
        empty = self.make_item('EMPTY', 'BULK', reorder_level=Decimal('10'))
        rows = self.alerts().data['low_stock']
        self.assertEqual([r['item_code'] for r in rows], [empty.item_code])
        self.assertTrue(rows[0]['out_of_stock'])

    def test_emptiest_item_first(self):
        a = self.make_item('A', 'BULK', reorder_level=Decimal('100'))
        b = self.make_item('B', 'BULK', reorder_level=Decimal('100'))
        self.make_batch(a, 90)
        self.make_batch(b, 10)
        self.assertEqual([r['item_code'] for r in self.alerts().data['low_stock']], ['B', 'A'])

    def test_expiry_buckets_and_window(self):
        item = self.make_item('MILK', 'BULK')
        self.make_batch(item, 5, code='GONE', expiry=self.today - timedelta(days=1))
        self.make_batch(item, 5, code='SOON', expiry=self.today + timedelta(days=10))
        self.make_batch(item, 5, code='LATER', expiry=self.today + timedelta(days=90))
        empty = self.make_batch(item, 5, code='USED', expiry=self.today - timedelta(days=5))
        empty.available_qty = 0
        empty.save()
        data = self.alerts().data
        self.assertEqual([r['batch_code'] for r in data['expired']], ['GONE'])
        self.assertEqual([r['batch_code'] for r in data['expiring_soon']], ['SOON'])
        self.assertEqual(data['expiring_soon'][0]['days_left'], 10)
        wide = self.alerts('?days=120').data
        self.assertEqual({r['batch_code'] for r in wide['expiring_soon']}, {'SOON', 'LATER'})
        self.assertEqual(data['summary']['total'], 2)

    def test_batch_expiring_today_is_soon_not_expired(self):
        item = self.make_item('X', 'BULK')
        self.make_batch(item, 1, code='TODAY', expiry=self.today)
        data = self.alerts().data
        self.assertEqual(data['expired'], [])
        self.assertEqual(data['expiring_soon'][0]['days_left'], 0)

    def test_days_param_is_clamped(self):
        self.assertEqual(self.alerts('?days=99999').data['window_days'], 365)
        self.assertEqual(self.alerts('?days=0').data['window_days'], 1)

    def test_dashboard_carries_the_summary(self):
        self.make_item('EMPTY', 'BULK', reorder_level=Decimal('1'))
        res = self.admin_api.get('/api/dashboard/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['stock_alerts']['low_stock'], 1)

    def test_requires_login(self):
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get('/api/alerts/').status_code, 401)


class ExpiryAndReorderEditingTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        self.item = self.make_item('BOLT', 'BULK')
        self.batch = self.make_batch(self.item, 10)

    def test_set_and_clear_expiry_date(self):
        url = f'/api/inventory/batches/{self.batch.id}/'
        res = self.super_api.patch(url, {'expiry_date': '2027-03-01'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.batch.refresh_from_db()
        self.assertEqual(str(self.batch.expiry_date), '2027-03-01')
        self.assertEqual(self.super_api.patch(url, {'expiry_date': None}, format='json').status_code, 200)
        self.batch.refresh_from_db()
        self.assertIsNone(self.batch.expiry_date)

    def test_patch_needs_at_least_one_field_and_valid_values(self):
        url = f'/api/inventory/batches/{self.batch.id}/'
        self.assertEqual(self.super_api.patch(url, {}, format='json').status_code, 400)
        self.assertEqual(self.super_api.patch(url, {'expiry_date': 'soon'}, format='json').status_code, 400)
        self.assertEqual(self.super_api.patch(url, {'testing_status': 'MAYBE'}, format='json').status_code, 400)

    def test_testing_status_can_still_be_changed(self):
        url = f'/api/inventory/batches/{self.batch.id}/'
        self.assertEqual(self.super_api.patch(url, {'testing_status': 'FAILED'}, format='json').status_code, 200)
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.testing_status, 'FAILED')

    def test_item_reorder_level_validation(self):
        url = f'/api/inventory/items/{self.item.id}/'
        ok = self.admin_api.patch(url, {'reorder_level': '25'}, format='json')
        self.assertEqual(ok.status_code, 200, ok.content)
        self.item.refresh_from_db()
        self.assertEqual(self.item.reorder_level, Decimal('25'))
        self.assertEqual(self.admin_api.patch(url, {'reorder_level': '-1'}, format='json').status_code, 400)
