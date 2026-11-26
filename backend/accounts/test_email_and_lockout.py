"""Unique emails, login brute-force lockout and the production secret-key check."""

import os
import subprocess
import sys
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

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
