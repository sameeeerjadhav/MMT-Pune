import csv
import io

from django.test import TestCase

from config.factories import WarehouseTestMixin
from reports.exports import safe_cell


def parse(response):
    text = response.content.decode('utf-8')
    assert text.startswith('\ufeff'), 'CSV must start with a BOM so Excel reads UTF-8'
    return list(csv.reader(io.StringIO(text[1:])))


class CsvExportTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        self.rack, (self.p1, _) = self.make_rack('R1')
        self.item = self.make_item('BOLT', 'BULK', name='=HYPERLINK("http://evil")')
        self.batch = self.make_batch(self.item, 25)
        self.allocate(self.p1, batch=self.batch, qty=25)
        self.unit = self.make_unit(self.make_item('TV', 'UNIT', name='TV, 55"'))

    ENDPOINTS = ('stock', 'grn', 'withdrawals', 'rack-occupancy')

    def test_leads_only(self):
        for name in self.ENDPOINTS:
            url = f'/api/reports/{name}.csv'
            self.assertEqual(self.emp_api.get(url).status_code, 403, name)
            self.assertEqual(self.super_api.get(url).status_code, 200, name)
            self.assertEqual(self.admin_api.get(url).status_code, 200, name)

    def test_headers(self):
        res = self.super_api.get('/api/reports/stock.csv')
        self.assertIn('text/csv', res['Content-Type'])
        self.assertIn('attachment; filename="stock-', res['Content-Disposition'])

    def test_stock_contents_location_and_formula_guard(self):
        rows = parse(self.super_api.get('/api/reports/stock.csv'))
        header, body = rows[0], rows[1:]
        self.assertEqual(header[:2], ['Type', 'Code'])
        by_code = {r[1]: dict(zip(header, r)) for r in body}
        batch_row = by_code[self.batch.batch_code]
        self.assertEqual(batch_row['Type'], 'Batch')
        self.assertIn('WH1/R1/S1/P1', batch_row['Location'])
        # a spreadsheet formula typed into a name must not execute
        self.assertTrue(batch_row['Item name'].startswith("'="))
        # commas and quotes round-trip through proper CSV quoting
        self.assertEqual(by_code[self.unit.unit_code]['Item name'], 'TV, 55"')

    def test_grn_export_lists_lines(self):
        rows = parse(self.super_api.get('/api/reports/grn.csv'))
        self.assertGreater(len(rows), 1)
        joined = '\n'.join(','.join(r) for r in rows)
        self.assertIn(self.batch.grn_line.grn.grn_number, joined)

    def test_occupancy_export_lists_racks(self):
        rows = parse(self.super_api.get('/api/reports/rack-occupancy.csv'))
        self.assertTrue(any('R1' in r for r in rows[1:]))

    def test_date_filter_validation(self):
        self.assertEqual(self.super_api.get('/api/reports/withdrawals.csv?from=garbage').status_code, 400)
        self.assertEqual(
            self.super_api.get('/api/reports/withdrawals.csv?from=2026-01-01&to=2026-12-31').status_code, 200
        )


class SafeCellTests(TestCase):
    def test_guards_formulas_but_not_numbers(self):
        for bad in ('=1+1', '+cmd', '-cmd', '@SUM(A1)', '\tfoo'):
            self.assertTrue(safe_cell(bad).startswith("'"), bad)
        for fine in ('-5', '-5.25', '12', 'plain', ''):
            self.assertEqual(safe_cell(fine), fine)
        self.assertEqual(safe_cell(None), '')
        self.assertEqual(safe_cell(True), 'Yes')
