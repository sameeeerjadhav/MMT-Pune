from django.contrib.auth import authenticate
from rest_framework import serializers

from accounts.models import Role, User

# Roles an Admin may assign when creating/editing staff in-app.
STAFF_ASSIGNABLE_ROLES = (
    Role.Code.SUPERVISOR,
    Role.Code.WAREHOUSE_EMPLOYEE,
)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='role_code', read_only=True)

    class Meta:
        model = User
        fields = (
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'employee_id',
            'role',
            'is_active',
            'date_joined',
            'last_login',
        )
        read_only_fields = ('id', 'date_joined', 'last_login')


class StaffUserCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=6, write_only=True)
    email = serializers.EmailField(required=False, allow_blank=True, default='')
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    employee_id = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')
    role = serializers.ChoiceField(choices=[(c, c) for c in STAFF_ASSIGNABLE_ROLES])

    def validate_username(self, value):
        username = value.strip()
        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError('Username already taken')
        return username

    def create(self, validated_data):
        roles = User.objects.ensure_default_roles()
        role = roles[validated_data['role']]
        return User.objects.create_user(
            username=validated_data['username'],
            password=validated_data['password'],
            email=validated_data.get('email') or '',
            first_name=validated_data.get('first_name') or '',
            last_name=validated_data.get('last_name') or '',
            employee_id=validated_data.get('employee_id') or '',
            role=role,
            is_staff=False,
            is_superuser=False,
        )


class StaffUserUpdateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    employee_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    role = serializers.ChoiceField(
        choices=[(c, c) for c in STAFF_ASSIGNABLE_ROLES], required=False
    )
    is_active = serializers.BooleanField(required=False)
    password = serializers.CharField(min_length=6, write_only=True, required=False)

    def update(self, instance, validated_data):
        if 'role' in validated_data:
            roles = User.objects.ensure_default_roles()
            instance.role = roles[validated_data.pop('role')]
        password = validated_data.pop('password', None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


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
