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
        roles = User.objects.ensure_default_roles()
        # Secondary admin (can manage supervisors/employees only).
        self.admin = User.objects.create_user(
            username='staff_admin', password='pass12345', role=roles['ADMIN'], is_staff=True
        )
        # Main admin (only account that may manage other admins).
        self.main_admin = User.objects.create_superuser(
            username='main_admin', password='pass12345'
        )
        self.employee = User.objects.create_user(
            username='staff_emp',
            password='pass12345',
            role=roles['WAREHOUSE_EMPLOYEE'],
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
        # Admins can see other admin accounts in the list.
        self.assertIn('main_admin', usernames)
        self.assertIn('staff_admin', usernames)

    def test_any_admin_can_create_another_admin(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            '/api/users/',
            {'username': 'peer_admin', 'password': 'pass12345', 'role': 'ADMIN'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['role'], 'ADMIN')
        self.assertFalse(res.data['is_main_admin'])
        created = User.objects.get(username='peer_admin')
        self.assertTrue(created.is_staff)
        self.assertFalse(created.is_superuser)

    def test_main_admin_can_create_secondary_admin(self):
        self.client.force_authenticate(user=self.main_admin)
        res = self.client.post(
            '/api/users/',
            {
                'username': 'second_admin',
                'password': 'pass12345',
                'role': 'ADMIN',
                'first_name': 'Pat',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['role'], 'ADMIN')
        self.assertFalse(res.data['is_main_admin'])
        created = User.objects.get(username='second_admin')
        self.assertTrue(created.is_staff)
        self.assertFalse(created.is_superuser)

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

    def test_secondary_admin_cannot_manage_other_admins(self):
        roles = User.objects.ensure_default_roles()
        other_admin = User.objects.create_user(
            username='other_admin', password='pass12345', role=roles['ADMIN'], is_staff=True
        )
        self.client.force_authenticate(user=self.admin)
        bad_off = self.client.patch(
            f'/api/users/{other_admin.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(bad_off.status_code, 403)
        bad_del = self.client.delete(f'/api/users/{other_admin.id}/')
        self.assertEqual(bad_del.status_code, 403)

    def test_main_admin_can_deactivate_and_delete_secondary_admin(self):
        roles = User.objects.ensure_default_roles()
        other_admin = User.objects.create_user(
            username='other_admin2', password='pass12345', role=roles['ADMIN'], is_staff=True
        )
        self.client.force_authenticate(user=self.main_admin)
        off = self.client.patch(
            f'/api/users/{other_admin.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(off.status_code, 200)
        self.assertFalse(off.data['is_active'])
        deleted = self.client.delete(f'/api/users/{other_admin.id}/')
        self.assertEqual(deleted.status_code, 204)

    def test_nobody_can_manage_main_admin_via_api(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            f'/api/users/{self.main_admin.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_admin_cannot_patch_own_account_via_staff_api(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            f'/api/users/{self.admin.id}/',
            {'first_name': 'Nope'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_profile_reports_main_admin_flag(self):
        self.client.force_authenticate(user=self.main_admin)
        res = self.client.get('/api/auth/profile/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['is_main_admin'])
        self.client.force_authenticate(user=self.admin)
        res2 = self.client.get('/api/auth/profile/')
        self.assertFalse(res2.data['is_main_admin'])

    def test_admin_without_superuser_claims_main_when_none_exists(self):
        # Remove the only superuser — remaining ADMIN should claim main seat.
        self.main_admin.is_superuser = False
        self.main_admin.save(update_fields=['is_superuser'])
        self.client.force_authenticate(user=self.admin)
        profile = self.client.get('/api/auth/profile/')
        self.assertEqual(profile.status_code, 200)
        self.assertTrue(profile.data['is_main_admin'])
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_superuser)
        created = self.client.post(
            '/api/users/',
            {'username': 'claimed_admin', 'password': 'pass12345', 'role': 'ADMIN'},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        self.assertFalse(created.data['is_main_admin'])

    def test_staff_patch_does_not_claim_main_admin_seat(self):
        """Editing staff roles must not promote the actor when no superuser exists."""
        self.main_admin.is_superuser = False
        self.main_admin.save(update_fields=['is_superuser'])
        self.client.force_authenticate(user=self.admin)
        patch = self.client.patch(
            f'/api/users/{self.employee.id}/',
            {'role': 'SUPERVISOR'},
            format='json',
        )
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(patch.data['role'], 'SUPERVISOR')
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.is_superuser)

        # Promoting another user to Admin still requires an existing main admin.
        promote = self.client.patch(
            f'/api/users/{self.employee.id}/',
            {'role': 'ADMIN'},
            format='json',
        )
        self.assertEqual(promote.status_code, 400)
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.is_superuser)


class ProfileSelfEditTests(TestCase):
    def setUp(self):
        roles = User.objects.ensure_default_roles()
        # A secondary admin (not the main admin) must also be able to edit their own details.
        self.admin = User.objects.create_user(
            username='self_admin',
            password='pass12345',
            role=roles['ADMIN'],
            is_staff=True,
            first_name='Old',
            last_name='Name',
            employee_id='ADM-1',
        )
        self.employee = User.objects.create_user(
            username='self_emp',
            password='pass12345',
            role=roles['WAREHOUSE_EMPLOYEE'],
            employee_id='EMP-9',
            email='emp@example.com',
        )
        self.client = APIClient()

    def test_requires_authentication(self):
        res = self.client.patch('/api/auth/profile/', {'first_name': 'X'}, format='json')
        self.assertEqual(res.status_code, 401)

    def test_admin_edits_own_details(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            '/api/auth/profile/',
            {
                'first_name': 'Asha',
                'last_name': 'Patil',
                'email': 'asha@example.com',
                'username': 'asha_admin',
                'employee_id': 'ADM-77',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.first_name, 'Asha')
        self.assertEqual(self.admin.last_name, 'Patil')
        self.assertEqual(self.admin.email, 'asha@example.com')
        self.assertEqual(self.admin.username, 'asha_admin')
        self.assertEqual(self.admin.employee_id, 'ADM-77')
        self.assertEqual(res.data['role'], 'ADMIN')

    def test_profile_patch_cannot_change_role_or_flags(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            '/api/auth/profile/',
            {'first_name': 'Asha', 'role': 'WAREHOUSE_EMPLOYEE', 'is_superuser': True, 'is_active': False},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role_code, 'ADMIN')
        self.assertFalse(self.admin.is_superuser)
        self.assertTrue(self.admin.is_active)

    def test_employee_can_edit_name_and_email_but_not_username_or_employee_id(self):
        self.client.force_authenticate(user=self.employee)
        ok = self.client.patch(
            '/api/auth/profile/', {'first_name': 'Ravi', 'email': 'ravi@example.com'}, format='json'
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data['first_name'], 'Ravi')
        for field, value in (('username', 'hacker'), ('employee_id', 'ADMIN')):
            res = self.client.patch('/api/auth/profile/', {field: value}, format='json')
            self.assertEqual(res.status_code, 400, field)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.username, 'self_emp')
        self.assertEqual(self.employee.employee_id, 'EMP-9')

    def test_unchanged_admin_only_fields_are_accepted_for_employee(self):
        self.client.force_authenticate(user=self.employee)
        res = self.client.patch(
            '/api/auth/profile/',
            {'username': 'self_emp', 'employee_id': 'EMP-9', 'first_name': 'Same'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)

    def test_rejects_duplicate_username_and_email(self):
        self.client.force_authenticate(user=self.admin)
        dup_username = self.client.patch('/api/auth/profile/', {'username': 'SELF_EMP'}, format='json')
        self.assertEqual(dup_username.status_code, 400)
        dup_email = self.client.patch('/api/auth/profile/', {'email': 'EMP@example.com'}, format='json')
        self.assertEqual(dup_email.status_code, 400)

    def test_password_change_requires_correct_current_password(self):
        self.client.force_authenticate(user=self.admin)
        wrong = self.client.patch(
            '/api/auth/profile/',
            {'current_password': 'nope', 'new_password': 'brandnew1'},
            format='json',
        )
        self.assertEqual(wrong.status_code, 400)
        missing = self.client.patch('/api/auth/profile/', {'new_password': 'brandnew1'}, format='json')
        self.assertEqual(missing.status_code, 400)

        ok = self.client.patch(
            '/api/auth/profile/',
            {'current_password': 'pass12345', 'new_password': 'brandnew1'},
            format='json',
        )
        self.assertEqual(ok.status_code, 200)
        self.assertNotIn('password', ok.data)
        login = APIClient().post(
            '/api/auth/login/', {'username': 'self_admin', 'password': 'brandnew1'}, format='json'
        )
        self.assertEqual(login.status_code, 200)

    def test_self_edit_is_audit_logged_without_password(self):
        from audit.models import AuditLog

        self.client.force_authenticate(user=self.admin)
        self.client.patch(
            '/api/auth/profile/',
            {'first_name': 'Asha', 'current_password': 'pass12345', 'new_password': 'brandnew1'},
            format='json',
        )
        log = AuditLog.objects.filter(user=self.admin, entity_type='User', action='UPDATE').latest('id')
        self.assertTrue(log.details['self_edit'])
        self.assertEqual(log.details['fields'], ['first_name'])
        self.assertTrue(log.details['password_changed'])
        self.assertNotIn('brandnew1', str(log.details))
