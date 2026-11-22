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


class StaffUserAdminTests(TestCase):
    def setUp(self):
        roles = {}
        for code, name in [
            ('ADMIN', 'Administrator'),
            ('SUPERVISOR', 'Supervisor'),
            ('WAREHOUSE_EMPLOYEE', 'Warehouse Employee'),
        ]:
            roles[code], _ = Role.objects.get_or_create(code=code, defaults={'name': name})
        self.admin = User.objects.create_user(
            username='staff_admin', password='pass12345', role=roles['ADMIN']
        )
        self.employee = User.objects.create_user(
            username='staff_emp', password='pass12345', role=roles['WAREHOUSE_EMPLOYEE']
        )
        self.client = APIClient()

    def test_employee_cannot_create_users(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.post(
            '/api/users/',
            {
                'username': 'new_sup',
                'password': 'pass12345',
                'role': 'SUPERVISOR',
                'first_name': 'Sara',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_creates_supervisor_and_employee(self):
        self.client.force_authenticate(user=self.admin)
        sup = self.client.post(
            '/api/users/',
            {
                'username': 'new_sup',
                'password': 'pass12345',
                'role': 'SUPERVISOR',
                'first_name': 'Sara',
                'employee_id': 'EMP-S1',
            },
            format='json',
        )
        self.assertEqual(sup.status_code, 201)
        self.assertEqual(sup.data['role'], 'SUPERVISOR')

        emp = self.client.post(
            '/api/users/',
            {
                'username': 'new_emp',
                'password': 'pass12345',
                'role': 'WAREHOUSE_EMPLOYEE',
                'first_name': 'Raj',
            },
            format='json',
        )
        self.assertEqual(emp.status_code, 201)
        self.assertEqual(emp.data['role'], 'WAREHOUSE_EMPLOYEE')

        listed = self.client.get('/api/users/?include_inactive=1')
        self.assertEqual(listed.status_code, 200)
        usernames = {u['username'] for u in listed.data}
        self.assertIn('new_sup', usernames)
        self.assertIn('new_emp', usernames)

    def test_admin_cannot_create_another_admin_via_api(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            '/api/users/',
            {'username': 'hacker', 'password': 'pass12345', 'role': 'ADMIN'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_admin_activates_deactivates_and_deletes_employee(self):
        self.client.force_authenticate(user=self.admin)
        off = self.client.patch(
            f'/api/users/{self.employee.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(off.status_code, 200)
        self.assertFalse(off.data['is_active'])

        on = self.client.patch(
            f'/api/users/{self.employee.id}/',
            {'is_active': True},
            format='json',
        )
        self.assertEqual(on.status_code, 200)
        self.assertTrue(on.data['is_active'])

        deleted = self.client.delete(f'/api/users/{self.employee.id}/')
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.employee.id).exists())

    def test_admin_cannot_delete_or_deactivate_admin_account(self):
        roles = User.objects.ensure_default_roles()
        other_admin = User.objects.create_user(
            username='other_admin', password='pass12345', role=roles['ADMIN']
        )
        self.client.force_authenticate(user=self.admin)
        bad_off = self.client.patch(
            f'/api/users/{other_admin.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(bad_off.status_code, 400)
        bad_del = self.client.delete(f'/api/users/{other_admin.id}/')
        self.assertEqual(bad_del.status_code, 400)

    def test_admin_cannot_patch_own_account_via_staff_api(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            f'/api/users/{self.admin.id}/',
            {'first_name': 'Nope'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
