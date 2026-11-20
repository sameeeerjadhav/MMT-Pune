from django.contrib.auth import authenticate
from rest_framework import serializers

from accounts.models import User


class UserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='role_code', read_only=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'employee_id', 'role')


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(
            username=attrs['username'],
            password=attrs['password'],
        )
        if not user or not user.is_active:
            # also try email login
            try:
                u = User.objects.get(email__iexact=attrs['username'])
                user = authenticate(username=u.username, password=attrs['password'])
            except User.DoesNotExist:
                user = None
        if not user or not user.is_active:
            raise serializers.ValidationError('Invalid credentials')
        attrs['user'] = user
        return attrs
