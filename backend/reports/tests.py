from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role

User = get_user_model()

REPORT_PATHS = [
    '/api/reports/stock/',
    '/api/reports/grn/',
    '/api/reports/withdrawals/',
    '/api/reports/rack-occupancy/',
    '/api/reports/fifo/',
]


class ReportsRbacTests(TestCase):
    def setUp(self):
        admin_role, _ = Role.objects.get_or_create(code='ADMIN', defaults={'name': 'Administrator'})
        supervisor_role, _ = Role.objects.get_or_create(
            code='SUPERVISOR', defaults={'name': 'Supervisor'}
        )
        employee_role, _ = Role.objects.get_or_create(
            code='WAREHOUSE_EMPLOYEE', defaults={'name': 'Warehouse Employee'}
        )
        self.admin = User.objects.create_user(
            username='rep_admin', password='pass12345', role=admin_role
        )
        self.supervisor = User.objects.create_user(
            username='rep_sup', password='pass12345', role=supervisor_role
        )
        self.employee = User.objects.create_user(
            username='rep_emp', password='pass12345', role=employee_role
        )
        self.client = APIClient()

    def test_employee_forbidden_on_all_reports(self):
        self.client.force_authenticate(user=self.employee)
        for path in REPORT_PATHS:
            res = self.client.get(path)
            self.assertEqual(res.status_code, 403, path)

    def test_supervisor_and_admin_can_read_stock(self):
        for user in (self.supervisor, self.admin):
            self.client.force_authenticate(user=user)
            res = self.client.get('/api/reports/stock/')
            self.assertEqual(res.status_code, 200, user.username)
            self.assertIn('batches', res.data)
