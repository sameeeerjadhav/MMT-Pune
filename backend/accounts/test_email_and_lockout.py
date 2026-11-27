"""Unique emails, login brute-force lockout and the production secret-key check."""

import os
import subprocess
import sys
from io import StringIO
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.serializers import (
    ProfileUpdateSerializer,
    StaffUserCreateSerializer,
    StaffUserUpdateSerializer,
)
from audit.models import AuditLog
from config.factories import WarehouseTestMixin

User = get_user_model()
FAST_HASH = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
BACKEND_DIR = Path(__file__).resolve().parent.parent


class StaffEmailUniquenessTests(WarehouseTestMixin, TestCase):
    def setUp(self):
        self.setUpWarehouse()
        User.objects.create_user(username='mail_a', email='a@example.com', role=self.employee.role)
        self.target = User.objects.create_user(
            username='mail_b', email='b@example.com', role=self.employee.role
        )

    def test_admin_edit_rejects_email_used_by_someone_else(self):
        res = self.admin_api.patch(
            f'/api/users/{self.target.id}/', {'email': 'A@Example.com'}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.target.refresh_from_db()
        self.assertEqual(self.target.email, 'b@example.com')

    def test_admin_edit_allows_keeping_own_email(self):
        res = self.admin_api.patch(
            f'/api/users/{self.target.id}/',
            {'email': 'B@example.com', 'first_name': 'Bee'},
            format='json',
        )
        self.assertEqual(res.status_code, 200, res.data)

    def test_several_users_may_have_no_email(self):
        User.objects.create_user(username='no_mail_1', role=self.employee.role)
        User.objects.create_user(username='no_mail_2', role=self.employee.role)


@FAST_HASH
class LoginLockoutTests(TestCase):
    URL = '/api/auth/login/'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.alice = User.objects.create_user(username='alice', password='right-pass-1')
        self.bob = User.objects.create_user(username='bob', password='right-pass-2')
        self.client = APIClient()

    def login(self, username, password, ip='10.0.0.1'):
        return self.client.post(
            self.URL, {'username': username, 'password': password}, format='json', REMOTE_ADDR=ip
        )

    def fail(self, username='alice', times=1, ip='10.0.0.1'):
        for _ in range(times):
            self.assertEqual(self.login(username, 'wrong', ip).status_code, 400)

    def test_blocks_after_five_failures_even_with_correct_password(self):
        self.fail(times=5)
        res = self.login('alice', 'right-pass-1')
        self.assertEqual(res.status_code, 429)
        self.assertIn('Too many failed', res.data['message'])
        self.assertGreater(int(res['Retry-After']), 0)

    def test_four_failures_then_success_is_fine_and_resets_the_counter(self):
        self.fail(times=4)
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)
        self.fail(times=4)
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)

    def test_other_accounts_and_addresses_are_not_blocked(self):
        self.fail('alice', times=5)
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 429)
        self.assertEqual(self.login('bob', 'right-pass-2').status_code, 200)
        self.assertEqual(self.login('alice', 'right-pass-1', ip='10.0.0.2').status_code, 200)

    def test_block_expires_after_the_window(self):
        self.fail(times=5)
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 429)
        with mock.patch('accounts.login_guard.time.time', return_value=10**10):
            self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)

    def test_username_is_matched_case_insensitively(self):
        self.fail('alice', times=3)
        self.fail('ALICE', times=2)
        self.assertEqual(self.login('Alice', 'right-pass-1').status_code, 429)

    def test_one_address_guessing_many_accounts_is_blocked(self):
        for i in range(30):
            self.fail(f'ghost{i}', ip='10.9.9.9')
        res = self.login('bob', 'right-pass-2', ip='10.9.9.9')
        self.assertEqual(res.status_code, 429)

    def test_one_account_attacked_from_many_addresses_is_blocked(self):
        for i in range(25):
            self.fail('alice', ip=f'10.1.0.{i + 1}')
        res = self.login('alice', 'right-pass-1', ip='10.1.1.1')
        self.assertEqual(res.status_code, 429)

    def test_lockout_is_written_to_audit_log_once(self):
        self.fail(times=5)
        self.login('alice', 'wrong')  # already blocked: must not add more entries
        entries = AuditLog.objects.filter(action='LOGIN_LOCKOUT')
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().details['username'], 'alice')

    def test_successful_login_still_records_normally(self):
        res = self.login('alice', 'right-pass-1')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action='LOGIN').exists())

    def test_malformed_body_does_not_crash(self):
        res = self.client.post(self.URL, [1, 2, 3], format='json')
        self.assertEqual(res.status_code, 400)


@FAST_HASH
class LoginLockoutRobustnessTests(TestCase):
    URL = '/api/auth/login/'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        User.objects.create_user(username='alice', email='alice@example.com', password='right-pass-1')
        self.client = APIClient()

    def login(self, who, password, ip='10.0.0.1'):
        return self.client.post(
            self.URL, {'username': who, 'password': password}, format='json', REMOTE_ADDR=ip
        )

    def test_username_and_email_share_one_counter(self):
        for who in ('alice', 'alice@example.com', 'ALICE', 'Alice@Example.com', 'alice'):
            self.assertEqual(self.login(who, 'wrong').status_code, 400)
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 429)
        self.assertEqual(self.login('alice@example.com', 'right-pass-1').status_code, 429)

    def test_unknown_email_does_not_crash_and_counts_on_its_own(self):
        for _ in range(5):
            self.assertEqual(self.login('ghost@example.com', 'wrong').status_code, 400)
        self.assertEqual(self.login('ghost@example.com', 'wrong').status_code, 429)
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)

    def test_sign_in_still_works_when_the_cache_is_broken(self):
        broken = mock.MagicMock()
        for name in ('get', 'set', 'delete'):
            getattr(broken, name).side_effect = DatabaseError('no such table: django_cache')
        with mock.patch('accounts.login_guard.cache', broken), self.assertLogs(
            'accounts.login_guard', level='ERROR'
        ):
            self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)
            self.assertEqual(self.login('alice', 'wrong').status_code, 400)


@FAST_HASH
class ClearLoginLockoutsCommandTests(TestCase):
    URL = '/api/auth/login/'

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        User.objects.create_user(username='alice', email='alice@example.com', password='right-pass-1')
        User.objects.create_user(username='bob', password='right-pass-2')
        self.client = APIClient()

    def login(self, who, password):
        return self.client.post(
            self.URL, {'username': who, 'password': password}, format='json', REMOTE_ADDR='10.0.0.1'
        )

    def lock(self, who):
        for _ in range(5):
            self.assertEqual(self.login(who, 'wrong').status_code, 400)
        self.assertEqual(self.login(who, 'right-pass-1').status_code, 429)

    def run_command(self, **options):
        out = StringIO()
        call_command('clear_login_lockouts', stdout=out, **options)
        return out.getvalue()

    def test_unlocks_one_account_by_username(self):
        self.lock('alice')
        output = self.run_command(username='alice')
        self.assertIn('Cleared 2', output)  # the account and the person+account counters
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)

    def test_unlocks_an_account_by_email_even_if_it_was_locked_by_username(self):
        self.lock('alice')
        self.run_command(username='Alice@Example.com')
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)

    def test_unlocking_one_account_leaves_others_locked(self):
        self.lock('alice')
        for _ in range(5):
            self.login('bob', 'wrong')
        self.run_command(username='alice')
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)
        self.assertEqual(self.login('bob', 'right-pass-2').status_code, 429)

    def test_all_clears_every_lockout(self):
        self.lock('alice')
        output = self.run_command(all=True)
        self.assertIn('Cleared 3', output)  # address, person+account and account counters
        self.assertEqual(self.login('alice', 'right-pass-1').status_code, 200)

    def test_requires_exactly_one_option(self):
        with self.assertRaises(CommandError):
            call_command('clear_login_lockouts', stdout=StringIO())
        with self.assertRaises(CommandError):
            call_command('clear_login_lockouts', username='alice', all=True, stdout=StringIO())


class DuplicateRaceTests(WarehouseTestMixin, TestCase):
    """If another request saves the same email first, the user sees a 400, not a server error."""

    def setUp(self):
        self.setUpWarehouse()
        self.taken = User.objects.create_user(
            username='taken_mail', email='dupe@example.com', role=self.employee.role
        )

    @staticmethod
    def skip_precheck():
        # Simulates the other request landing just after the "is it free?" check passed.
        return mock.patch.object(
            StaffUserCreateSerializer, 'validate_email', lambda self, value: value
        )

    def test_create_with_a_taken_email_is_a_400(self):
        with self.skip_precheck():
            res = self.admin_api.post(
                '/api/users/',
                {
                    'username': 'newcomer',
                    'password': 'secret123',
                    'email': 'DUPE@example.com',
                    'role': 'WAREHOUSE_EMPLOYEE',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn('email', res.data['details'])
        self.assertFalse(User.objects.filter(username='newcomer').exists())

    def test_create_with_a_taken_username_is_a_400(self):
        with self.skip_precheck(), mock.patch.object(
            StaffUserCreateSerializer, 'validate_username', lambda self, value: value
        ):
            res = self.admin_api.post(
                '/api/users/',
                {
                    'username': 'taken_mail',
                    'password': 'secret123',
                    'email': 'other@example.com',
                    'role': 'WAREHOUSE_EMPLOYEE',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn('username', res.data['details'])

    def test_staff_edit_with_a_taken_email_is_a_400(self):
        other = User.objects.create_user(
            username='other_mail', email='other@example.com', role=self.employee.role
        )
        with mock.patch.object(
            StaffUserUpdateSerializer, 'validate_email', lambda self, value: value
        ):
            res = self.admin_api.patch(
                f'/api/users/{other.id}/', {'email': 'dupe@example.com'}, format='json'
            )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn('email', res.data['details'])
        other.refresh_from_db()
        self.assertEqual(other.email, 'other@example.com')

    def test_profile_edit_with_a_taken_email_is_a_400(self):
        with mock.patch.object(
            ProfileUpdateSerializer, 'validate_email', lambda self, value: value
        ):
            res = self.admin_api.patch(
                '/api/auth/profile/', {'email': 'dupe@example.com'}, format='json'
            )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn('email', res.data['details'])


class SecretKeyCheckTests(TestCase):
    """Starting with DEBUG off and a weak key must refuse to boot."""

    def boot(self, key=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith('DJANGO_')}
        env.update(
            DJANGO_USE_SQLITE='1',
            DJANGO_DEBUG='False',
            DJANGO_ALLOWED_HOSTS='example.com',
            DJANGO_SETTINGS_MODULE='config.settings',
        )
        if key is not None:
            env['DJANGO_SECRET_KEY'] = key
        return subprocess.run(
            [sys.executable, '-c', 'import config.settings'],
            cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=60,
        )

    def test_missing_short_and_placeholder_keys_are_rejected(self):
        for key in (None, 'too-short', 'change-me-to-a-long-random-secret-value-1234567'):
            result = self.boot(key)
            self.assertNotEqual(result.returncode, 0, f'key {key!r} was accepted')
            self.assertIn('DJANGO_SECRET_KEY', result.stderr)

    def test_long_random_key_is_accepted(self):
        result = self.boot('k9Qv3xT7mZ2pL8nB5cR1wY6uH4jD0sFgA7eKtX2oNqVbM9iC3zPyUlWa')
        self.assertEqual(result.returncode, 0, result.stderr)
