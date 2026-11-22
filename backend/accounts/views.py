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


def _is_main_admin(user) -> bool:
    """Main admin = is_superuser only. Do not claim here (login/profile claim the seat)."""
    if not user or not user.is_authenticated:
        return False
    return bool(user.is_superuser)


def _get_manageable_user(request, pk) -> User:
    """
    - Any admin may manage supervisors / warehouse employees.
    - Only the main admin may manage secondary Admin accounts.
    - The main admin account itself is never managed here.
    """
    actor = request.user
    user = get_object_or_404(User.objects.select_related('role'), pk=pk)
    if user.id == actor.id:
        raise ApiError(
            'VALIDATION_ERROR',
            'You cannot manage your own account from the users API',
        )
    if user.is_superuser:
        raise ApiError(
            'VALIDATION_ERROR',
            'The main admin account cannot be managed from this API.',
            status_code=400,
        )
    if user.role_code == Role.Code.ADMIN:
        if not _is_main_admin(actor):
            raise ApiError(
                'FORBIDDEN',
                'Only the main admin can manage other admin accounts.',
                status_code=403,
            )
        return user
    if user.role_code not in STAFF_ROLE_CODES:
        raise ApiError(
            'VALIDATION_ERROR',
            'Only supervisors, warehouse employees, and (for main admin) admins can be managed here.',
            status_code=400,
        )
    return user


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'anon'

    @extend_schema(request=LoginSerializer, responses=UserSerializer)
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.claim_main_admin_if_needed()
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
        request.user.claim_main_admin_if_needed()
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


class StaffUserListCreateView(APIView):
    """Admin: list/create staff. Main admin may also create secondary admins."""

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
        if role:
            qs = qs.filter(role__code=role)
        else:
            # All admins see supervisors, employees, and admin accounts.
            qs = qs.filter(
                Q(role__code__in=STAFF_ROLE_CODES)
                | Q(role__code=Role.Code.ADMIN)
                | Q(is_superuser=True)
            )
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
        ser = StaffUserCreateSerializer(data=request.data, context={'request': request})
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
    """Admin: update / activate / deactivate / delete manageable users."""

    permission_classes = [IsAdmin]

    def get(self, request, pk):
        user = _get_manageable_user(request, pk)
        return Response(UserSerializer(user).data)

    def patch(self, request, pk):
        user = _get_manageable_user(request, pk)
        ser = StaffUserUpdateSerializer(
            user, data=request.data, partial=True, context={'request': request}
        )
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
        user = _get_manageable_user(request, pk)
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
