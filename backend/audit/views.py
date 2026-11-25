from datetime import datetime, time

from django.db.models import Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdmin
from audit.models import AuditLog
from config.exceptions import ApiError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _parse_day(value: str, field: str, *, end_of_day: bool):
    try:
        day = datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError:
        raise ApiError('VALIDATION_ERROR', f'{field} must be a date like 2026-11-24')
    moment = datetime.combine(day, time.max if end_of_day else time.min)
    return timezone.make_aware(moment) if timezone.is_naive(moment) else moment


def _int_param(request, name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ApiError('VALIDATION_ERROR', f'{name} must be a whole number')
    return max(minimum, min(maximum, value))


def serialize_audit_log(log: AuditLog) -> dict:
    user = log.user
    return {
        'id': log.id,
        'created_at': log.created_at,
        'action': log.action,
        'entity_type': log.entity_type,
        'entity_id': log.entity_id,
        'details': log.details,
        'ip_address': log.ip_address,
        'user': (
            {
                'id': user.id,
                'username': user.username,
                'name': user.get_full_name() or user.username,
                'role': getattr(user, 'role_code', ''),
            }
            if user
            else None
        ),
    }


class AuditLogListView(APIView):
    """Admin-only, read-only browser for the audit trail (newest first)."""

    permission_classes = [IsAdmin]

    def get(self, request):
        params = request.query_params
        qs = AuditLog.objects.select_related('user', 'user__role')

        action = (params.get('action') or '').strip()
        if action:
            qs = qs.filter(action__iexact=action)
        entity_type = (params.get('entity_type') or '').strip()
        if entity_type:
            qs = qs.filter(entity_type__iexact=entity_type)
        user_id = (params.get('user_id') or '').strip()
        if user_id:
            if not user_id.isdigit():
                raise ApiError('VALIDATION_ERROR', 'user_id must be a number')
            qs = qs.filter(user_id=int(user_id))
        date_from = (params.get('date_from') or '').strip()
        if date_from:
            qs = qs.filter(created_at__gte=_parse_day(date_from, 'date_from', end_of_day=False))
        date_to = (params.get('date_to') or '').strip()
        if date_to:
            qs = qs.filter(created_at__lte=_parse_day(date_to, 'date_to', end_of_day=True))
        q = (params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(user__username__icontains=q)
                | Q(user__first_name__icontains=q)
                | Q(user__last_name__icontains=q)
                | Q(action__icontains=q)
                | Q(entity_type__icontains=q)
            )

        limit = _int_param(request, 'limit', DEFAULT_LIMIT, minimum=1, maximum=MAX_LIMIT)
        offset = _int_param(request, 'offset', 0, minimum=0, maximum=10**9)
        total = qs.count()
        rows = list(qs.order_by('-created_at', '-id')[offset : offset + limit])

        payload = {
            'count': total,
            'limit': limit,
            'offset': offset,
            'next_offset': offset + limit if offset + limit < total else None,
            'results': [serialize_audit_log(log) for log in rows],
        }
        if offset == 0:
            # Filter choices for the mobile chips — only computed for the first page.
            payload['facets'] = {
                # order_by() clears Meta.ordering so DISTINCT runs on the column only.
                'actions': sorted(
                    AuditLog.objects.order_by().values_list('action', flat=True).distinct()
                ),
                'entity_types': sorted(
                    t
                    for t in AuditLog.objects.order_by().values_list('entity_type', flat=True).distinct()
                    if t
                ),
            }
        return Response(payload)
