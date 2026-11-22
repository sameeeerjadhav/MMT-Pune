from django.contrib.auth import get_user_model
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView
from drf_spectacular.utils import extend_schema

from accounts.models import Role
from accounts.permissions import IsAdmin
from accounts.serializers import (
    LoginSerializer,
    StaffUserCreateSerializer,
    StaffUserUpdateSerializer,
    UserSerializer,
)
from audit.models import AuditLog
from config.exceptions import ApiError

User = get_user_model()

STAFF_ROLE_CODES = (Role.Code.SUPERVISOR, Role.Code.WAREHOUSE_EMPLOYEE)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'anon'

    @extend_schema(request=LoginSerializer, responses=UserSerializer)
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        refresh = RefreshToken.for_user(user)
        AuditLog.objects.create(user=user, action='LOGIN', entity_type='User', entity_id=user.id)
        return Response(
            {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
                'user': UserSerializer(user).data,
            }
        )


class LogoutView(APIView):
    def post(self, request):
        refresh = request.data.get('refresh')
        if refresh:
            try:
                token = RefreshToken(refresh)
                token.blacklist()
            except Exception:
                pass
        AuditLog.objects.create(
            user=request.user, action='LOGOUT', entity_type='User', entity_id=request.user.id
        )
        return Response({'success': True})


class ProfileView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class HealthView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(
            {
                'status': 'ok',
                'service': 'warehouse-backend',
            }
        )


class RefreshView(TokenRefreshView):
    permission_classes = [permissions.AllowAny]


def _get_manageable_staff(pk) -> User:
    """Load a supervisor/employee for admin management (never Admin accounts)."""
    user = get_object_or_404(User.objects.select_related('role'), pk=pk)
    if user.role_code == Role.Code.ADMIN or user.is_superuser:
        raise ApiError(
            'VALIDATION_ERROR',
            'Admin accounts cannot be managed from this API.',
            status_code=400,
        )
    if user.role_code not in STAFF_ROLE_CODES:
        raise ApiError(
            'VALIDATION_ERROR',
            'Only supervisors and warehouse employees can be managed here.',
            status_code=400,
        )
    return user


class StaffUserListCreateView(APIView):
    """Admin: list staff and create supervisors / warehouse employees."""

    permission_classes = [IsAdmin]

    def get(self, request):
        qs = User.objects.select_related('role').order_by('username')
        role = request.query_params.get('role', '').strip().upper()
        q = request.query_params.get('q', '').strip()
        include_inactive = request.query_params.get('include_inactive', '').lower() in (
            '1',
            'true',
            'yes',
        )
        include_admins = request.query_params.get('include_admins', '').lower() in (
            '1',
            'true',
            'yes',
        )
        if role:
            qs = qs.filter(role__code=role)
        elif not include_admins:
            # Default management list: supervisors + employees only.
            qs = qs.filter(role__code__in=STAFF_ROLE_CODES)
        if q:
            qs = qs.filter(
                Q(username__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(email__icontains=q)
                | Q(employee_id__icontains=q)
            )
        if not include_inactive:
            qs = qs.filter(is_active=True)
        return Response(UserSerializer(qs, many=True).data)

    def post(self, request):
        ser = StaffUserCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = ser.save()
        AuditLog.objects.create(
            user=request.user,
            action='CREATE',
            entity_type='User',
            entity_id=user.id,
            details={'username': user.username, 'role': user.role_code},
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class StaffUserDetailView(APIView):
    """Admin: update / activate / deactivate / delete supervisors and employees."""

    permission_classes = [IsAdmin]

    def get(self, request, pk):
        user = _get_manageable_staff(pk)
        return Response(UserSerializer(user).data)

    def patch(self, request, pk):
        user = _get_manageable_staff(pk)
        # Admins are already rejected by _get_manageable_staff; keep a self-guard for safety.
        if user.id == request.user.id:
            raise ApiError(
                'VALIDATION_ERROR',
                'You cannot edit your own account from the staff users API',
            )

        ser = StaffUserUpdateSerializer(user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        user = ser.save()
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='User',
            entity_id=user.id,
            details={'username': user.username, 'role': user.role_code, 'is_active': user.is_active},
        )
        return Response(UserSerializer(user).data)

    def delete(self, request, pk):
        user = _get_manageable_staff(pk)
        if user.id == request.user.id:
            raise ApiError('VALIDATION_ERROR', 'You cannot delete your own account')
        username = user.username
        user_id = user.id
        try:
            user.delete()
        except ProtectedError:
            raise ApiError(
                'CONFLICT',
                f'Cannot delete {username}: still referenced by withdrawals or transfers. '
                'Deactivate the account instead.',
                status_code=409,
            )
        AuditLog.objects.create(
            user=request.user,
            action='DELETE',
            entity_type='User',
            entity_id=user_id,
            details={'username': username},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
