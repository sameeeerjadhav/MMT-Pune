from decimal import Decimal

from django.test import TestCase

from audit.models import AuditLog, IdempotencyRecord
from config.factories import WarehouseTestMixin
from counts.models import CountLine, CountSession
from inventory.models import StockAllocation


class CountApiTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        self.rack, (self.p1, self.p2) = self.make_rack('R1')
        self.other_rack, (self.o1, _) = self.make_rack('R2')
        self.bolt = self.make_item('BOLT', 'BULK')
        self.tv = self.make_item('TV', 'UNIT')
        self.batch = self.make_batch(self.bolt, 100)
        self.unit_a = self.make_unit(self.tv)
        self.unit_b = self.make_unit(self.tv)
        self.allocate(self.p1, batch=self.batch, qty=100)
        self.allocate(self.p1, unit=self.unit_a)
        self.allocate(self.p2, unit=self.unit_b)

    def start(self, api=None, rack=None):
        res = (api or self.emp_api).post('/api/counts/', {'rack_id': (rack or self.rack).id}, format='json')
        self.assertIn(res.status_code, (200, 201), res.content)
        return res.data

    def scan(self, session_id, barcode, quantity=None, api=None, **headers):
        body = {'barcode': barcode.value}
        if quantity is not None:
            body['quantity'] = quantity
        return (api or self.emp_api).post(f'/api/counts/{session_id}/scan/', body, format='json', **headers)

    def rows(self, session_id):
        data = self.emp_api.get(f'/api/counts/{session_id}/').data
        return {r['code']: r for r in data['variance']['rows']}, data

    # --- sessions ---------------------------------------------------------------------------

    def test_start_creates_session_and_resumes_the_open_one(self):
        first = self.start()
        self.assertEqual(first['status'], 'OPEN')
        self.assertFalse(first['resumed'])
        again = self.start(api=self.emp2_api)
        self.assertTrue(again['resumed'])
        self.assertEqual(again['id'], first['id'])
        self.assertEqual(CountSession.objects.count(), 1)

    def test_start_rejects_unknown_rack(self):
        res = self.emp_api.post('/api/counts/', {'rack_id': 99999}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_requires_authentication(self):
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get('/api/counts/').status_code, 401)

    # --- scanning & variance ----------------------------------------------------------------

    def test_nothing_scanned_everything_is_missing(self):
        sid = self.start()['id']
        rows, data = self.rows(sid)
        self.assertEqual({r['status'] for r in rows.values()}, {'MISSING'})
        self.assertEqual(set(rows), {self.batch.batch_code, self.unit_a.unit_code, self.unit_b.unit_code})
        self.assertEqual(data['variance']['counts']['MISSING'], 3)

    def test_full_match(self):
        sid = self.start()['id']
        self.assertEqual(self.scan(sid, self.batch.barcode, 100).status_code, 201)
        self.scan(sid, self.unit_a.barcode)
        self.scan(sid, self.unit_b.barcode)
        _, data = self.rows(sid)
        self.assertEqual(data['variance']['counts']['MATCH'], 3)
        self.assertEqual(data['variance']['differences'], 0)

    def test_short_over_and_missing(self):
        sid = self.start()['id']
        self.scan(sid, self.batch.barcode, 90)
        self.scan(sid, self.unit_a.barcode)
        rows, _ = self.rows(sid)
        self.assertEqual(rows[self.batch.batch_code]['status'], 'SHORT')
        self.assertEqual(rows[self.batch.batch_code]['difference'], '-10')
        self.assertEqual(rows[self.unit_b.unit_code]['status'], 'MISSING')
        self.scan(sid, self.batch.barcode, 120)
        rows, _ = self.rows(sid)
        self.assertEqual(rows[self.batch.batch_code]['status'], 'OVER')
        self.assertEqual(rows[self.batch.batch_code]['difference'], '20')

    def test_batch_rescan_replaces_quantity_unit_rescan_is_noop(self):
        sid = self.start()['id']
        self.scan(sid, self.batch.barcode, 50)
        res = self.scan(sid, self.batch.barcode, 70)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['created'])
        self.assertEqual(CountLine.objects.get(session_id=sid, batch=self.batch).quantity, Decimal('70'))
        self.scan(sid, self.unit_a.barcode)
        again = self.scan(sid, self.unit_a.barcode)
        self.assertFalse(again.data['created'])
        self.assertEqual(CountLine.objects.filter(session_id=sid).count(), 2)

    def test_item_found_in_wrong_rack_is_unexpected_with_system_location(self):
        stray = self.make_unit(self.tv)
        self.allocate(self.o1, unit=stray)
        sid = self.start()['id']
        res = self.scan(sid, stray.barcode)
        self.assertFalse(res.data['expected_here'])
        self.assertIn('R2', res.data['system_location'])
        rows, _ = self.rows(sid)
        self.assertEqual(rows[stray.unit_code]['status'], 'UNEXPECTED')

    def test_unallocated_batch_is_unexpected(self):
        loose = self.make_batch(self.bolt, 5)
        sid = self.start()['id']
        res = self.scan(sid, loose.barcode, 5)
        self.assertFalse(res.data['expected_here'])
        self.assertEqual(res.data['system_location'], 'Not allocated')

    def test_scan_validation(self):
        sid = self.start()['id']
        self.assertEqual(self.emp_api.post(f'/api/counts/{sid}/scan/', {}, format='json').status_code, 400)
        self.assertEqual(
            self.emp_api.post(f'/api/counts/{sid}/scan/', {'barcode': 'NOPE'}, format='json').status_code, 404
        )
        # a batch needs a counted quantity
        self.assertEqual(self.scan(sid, self.batch.barcode).status_code, 400)
        self.assertEqual(self.scan(sid, self.batch.barcode, 0).status_code, 400)
        self.assertEqual(self.scan(sid, self.batch.barcode, 'abc').status_code, 400)
        self.assertEqual(self.scan(sid, self.batch.barcode, 'NaN').status_code, 400)
        # rack labels can't be counted
        from barcodes.models import Barcode
        from barcodes.services import create_barcode

        rack_code = create_barcode(Barcode.EntityType.RACK, self.rack.id)
        self.assertEqual(self.scan(sid, rack_code).status_code, 400)

    def test_future_scanned_at_is_clamped(self):
        sid = self.start()['id']
        res = self.emp_api.post(
            f'/api/counts/{sid}/scan/',
            {'barcode': self.unit_a.barcode.value, 'scanned_at': '2999-01-01T00:00:00Z'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        from django.utils import timezone

        self.assertLessEqual(CountLine.objects.get(session_id=sid).scanned_at, timezone.now())

    def test_undo_scan(self):
        sid = self.start()['id']
        line_id = self.scan(sid, self.unit_a.barcode).data['line']['id']
        res = self.emp_api.delete(f'/api/counts/{sid}/lines/{line_id}/')
        self.assertEqual(res.status_code, 204)
        self.assertEqual(CountLine.objects.filter(session_id=sid).count(), 0)
        self.assertEqual(self.emp_api.delete(f'/api/counts/{sid}/lines/{line_id}/').status_code, 404)

    # --- permissions ------------------------------------------------------------------------

    def test_only_starter_or_lead_can_change_an_open_count(self):
        sid = self.start()['id']
        self.assertEqual(self.scan(sid, self.unit_a.barcode, api=self.emp2_api).status_code, 403)
        self.assertEqual(self.scan(sid, self.unit_a.barcode, api=self.super_api).status_code, 201)
        self.assertEqual(self.emp2_api.post(f'/api/counts/{sid}/submit/').status_code, 403)
        # anyone on staff can still read it
        self.assertEqual(self.emp2_api.get(f'/api/counts/{sid}/').status_code, 200)

    # --- submit -----------------------------------------------------------------------------

    def test_submit_freezes_the_result_and_writes_audit_log(self):
        sid = self.start()['id']
        self.scan(sid, self.batch.barcode, 90)
        res = self.emp_api.post(f'/api/counts/{sid}/submit/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'SUBMITTED')
        self.assertEqual(res.data['variance']['counts']['SHORT'], 1)
        log = AuditLog.objects.get(action='COUNT_SUBMIT')
        self.assertEqual(log.entity_id, sid)
        self.assertEqual(log.user, self.employee)

        # Stock moves afterwards must not rewrite the submitted result.
        StockAllocation.objects.filter(unit=self.unit_a).update(is_active=False)
        _, data = self.rows(sid)
        self.assertEqual(data['variance']['counts']['MISSING'], 2)
        # Submitting never touches stock.
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.available_qty, Decimal('100'))

    def test_submitted_count_is_read_only_and_a_new_one_can_start(self):
        sid = self.start()['id']
        self.emp_api.post(f'/api/counts/{sid}/submit/')
        self.assertEqual(self.scan(sid, self.unit_a.barcode).status_code, 409)
        self.assertEqual(self.emp_api.post(f'/api/counts/{sid}/submit/').status_code, 409)
        fresh = self.start()
        self.assertNotEqual(fresh['id'], sid)
        self.assertFalse(fresh['resumed'])

    def test_list_filters(self):
        a = self.start()['id']
        self.start(api=self.emp2_api, rack=self.other_rack)
        self.emp_api.post(f'/api/counts/{a}/submit/')
        self.assertEqual(len(self.emp_api.get('/api/counts/').data), 2)
        self.assertEqual(len(self.emp_api.get('/api/counts/?status=OPEN').data), 1)
        self.assertEqual(len(self.emp_api.get('/api/counts/?mine=1').data), 1)
        self.assertEqual(len(self.emp_api.get(f'/api/counts/?rack_id={self.rack.id}').data), 1)
        submitted = self.emp_api.get('/api/counts/?status=SUBMITTED').data[0]
        self.assertIn('differences', submitted)

    # --- CSV --------------------------------------------------------------------------------

    def test_variance_csv_is_for_leads_only(self):
        sid = self.start()['id']
        self.scan(sid, self.batch.barcode, 90)
        self.assertEqual(self.emp_api.get(f'/api/counts/{sid}/variance.csv').status_code, 403)
        res = self.super_api.get(f'/api/counts/{sid}/variance.csv')
        self.assertEqual(res.status_code, 200)
        text = res.content.decode('utf-8')
        self.assertTrue(text.startswith('\ufeffStatus,Type,Code'))
        self.assertIn('SHORT,BATCH,' + self.batch.batch_code, text)
        self.assertIn('MISSING,UNIT,' + self.unit_a.unit_code, text)


class IdempotencyTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        self.rack, (self.p1, self.p2) = self.make_rack('R1')
        self.item = self.make_item('BOLT', 'BULK')
        self.batch = self.make_batch(self.item, 100)

    def allocated_total(self):
        allocations = StockAllocation.objects.filter(batch=self.batch, is_active=True)
        return sum((a.quantity for a in allocations), Decimal('0'))

    def allocate_body(self, qty=40):
        return {'position_id': self.p1.id, 'batch_id': self.batch.id, 'quantity': qty}

    def test_replayed_allocate_is_applied_once(self):
        url = '/api/locations/allocate/'
        key = {'HTTP_IDEMPOTENCY_KEY': 'abc-123'}
        first = self.emp_api.post(url, self.allocate_body(), format='json', **key)
        self.assertEqual(first.status_code, 201, first.content)
        second = self.emp_api.post(url, self.allocate_body(), format='json', **key)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second['Idempotent-Replay'], 'true')
        self.assertEqual(second.data['id'], first.data['id'])
        self.assertEqual(self.allocated_total(), Decimal('40'))

    def test_without_a_key_nothing_is_deduplicated(self):
        url = '/api/locations/allocate/'
        self.emp_api.post(url, self.allocate_body(30), format='json')
        self.emp_api.post(url, self.allocate_body(30), format='json')
        self.assertEqual(self.allocated_total(), Decimal('60'))

    def test_failed_request_does_not_burn_the_key(self):
        url = '/api/locations/allocate/'
        key = {'HTTP_IDEMPOTENCY_KEY': 'retry-me'}
        bad = self.emp_api.post(url, {'position_id': self.p1.id, 'batch_id': 999999, 'quantity': 1}, format='json', **key)
        self.assertGreaterEqual(bad.status_code, 400)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)
        good = self.emp_api.post(url, self.allocate_body(), format='json', **key)
        self.assertEqual(good.status_code, 201)
        self.assertNotIn('Idempotent-Replay', good)

    def test_same_key_on_a_different_endpoint_is_a_conflict(self):
        key = {'HTTP_IDEMPOTENCY_KEY': 'shared'}
        self.emp_api.post('/api/locations/allocate/', self.allocate_body(), format='json', **key)
        res = self.emp_api.post(
            '/api/locations/transfer/',
            {'from_position_id': self.p1.id, 'to_position_id': self.p2.id, 'batch_id': self.batch.id, 'quantity': 1},
            format='json',
            **key,
        )
        self.assertEqual(res.status_code, 409)

    def test_keys_are_per_user(self):
        url = '/api/locations/allocate/'
        key = {'HTTP_IDEMPOTENCY_KEY': 'same-key'}
        a = self.emp_api.post(url, self.allocate_body(20), format='json', **key)
        b = self.emp2_api.post(url, self.allocate_body(20), format='json', **key)
        self.assertEqual(a.status_code, 201)
        self.assertEqual(b.status_code, 201)
        self.assertNotIn('Idempotent-Replay', b)
        self.assertEqual(self.allocated_total(), Decimal('40'))

    def test_overlong_key_is_rejected(self):
        res = self.emp_api.post(
            '/api/locations/allocate/', self.allocate_body(), format='json', HTTP_IDEMPOTENCY_KEY='x' * 101
        )
        self.assertEqual(res.status_code, 400)

    def test_replayed_scan_is_not_applied_twice(self):
        rack_unit = self.make_unit(self.make_item('TV', 'UNIT'))
        self.allocate(self.p1, unit=rack_unit)
        sid = self.emp_api.post('/api/counts/', {'rack_id': self.rack.id}, format='json').data['id']
        key = {'HTTP_IDEMPOTENCY_KEY': 'scan-1'}
        body = {'barcode': rack_unit.barcode.value}
        first = self.emp_api.post(f'/api/counts/{sid}/scan/', body, format='json', **key)
        second = self.emp_api.post(f'/api/counts/{sid}/scan/', body, format='json', **key)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second['Idempotent-Replay'], 'true')
        self.assertEqual(CountLine.objects.count(), 1)
