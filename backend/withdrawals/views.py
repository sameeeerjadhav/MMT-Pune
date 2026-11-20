from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsWarehouseStaff
from withdrawals.serializers import (
    WithdrawalRequestSerializer,
    WithdrawalSerializer,
)
from withdrawals.services import create_withdrawal, validate_withdrawal
from withdrawals.models import Withdrawal


class WithdrawalValidateView(APIView):
    permission_classes = [IsWarehouseStaff]

    def post(self, request):
        data = validate_withdrawal(
            batch_id=request.data.get('batch_id'),
            unit_id=request.data.get('unit_id'),
            quantity=request.data.get('quantity'),
        )
        return Response(data)


class WithdrawalListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsWarehouseStaff]
    queryset = Withdrawal.objects.select_related('user').prefetch_related(
        'lines__batch', 'lines__unit'
    )
    serializer_class = WithdrawalSerializer

    def create(self, request, *args, **kwargs):
        serializer = WithdrawalRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        withdrawal = create_withdrawal(
            user=request.user,
            purpose=data['purpose'],
            batch_id=data.get('batch_id'),
            unit_id=data.get('unit_id'),
            quantity=data.get('quantity'),
            reference=data.get('reference', ''),
            notes=data.get('notes', ''),
            override_reason=data.get('override_reason', ''),
        )
        return Response(
            WithdrawalSerializer(Withdrawal.objects.get(pk=withdrawal.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class WithdrawalDetailView(generics.RetrieveAPIView):
    queryset = Withdrawal.objects.select_related('user').prefetch_related(
        'lines__batch', 'lines__unit', 'transactions'
    )
    serializer_class = WithdrawalSerializer
