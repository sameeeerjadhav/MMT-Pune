from django.test import TestCase

from barcodes.models import Barcode, Printer, PrintLog
from config.factories import WarehouseTestMixin


class GrnBulkPrintTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        self.printer = Printer.objects.create(name='Zebra', host='10.0.0.5')
        self.grn = self.make_grn('GRN-BULK')
        bolt = self.make_item('BOLT', 'BULK')
        tv = self.make_item('TV', 'UNIT')
        self.batches = [self.make_batch(bolt, 10, grn=self.grn) for _ in range(2)]
        self.units = [self.make_unit(tv, grn=self.grn) for _ in range(3)]

    def commands(self, query='', api=None, grn=None):
        grn = grn or self.grn
        return (api or self.emp_api).get(
            f'/api/grns/{grn.id}/print-commands/?printer_id={self.printer.id}{query}'
        )

    def test_returns_every_label_with_printer_info(self):
        res = self.commands()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data['total'], 5)
        self.assertEqual(res.data['count'], 5)
        self.assertIsNone(res.data['next_offset'])
        self.assertEqual(res.data['grn_number'], 'GRN-BULK')
        self.assertEqual(res.data['host'], '10.0.0.5')
        for value in res.data['barcode_values']:
            self.assertIn(value, res.data['commands'])

    def test_paging_covers_each_label_exactly_once(self):
        seen, offset = [], 0
        while offset is not None:
            page = self.commands(f'&limit=2&offset={offset}').data
            seen += page['barcode_values']
            offset = page['next_offset']
        self.assertEqual(len(seen), 5)
        self.assertEqual(len(set(seen)), 5)

    def test_reports_stock_without_barcodes(self):
        self.make_batch(self.batches[0].item, 3, grn=self.grn, barcode=False)
        res = self.commands()
        self.assertEqual(res.data['total'], 5)
        self.assertEqual(res.data['missing_barcodes'], 1)

    def test_validation(self):
        no_printer = self.emp_api.get(f'/api/grns/{self.grn.id}/print-commands/')
        self.assertEqual(no_printer.status_code, 400)
        self.assertEqual(self.commands('&limit=abc').status_code, 400)
        Printer.objects.filter(pk=self.printer.pk).update(is_active=False)
        self.assertEqual(self.commands().status_code, 404)
        self.assertEqual(
            self.emp_api.get(f'/api/grns/99999/print-commands/?printer_id={self.printer.id}').status_code, 404
        )

    def test_limit_is_capped(self):
        res = self.commands('&limit=100000')
        self.assertEqual(res.status_code, 200)

    def test_log_records_one_row_per_label(self):
        values = [b.barcode.value for b in self.batches]
        res = self.emp_api.post(
            f'/api/grns/{self.grn.id}/print-log/', {'printer': 'Zebra', 'values': values}, format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(PrintLog.objects.count(), 2)
        log = PrintLog.objects.first()
        self.assertEqual(log.user, self.employee)
        self.assertIn('GRN-BULK', log.notes)

    def test_log_rejects_barcodes_from_other_grns_and_bad_bodies(self):
        other = self.make_batch(self.batches[0].item, 1)
        url = f'/api/grns/{self.grn.id}/print-log/'
        for body in (
            {'values': [other.barcode.value]},
            {'values': []},
            {'values': 'x'},
            {'values': [1, 2]},
            {},
        ):
            self.assertEqual(self.emp_api.post(url, body, format='json').status_code, 400, body)
        self.assertEqual(PrintLog.objects.count(), 0)
        self.assertTrue(Barcode.objects.filter(pk=other.barcode_id).exists())
