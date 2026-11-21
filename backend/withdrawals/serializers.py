from rest_framework import serializers

from withdrawals.models import Withdrawal, WithdrawalLine


class WithdrawalLineSerializer(serializers.ModelSerializer):
    batch_code = serializers.CharField(source='batch.batch_code', read_only=True)
    unit_code = serializers.CharField(source='unit.unit_code', read_only=True)
    item_code = serializers.SerializerMethodField()
    item_name = serializers.SerializerMethodField()

    class Meta:
        model = WithdrawalLine
        fields = (
            'id',
            'batch',
            'unit',
            'batch_code',
            'unit_code',
            'item_code',
            'item_name',
            'quantity',
            'fifo_ok',
            'fifo_override',
            'override_reason',
            'previous_location',
            'created_at',
        )

    def get_item_code(self, obj):
        if obj.batch_id and obj.batch.item_id:
            return obj.batch.item.item_code
        if obj.unit_id and obj.unit.item_id:
            return obj.unit.item.item_code
        return None

    def get_item_name(self, obj):
        if obj.batch_id and obj.batch.item_id:
            return obj.batch.item.name
        if obj.unit_id and obj.unit.item_id:
            return obj.unit.item.name
        return None


class WithdrawalSerializer(serializers.ModelSerializer):
    lines = WithdrawalLineSerializer(many=True, read_only=True)
    user_name = serializers.SerializerMethodField()
    user_username = serializers.CharField(source='user.username', read_only=True)
    user_role = serializers.CharField(source='user.role_code', read_only=True)
    user_employee_id = serializers.CharField(source='user.employee_id', read_only=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = Withdrawal
        fields = (
            'id',
            'purpose',
            'reference',
            'notes',
            'user',
            'user_name',
            'user_username',
            'user_role',
            'user_employee_id',
            'user_email',
            'created_at',
            'updated_at',
            'lines',
        )

    def get_user_name(self, obj):
        full = obj.user.get_full_name().strip()
        return full or obj.user.username


class WithdrawalRequestSerializer(serializers.Serializer):
    purpose = serializers.ChoiceField(choices=['SHIPMENT', 'ASSEMBLY'])
    batch_id = serializers.IntegerField(required=False)
    unit_id = serializers.IntegerField(required=False)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, required=False)
    reference = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    override_reason = serializers.CharField(required=False, allow_blank=True)
