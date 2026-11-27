from contextlib import contextmanager

from django.contrib.auth import authenticate
from django.db import IntegrityError, transaction
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


def _duplicate_error(*, username='', email='', exclude_pk=None):
    """
    After an IntegrityError, name the field that clashed. The serializers check for duplicates
    first, so this only happens when a concurrent request saved the same value in between.
    Returns None when the failure was something else, so the caller can re-raise it.
    """
    others = User.objects.exclude(pk=exclude_pk) if exclude_pk is not None else User.objects.all()
    if email and others.filter(email__iexact=email).exists():
        return serializers.ValidationError({'email': ['Email already in use']})
    if username and others.filter(username__iexact=username).exists():
        return serializers.ValidationError({'username': ['Username already taken']})
    return None


@contextmanager
def _translate_duplicates(*, username='', email='', exclude_pk=None):
    """Turn a duplicate username/email database error into a normal 400 validation error."""
    try:
        with transaction.atomic():
            yield
    except IntegrityError:
        error = _duplicate_error(username=username, email=email, exclude_pk=exclude_pk)
        if error is None:
            raise
        raise error


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

    def validate_email(self, value):
        email = (value or '').strip()
        # Login also accepts email, so it must identify exactly one account.
        if email and User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError('Email already in use')
        return email

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
        with _translate_duplicates(
            username=validated_data['username'], email=validated_data.get('email') or ''
        ):
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

    def validate_email(self, value):
        email = (value or '').strip()
        clash = User.objects.filter(email__iexact=email)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if email and clash.exists():
            raise serializers.ValidationError('Email already in use')
        return email

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
        with _translate_duplicates(email=instance.email, exclude_pk=instance.pk):
            instance.save()
        return instance


class ProfileUpdateSerializer(serializers.Serializer):
    """
    Self-service edit of the signed-in user's own account.

    - Everyone: first_name, last_name, email, and their own password (needs current_password).
    - Admins only: username and employee_id (other roles get these assigned by an admin).
    - Never editable here: role, is_active, is_staff, is_superuser.
    """

    ADMIN_ONLY_FIELDS = ('username', 'employee_id')

    username = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    employee_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    current_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    new_password = serializers.CharField(min_length=6, write_only=True, required=False)

    def validate_username(self, value):
        username = value.strip()
        if not username:
            raise serializers.ValidationError('Username cannot be empty')
        clash = User.objects.filter(username__iexact=username).exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError('Username already taken')
        return username

    def validate_email(self, value):
        email = (value or '').strip()
        # Login also accepts email, so it must identify exactly one account.
        if email and User.objects.filter(email__iexact=email).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError('Email already in use')
        return email

    def validate(self, attrs):
        user = self.instance
        if not user.has_role('ADMIN'):
            for field in self.ADMIN_ONLY_FIELDS:
                if field in attrs and attrs[field] != getattr(user, field):
                    raise serializers.ValidationError(
                        {field: 'Only an admin can change this field'}
                    )
        if attrs.get('new_password'):
            if not user.check_password(attrs.get('current_password') or ''):
                raise serializers.ValidationError(
                    {'current_password': 'Current password is incorrect'}
                )
        return attrs

    def update(self, instance, validated_data):
        validated_data.pop('current_password', None)
        new_password = validated_data.pop('new_password', None)
        self.changed_fields = [
            key for key, value in validated_data.items() if getattr(instance, key) != value
        ]
        for key, value in validated_data.items():
            setattr(instance, key, value)
        self.password_changed = bool(new_password)
        if new_password:
            instance.set_password(new_password)
        with _translate_duplicates(
            username=instance.username, email=instance.email, exclude_pk=instance.pk
        ):
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
            # Also try email login — only when the email identifies exactly one account.
            matches = list(User.objects.filter(email__iexact=attrs['username'])[:2])
            user = (
                authenticate(username=matches[0].username, password=attrs['password'])
                if len(matches) == 1
                else None
            )
        if not user or not user.is_active:
            raise serializers.ValidationError('Invalid credentials')
        attrs['user'] = user
        return attrs
