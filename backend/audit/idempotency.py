"""Idempotency-Key support for write endpoints.

A client (notably the mobile offline queue) sends `Idempotency-Key: <uuid>`. The first request with
that key runs normally and its successful result is stored; a replay with the same key returns the
stored result and does NOT apply the change again. Failed requests are not stored, so they can be
retried after the cause is fixed.
"""

from datetime import timedelta
from functools import wraps

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.response import Response

from audit.models import IdempotencyRecord
from config.exceptions import ApiError

MAX_KEY_LENGTH = 100
RETENTION = timedelta(days=7)


class _NotSuccessful(Exception):
    """Used to roll back the stored key when the wrapped view did not succeed."""

    def __init__(self, response):
        self.response = response


def _prune():
    IdempotencyRecord.objects.filter(created_at__lt=timezone.now() - RETENTION).delete()


def idempotent(view_method):
    """Decorator for `APIView.post(self, request, ...)`."""

    @wraps(view_method)
    def wrapper(self, request, *args, **kwargs):
        key = (request.headers.get('Idempotency-Key') or '').strip()
        if not key:
            return view_method(self, request, *args, **kwargs)
        if len(key) > MAX_KEY_LENGTH:
            raise ApiError('VALIDATION_ERROR', f'Idempotency-Key must be at most {MAX_KEY_LENGTH} characters')

        try:
            with transaction.atomic():
                try:
                    with transaction.atomic():
                        record = IdempotencyRecord.objects.create(
                            user=request.user, key=key, path=request.path
                        )
                except IntegrityError:
                    existing = IdempotencyRecord.objects.get(user=request.user, key=key)
                    if existing.path != request.path:
                        raise ApiError(
                            'CONFLICT',
                            'This Idempotency-Key was already used for a different request.',
                            status_code=409,
                        )
                    response = Response(existing.response_body, status=existing.response_status)
                    response['Idempotent-Replay'] = 'true'
                    return response

                response = view_method(self, request, *args, **kwargs)
                if not 200 <= response.status_code < 300:
                    raise _NotSuccessful(response)
                record.response_status = response.status_code
                record.response_body = response.data
                record.save(update_fields=['response_status', 'response_body'])
                if record.id % 50 == 0:
                    _prune()
                return response
        except _NotSuccessful as outcome:
            # The transaction (and the key) were rolled back, so the client may retry.
            return outcome.response

    return wrapper
