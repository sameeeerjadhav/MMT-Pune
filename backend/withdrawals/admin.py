from django.contrib import admin

from withdrawals.models import Withdrawal, WithdrawalLine


class WithdrawalLineInline(admin.TabularInline):
    model = WithdrawalLine
    extra = 0
    readonly_fields = (
        'batch',
        'unit',
        'quantity',
        'fifo_ok',
        'fifo_override',
        'override_reason',
        'previous_location',
    )


@admin.register(Withdrawal)
class WithdrawalAdmin(admin.ModelAdmin):
    list_display = ('id', 'purpose', 'reference', 'user', 'created_at')
    list_filter = ('purpose',)
    inlines = [WithdrawalLineInline]


@admin.register(WithdrawalLine)
class WithdrawalLineAdmin(admin.ModelAdmin):
    list_display = ('withdrawal', 'batch', 'unit', 'quantity', 'fifo_ok', 'fifo_override')
