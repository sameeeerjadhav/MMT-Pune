from django.db.models import Q
from django.http import HttpResponse
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsWarehouseStaff
from reports.pdf import build_withdrawal_receipt_pdf
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
    serializer_class = WithdrawalSerializer

    def get_queryset(self):
        qs = Withdrawal.objects.select_related('user', 'user__role').prefetch_related(
            'lines__batch__item', 'lines__unit__item'
        ).order_by('-created_at')
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(purpose__icontains=q)
                | Q(reference__icontains=q)
                | Q(notes__icontains=q)
                | Q(user__username__icontains=q)
                | Q(user__first_name__icontains=q)
                | Q(user__last_name__icontains=q)
                | Q(lines__batch__batch_code__icontains=q)
                | Q(lines__unit__unit_code__icontains=q)
                | Q(lines__batch__item__name__icontains=q)
                | Q(lines__unit__item__name__icontains=q)
            ).distinct()
        return qs

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
        detail = (
            Withdrawal.objects.select_related('user', 'user__role')
            .prefetch_related('lines__batch__item', 'lines__unit__item')
            .get(pk=withdrawal.pk)
        )
        return Response(WithdrawalSerializer(detail).data, status=status.HTTP_201_CREATED)


class WithdrawalDetailView(generics.RetrieveAPIView):
    queryset = Withdrawal.objects.select_related('user', 'user__role').prefetch_related(
        'lines__batch__item', 'lines__unit__item', 'transactions'
    )
    serializer_class = WithdrawalSerializer


class WithdrawalPdfView(APIView):
    permission_classes = [IsWarehouseStaff]

    def get(self, request, pk):
        withdrawal = (
            Withdrawal.objects.select_related('user', 'user__role')
            .prefetch_related('lines__batch__item', 'lines__unit__item')
            .get(pk=pk)
        )
        pdf = build_withdrawal_receipt_pdf(withdrawal)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="withdrawal-{pk}.pdf"'
        return response
