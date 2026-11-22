from django.contrib.auth import get_user_model
from django.db.models import Q
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
        if role:
            qs = qs.filter(role__code=role)
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
    """Admin: update / deactivate supervisors and employees."""

    permission_classes = [IsAdmin]

    def get(self, request, pk):
        user = get_object_or_404(User.objects.select_related('role'), pk=pk)
        return Response(UserSerializer(user).data)

    def patch(self, request, pk):
        user = get_object_or_404(User.objects.select_related('role'), pk=pk)
        if user.id == request.user.id and request.data.get('is_active') is False:
            raise ApiError('VALIDATION_ERROR', 'You cannot deactivate your own account')
        if user.role_code == Role.Code.ADMIN and 'role' in request.data:
            raise ApiError(
                'VALIDATION_ERROR',
                'Cannot change an Admin role from the app. Use Django admin if needed.',
            )
        if user.role_code == Role.Code.ADMIN and request.data.get('is_active') is False:
            raise ApiError('VALIDATION_ERROR', 'Cannot deactivate another Admin from the app')

        ser = StaffUserUpdateSerializer(user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)

        # Only allow role changes for non-admin targets into assignable staff roles.
        if 'role' in ser.validated_data and user.role_code == Role.Code.ADMIN:
            raise ApiError('VALIDATION_ERROR', 'Cannot change Admin role')

        user = ser.save()
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='User',
            entity_id=user.id,
            details={'username': user.username, 'role': user.role_code, 'is_active': user.is_active},
        )
        return Response(UserSerializer(user).data)
