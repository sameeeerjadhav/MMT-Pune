"""Bad client input must produce 4xx responses, never a 500."""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from barcodes.models import PrintLog
from config.factories import WarehouseTestMixin
from grn.models import GRN
from integrations.models import IntegrationLog
from inventory.models import InventoryBatch
from reports.pdf import build_withdrawal_receipt_pdf
from warehouses.models import Floor, Warehouse
from withdrawals.models import Withdrawal

User = get_user_model()


def _grn_payload(**overrides):
    line = {
        'item_code': 'VAL-ITEM',
        'item_name': 'Validation Item',
        'category_code': 'FC',
        'received_qty': '5',
        'uom': 'EA',
        'classification': 'BULK',
        'testing_status': 'PASSED',
    }
    line.update(overrides.pop('line', {}))
    payload = {
        'grn_number': 'GRN-VAL-1',
        'external_system': 'MOCK',
        'external_ref': 'MOCK-VAL-1',
        'received_date': timezone.now().isoformat(),
        'lines': [line],
    }
    payload.update(overrides)
    return payload


class GrnImportValidationTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()

    def post(self, payload):
        return self.admin_api.post('/api/grns/import/', payload, format='json')

    def test_bad_lines_are_400(self):
        cases = [
            {'item_code': ''},
            {'classification': None},
            {'received_qty': 'abc'},
            {'received_qty': 'NaN'},
            {'received_qty': None},
            {'testing_status': 'MAYBE'},
        ]
        for line in cases:
            res = self.post(_grn_payload(line=line))
            self.assertEqual(res.status_code, 400, line)
        self.assertFalse(GRN.objects.exists())

    def test_testing_status_is_normalised(self):
        res = self.post(_grn_payload(line={'testing_status': 'passed'}))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(InventoryBatch.objects.get().testing_status, 'PASSED')

    def test_bad_received_date_is_400(self):
        for value in ('garbage', '2026-02-30T00:00:00'):
            res = self.post(_grn_payload(received_date=value))
            self.assertEqual(res.status_code, 400, value)

    def test_date_only_received_date_is_accepted(self):
        res = self.post(_grn_payload(received_date='2026-01-15'))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(GRN.objects.get().received_date.date().isoformat(), '2026-01-15')

    def test_duplicate_is_logged(self):
        self.assertEqual(self.post(_grn_payload()).status_code, 201)
        self.assertEqual(self.post(_grn_payload()).status_code, 409)
        self.assertTrue(IntegrationLog.objects.filter(status='DUPLICATE').exists())

    def test_manual_create_is_recorded_as_manual(self):
        payload = _grn_payload()
        payload.pop('external_system')
        res = self.admin_api.post('/api/grns/', payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(GRN.objects.get().external_system, 'MANUAL')


class AccountValidationTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()

    def test_database_refuses_two_users_with_the_same_email(self):
        # A shared email would make email-login ambiguous, so the database itself forbids it
        # (any letter case). Covered end-to-end in accounts/test_email_and_lockout.py.
        User.objects.create_user(username='dup_a', email='same@example.com', role=self.admin.role)
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(username='dup_b', email='SAME@example.com', role=self.admin.role)

    def test_staff_create_rejects_duplicate_email(self):
        User.objects.create_user(username='has_mail', email='taken@example.com', role=self.admin.role)
        res = self.admin_api.post(
            '/api/users/',
            {
                'username': 'new_user',
                'password': 'pass12345',
                'email': 'TAKEN@example.com',
                'role': 'WAREHOUSE_EMPLOYEE',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)


class MasterDataValidationTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()

    def test_item_null_category_is_400(self):
        create = self.admin_api.post(
            '/api/inventory/items/',
            {'item_code': 'NOCAT', 'name': 'No cat', 'inventory_type': 'BULK', 'category': None},
            format='json',
        )
        self.assertEqual(create.status_code, 400)
        item = self.make_item()
        patch = self.admin_api.patch(
            f'/api/inventory/items/{item.id}/', {'category': None}, format='json'
        )
        self.assertEqual(patch.status_code, 400)

    def test_item_type_locked_once_stock_exists(self):
        item = self.make_item()
        self.make_batch(item)
        res = self.admin_api.patch(
            f'/api/inventory/items/{item.id}/', {'inventory_type': 'UNIT'}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_duplicate_rack_code_is_409(self):
        self.make_rack('R-DUP')
        res = self.admin_api.post(
            '/api/racks/', {'warehouse': self.warehouse.id, 'code': 'R-DUP'}, format='json'
        )
        self.assertEqual(res.status_code, 409)

    def test_rack_create_rejects_non_numeric_placement(self):
        res = self.admin_api.post(
            '/api/racks/',
            {'warehouse': self.warehouse.id, 'code': 'R-STR', 'floor_id': 'abc'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_floor_code_duplicate_is_case_insensitive(self):
        Floor.objects.create(warehouse=self.warehouse, code='F1', name='Ground')
        res = self.admin_api.post(
            '/api/floors/',
            {'warehouse_id': self.warehouse.id, 'code': 'f1', 'name': 'Again'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)

    def test_rack_patch_cannot_change_placement(self):
        rack, _ = self.make_rack('R-PATCH')
        other = Warehouse.objects.create(code='WH2', name='Other')
        res = self.admin_api.patch(
            f'/api/racks/{rack.id}/',
            {'warehouse': other.id, 'row_index': 40, 'column_index': 40, 'name': 'Renamed'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        rack.refresh_from_db()
        self.assertEqual(rack.warehouse_id, self.warehouse.id)
        self.assertIsNone(rack.row_index)
        self.assertEqual(rack.name, 'Renamed')

    def test_rack_patch_duplicate_code_is_400(self):
        self.make_rack('R-A')
        rack_b, _ = self.make_rack('R-B')
        res = self.admin_api.patch(f'/api/racks/{rack_b.id}/', {'code': 'R-A'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_non_numeric_list_filters_are_400(self):
        for url in ('/api/racks/?warehouse=abc', '/api/racks/?floor=x', '/api/floors/?warehouse=x'):
            self.assertEqual(self.admin_api.get(url).status_code, 400, url)

    def test_deallocate_bad_id_is_400(self):
        res = self.admin_api.post(
            '/api/locations/deallocate/', {'allocation_id': 'abc'}, format='json'
        )
        self.assertEqual(res.status_code, 400)


class BarcodeValidationTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()

    def test_generate_rejects_bad_label_data_and_missing_entity(self):
        batch = self.make_batch(self.make_item(), barcode=False)
        bad_label = self.emp_api.post(
            '/api/barcodes/generate/',
            {'entity_type': 'BATCH', 'entity_id': batch.id, 'label_data': 'x'},
            format='json',
        )
        self.assertEqual(bad_label.status_code, 400)
        missing = self.emp_api.post(
            '/api/barcodes/generate/', {'entity_type': 'UNIT', 'entity_id': 999999}, format='json'
        )
        self.assertEqual(missing.status_code, 404)

    def test_print_log_truncates_long_fields(self):
        batch = self.make_batch(self.make_item())
        res = self.emp_api.post(
            f'/api/barcodes/{batch.barcode.value}/print-log/',
            {'printer': 'p' * 300, 'notes': 'n' * 600},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        log = PrintLog.objects.get()
        self.assertEqual(len(log.printer), 100)
        self.assertEqual(len(log.notes), 255)


class ReceiptPdfTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()

    def test_markup_in_user_text_does_not_break_pdf(self):
        withdrawal = Withdrawal.objects.create(
            purpose='SHIPMENT', reference='<b>open', notes='a & b <i>', user=self.employee
        )
        pdf = build_withdrawal_receipt_pdf(withdrawal)
        self.assertTrue(pdf.startswith(b'%PDF'))


class CountScanDateTests(TestCase):
    def test_impossible_scanned_at_falls_back_to_now(self):
        from counts.views import _parse_scanned_at

        before = timezone.now()
        self.assertGreaterEqual(_parse_scanned_at('2026-02-30T10:00:00'), before)
