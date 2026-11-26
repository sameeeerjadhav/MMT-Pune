"""
Brute-force protection for the login endpoint.

Only FAILED sign-ins are counted, so normal use is never slowed down. Three independent limits
apply within a sliding window; hitting any of them blocks further attempts (even with the right
password, otherwise guessing could continue) until the window passes:

  * same person trying the same account from the same address  (5 failures)
  * one address trying many accounts                            (30 failures)
  * one account attacked from many addresses                    (25 failures)

State lives in Django's cache (a shared database table in production), so the limits hold across
all gunicorn workers and survive restarts.
"""

import math
import time
from dataclasses import dataclass

from django.core.cache import cache
from rest_framework.exceptions import Throttled
from rest_framework.throttling import BaseThrottle

from audit.models import AuditLog

WINDOW_SECONDS = 15 * 60


@dataclass(frozen=True)
class _Limit:
    name: str
    max_failures: int


PAIR = _Limit('pair', 5)
ADDRESS = _Limit('addr', 30)
ACCOUNT = _Limit('acct', 25)


def client_ip(request) -> str:
    """Caller address. Honours REST_FRAMEWORK['NUM_PROXIES'] so a spoofed X-Forwarded-For is ignored."""
    return BaseThrottle().get_ident(request) or 'unknown'


def _normalise(username: str) -> str:
    return (username or '').strip().lower()[:150]


def _keys(ip: str, username: str):
    keys = [(ADDRESS, f'login:addr:{ip}')]
    if username:
        keys.append((PAIR, f'login:pair:{ip}:{username}'))
        keys.append((ACCOUNT, f'login:acct:{username}'))
    return keys


def _read(key: str):
    """Returns (failure_count, window_ends_at) or (0, 0)."""
    state = cache.get(key)
    if not state:
        return 0, 0.0
    count, ends_at = state
    if ends_at <= time.time():
        return 0, 0.0
    return count, ends_at


def ensure_allowed(request, username: str) -> None:
    """Raise a 429 (with Retry-After) if this attempt is currently blocked."""
    ip = client_ip(request)
    now = time.time()
    longest = 0.0
    for limit, key in _keys(ip, _normalise(username)):
        count, ends_at = _read(key)
        if count >= limit.max_failures:
            longest = max(longest, ends_at - now)
    if longest > 0:
        wait = max(1, math.ceil(longest))
        minutes = max(1, math.ceil(wait / 60))
        raise Throttled(
            wait=wait,
            detail=(
                'Too many failed sign-in attempts. '
                f'Please wait about {minutes} minute{"" if minutes == 1 else "s"} and try again.'
            ),
        )


def record_failure(request, username: str) -> None:
    ip = client_ip(request)
    name = _normalise(username)
    now = time.time()
    tripped = []
    for limit, key in _keys(ip, name):
        count, ends_at = _read(key)
        if count == 0:
            ends_at = now + WINDOW_SECONDS  # the window starts at the first failure
        count += 1
        cache.set(key, (count, ends_at), timeout=max(1, int(ends_at - now) + 1))
        if count == limit.max_failures:
            tripped.append(limit.name)
    if tripped:
        # Visible to admins in the audit log; written once, when the limit is first reached.
        AuditLog.objects.create(
            action='LOGIN_LOCKOUT',
            entity_type='User',
            details={'username': name, 'ip': ip, 'limits': tripped},
            ip_address=ip[:50],
        )


def record_success(request, username: str) -> None:
    """A correct password clears the counter for this person + account (not the shared ones)."""
    name = _normalise(username)
    if name:
        cache.delete(f'login:pair:{client_ip(request)}:{name}')
