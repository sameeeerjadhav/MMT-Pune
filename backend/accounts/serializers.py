from django.contrib.auth import authenticate
from rest_framework import serializers

from accounts.models import Role, User

# Roles any Admin may assign when creating users (including more admins).
ADMIN_CREATABLE_ROLES = (
    Role.Code.ADMIN,
    Role.Code.SUPERVISOR,
    Role.Code.WAREHOUSE_EMPLOYEE,
)

# Floor staff roles — any admin may assign these when editing.
STAFF_ASSIGNABLE_ROLES = (
    Role.Code.SUPERVISOR,
    Role.Code.WAREHOUSE_EMPLOYEE,
)

# Only the main admin may promote someone to Admin while editing.
MAIN_ADMIN_ASSIGNABLE_ROLES = STAFF_ASSIGNABLE_ROLES + (Role.Code.ADMIN,)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='role_code', read_only=True)
    is_main_admin = serializers.SerializerMethodField()

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
            'is_main_admin',
            'date_joined',
            'last_login',
        )
        read_only_fields = ('id', 'date_joined', 'last_login', 'is_main_admin')

    def get_is_main_admin(self, obj):
        # Read-only flag — never claim here (listing/create would promote arbitrary users).
        # Claim runs only on login/profile for request.user.
        return bool(obj.is_superuser)


class StaffUserCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=6, write_only=True)
    email = serializers.EmailField(required=False, allow_blank=True, default='')
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')
    employee_id = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')
    role = serializers.CharField()

    def validate_username(self, value):
        username = value.strip()
        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError('Username already taken')
        return username

    def validate_role(self, value):
        role = (value or '').strip().upper()
        if role not in ADMIN_CREATABLE_ROLES:
            raise serializers.ValidationError('Invalid role')
        return role

    def create(self, validated_data):
        roles = User.objects.ensure_default_roles()
        role_code = validated_data['role']
        role = roles[role_code]
        is_admin = role_code == Role.Code.ADMIN
        return User.objects.create_user(
            username=validated_data['username'],
            password=validated_data['password'],
            email=validated_data.get('email') or '',
            first_name=validated_data.get('first_name') or '',
            last_name=validated_data.get('last_name') or '',
            employee_id=validated_data.get('employee_id') or '',
            role=role,
            # Secondary admins get staff console access but never become another main admin.
            is_staff=is_admin,
            is_superuser=False,
        )


class StaffUserUpdateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    employee_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    role = serializers.CharField(required=False)
    is_active = serializers.BooleanField(required=False)
    password = serializers.CharField(min_length=6, write_only=True, required=False)

    def validate_role(self, value):
        role = (value or '').strip().upper()
        actor = self.context['request'].user
        # Read current seat only — never claim during a staff PATCH.
        allowed = (
            MAIN_ADMIN_ASSIGNABLE_ROLES if actor.is_superuser else STAFF_ASSIGNABLE_ROLES
        )
        if role not in allowed:
            if role == Role.Code.ADMIN:
                raise serializers.ValidationError(
                    'Only the main admin can assign the Admin role'
                )
            raise serializers.ValidationError('Invalid role')
        return role

    def update(self, instance, validated_data):
        if instance.is_superuser:
            raise serializers.ValidationError('The main admin account cannot be edited here')
        if 'role' in validated_data:
            roles = User.objects.ensure_default_roles()
            role_code = validated_data.pop('role')
            instance.role = roles[role_code]
            instance.is_staff = role_code == Role.Code.ADMIN
            # Never elevate to main admin via this API.
            instance.is_superuser = False
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
