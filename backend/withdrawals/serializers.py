from rest_framework import serializers

from withdrawals.models import Withdrawal, WithdrawalLine


class WithdrawalLineSerializer(serializers.ModelSerializer):
    batch_code = serializers.CharField(source='batch.batch_code', read_only=True)
    unit_code = serializers.CharField(source='unit.unit_code', read_only=True)

    class Meta:
        model = WithdrawalLine
        fields = '__all__'


class WithdrawalSerializer(serializers.ModelSerializer):
    lines = WithdrawalLineSerializer(many=True, read_only=True)
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)

    class Meta:
        model = Withdrawal
        fields = '__all__'


class WithdrawalRequestSerializer(serializers.Serializer):
    purpose = serializers.ChoiceField(choices=['SHIPMENT', 'ASSEMBLY'])
    batch_id = serializers.IntegerField(required=False)
    unit_id = serializers.IntegerField(required=False)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, required=False)
    reference = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    override_reason = serializers.CharField(required=False, allow_blank=True)
