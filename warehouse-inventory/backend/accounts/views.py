from django.contrib.auth import get_user_model
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView
from drf_spectacular.utils import extend_schema

from accounts.serializers import LoginSerializer, UserSerializer
from audit.models import AuditLog

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
