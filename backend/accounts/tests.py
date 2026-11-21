from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role

User = get_user_model()


class AuthProfileTests(TestCase):
    def setUp(self):
        role, _ = Role.objects.get_or_create(
            code='WAREHOUSE_EMPLOYEE', defaults={'name': 'Warehouse Employee'}
        )
        self.user = User.objects.create_user(
            username='auth_emp',
            password='pass12345',
            role=role,
            first_name='Floor',
            last_name='Worker',
        )
        self.client = APIClient()

    def test_login_returns_tokens_and_role(self):
        res = self.client.post(
            '/api/auth/login/',
            {'username': 'auth_emp', 'password': 'pass12345'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['role'], 'WAREHOUSE_EMPLOYEE')

    def test_profile_requires_auth(self):
        res = self.client.get('/api/auth/profile/')
        self.assertIn(res.status_code, (401, 403))

    def test_profile_returns_role(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.get('/api/auth/profile/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['role'], 'WAREHOUSE_EMPLOYEE')
        self.assertEqual(res.data['username'], 'auth_emp')

    def test_createsuperuser_assigns_admin_role(self):
        admin = User.objects.create_superuser(username='su_admin', password='pass12345')
        self.assertEqual(admin.role_code, 'ADMIN')
        self.assertTrue(admin.has_role('ADMIN'))
        self.assertTrue(admin.has_role('ADMIN', 'SUPERVISOR'))

    def test_superuser_without_role_fk_still_reports_admin(self):
        # Mimic older createsuperuser that only set is_superuser.
        orphan = User.objects.create_user(username='orphan_su', password='pass12345')
        orphan.is_superuser = True
        orphan.is_staff = True
        orphan.role = None
        orphan.save(update_fields=['is_superuser', 'is_staff', 'role'])
        self.assertEqual(orphan.role_code, 'ADMIN')
        self.assertTrue(orphan.has_role('ADMIN'))
