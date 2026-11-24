from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role
from barcodes.models import Barcode, Printer
from barcodes.printing import build_label_commands, label_lines_from_data, render_barcode_label_commands

User = get_user_model()


class LabelCommandTests(TestCase):
    def test_zpl_has_label_size_text_and_code128(self):
        zpl = build_label_commands(
            language='ZPL',
            value='B0000000012',
            lines=['Steel Bolt M8', 'Code: ST-08', 'GRN: GRN-1'],
            width_mm=50,
            height_mm=25,
            dpi=203,
        )
        self.assertTrue(zpl.startswith('^XA'))
        self.assertIn('^PW400', zpl)  # 50 mm at 203 dpi
        self.assertIn('^LL200', zpl)  # 25 mm at 203 dpi
        self.assertIn('^FDSteel Bolt M8^FS', zpl)
        self.assertIn('^BCN', zpl)
        self.assertIn('^FDB0000000012^FS', zpl)
        self.assertTrue(zpl.rstrip().endswith('^XZ'))

    def test_zpl_strips_command_characters_from_text(self):
        zpl = build_label_commands(
            language='ZPL',
            value='B0000000001',
            lines=['Bolt ^XA ~ injected'],
            width_mm=50,
            height_mm=25,
            dpi=203,
        )
        self.assertIn('^FDBolt  XA   injected^FS', zpl)

    def test_tspl_has_size_text_and_barcode(self):
        tspl = build_label_commands(
            language='TSPL',
            value='U0000000007',
            lines=['Cable 2m "blue"'],
            width_mm=100,
            height_mm=50,
            dpi=300,
        )
        self.assertIn('SIZE 100 mm,50 mm', tspl)
        self.assertIn('TEXT ', tspl)
        self.assertIn("Cable 2m 'blue'", tspl)  # double quotes replaced inside quoted field
        self.assertIn('BARCODE ', tspl)
        self.assertIn('"U0000000007"', tspl)
        self.assertIn('PRINT 1,1', tspl)

    def test_rejects_unsupported_dpi(self):
        with self.assertRaises(ValueError):
            build_label_commands(
                language='ZPL', value='X', lines=[], width_mm=50, height_mm=25, dpi=150
            )

    def test_label_lines_skip_empty_fields(self):
        lines = label_lines_from_data({'item_name': 'Hose', 'item_code': '', 'quantity': 0})
        self.assertEqual(lines, ['Hose', 'Qty: 0'])

    def test_render_barcode_label_uses_printer_profile(self):
        printer = Printer.objects.create(
            name='Dock A', language='TSPL', host='192.168.1.50', port=9100, label_width_mm=100, label_height_mm=50, dpi=203
        )
        barcode = Barcode.objects.create(value='B0000000099', entity_type='BATCH', entity_id=99, label_data={'item_name': 'Tyre'})
        out = render_barcode_label_commands(barcode, printer)
        self.assertIn('SIZE 100 mm,50 mm', out)
        self.assertIn('"B0000000099"', out)


class PrinterApiTests(TestCase):
    def setUp(self):
        roles = {
            code: Role.objects.get_or_create(code=code, defaults={'name': code.title()})[0]
            for code in ('ADMIN', 'SUPERVISOR', 'WAREHOUSE_EMPLOYEE')
        }
        self.supervisor = User.objects.create_user(
            username='sup_print', password='pass12345', role=roles['SUPERVISOR']
        )
        self.employee = User.objects.create_user(
            username='emp_print', password='pass12345', role=roles['WAREHOUSE_EMPLOYEE']
        )
        self.client = APIClient()
        self.barcode = Barcode.objects.create(
            value='B0000000042', entity_type='BATCH', entity_id=42, label_data={'item_name': 'Filter'}
        )
        self.payload = {
            'name': 'Dock Zebra',
            'language': 'ZPL',
            'host': '192.168.1.60',
            'port': 9100,
            'label_width_mm': 50,
            'label_height_mm': 25,
            'dpi': 203,
        }

    def test_supervisor_creates_printer_and_employee_cannot(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.post('/api/printers/', self.payload, format='json')
        self.assertEqual(res.status_code, 403)

        self.client.force_authenticate(user=self.supervisor)
        res = self.client.post('/api/printers/', self.payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Printer.objects.count(), 1)

    def test_employee_can_list_active_printers_only(self):
        Printer.objects.create(name='Active', host='10.0.0.1')
        Printer.objects.create(name='Off', host='10.0.0.2', is_active=False)
        self.client.force_authenticate(user=self.employee)
        res = self.client.get('/api/printers/?active=1')
        self.assertEqual(res.status_code, 200)
        self.assertEqual([p['name'] for p in res.data], ['Active'])

    def test_validation_rejects_bad_host_port_dpi_and_size(self):
        self.client.force_authenticate(user=self.supervisor)
        for field, value in (
            ('host', 'http://printer.local'),
            ('port', 70000),
            ('dpi', 150),
            ('label_width_mm', 500),
        ):
            bad = {**self.payload, field: value}
            res = self.client.post('/api/printers/', bad, format='json')
            self.assertEqual(res.status_code, 400, field)

    def test_print_commands_for_label(self):
        printer = Printer.objects.create(name='Zebra 1', host='10.0.0.5')
        self.client.force_authenticate(user=self.employee)
        res = self.client.get(f'/api/barcodes/{self.barcode.value}/print-commands/?printer_id={printer.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['host'], '10.0.0.5')
        self.assertEqual(res.data['language'], 'ZPL')
        self.assertIn('^FDB0000000042^FS', res.data['commands'])

    def test_print_commands_requires_active_printer(self):
        printer = Printer.objects.create(name='Retired', host='10.0.0.6', is_active=False)
        self.client.force_authenticate(user=self.employee)
        res = self.client.get(f'/api/barcodes/{self.barcode.value}/print-commands/?printer_id={printer.id}')
        self.assertEqual(res.status_code, 404)
        res = self.client.get(f'/api/barcodes/{self.barcode.value}/print-commands/')
        self.assertEqual(res.status_code, 400)

    def test_test_label_endpoint(self):
        printer = Printer.objects.create(name='TSC 1', host='10.0.0.7', language='TSPL')
        self.client.force_authenticate(user=self.employee)
        res = self.client.get(f'/api/printers/{printer.id}/test-label/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('SIZE 50 mm,25 mm', res.data['commands'])
        self.assertIn('MMT Pune printer test', res.data['commands'])
