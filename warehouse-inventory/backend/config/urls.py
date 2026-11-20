from django.contrib import admin
from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from accounts.views import HealthView, LoginView, LogoutView, ProfileView, RefreshView
from barcodes.views import BarcodeDetailView, GenerateBarcodeView, PrintLogView
from grn.views import GRNDetailView, GRNGenerateBarcodesView, GRNImportView, GRNListCreateView
from inventory.views import (
    BatchDetailView,
    DashboardView,
    InventoryHistoryView,
    InventoryListView,
    ScanBarcodeView,
    UnitDetailView,
)
from reports.views import (
    FIFOReportView,
    GRNReportView,
    RackOccupancyReportView,
    StockReportView,
    WithdrawalReportView,
)
from warehouses.views import (
    AllocateView,
    LocationListView,
    RackDetailView,
    RackInventoryView,
    RackListCreateView,
    TransferView,
    WarehouseListCreateView,
)
from withdrawals.views import WithdrawalDetailView, WithdrawalListCreateView, WithdrawalValidateView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', HealthView.as_view()),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/auth/login/', LoginView.as_view()),
    path('api/auth/refresh/', RefreshView.as_view()),
    path('api/auth/logout/', LogoutView.as_view()),
    path('api/auth/profile/', ProfileView.as_view()),
    path('api/dashboard/', DashboardView.as_view()),
    path('api/grns/', GRNListCreateView.as_view()),
    path('api/grns/import/', GRNImportView.as_view()),
    path('api/grns/<int:pk>/', GRNDetailView.as_view()),
    path('api/grns/<int:pk>/generate-barcodes/', GRNGenerateBarcodesView.as_view()),
    path('api/inventory/', InventoryListView.as_view()),
    path('api/inventory/batches/<int:pk>/', BatchDetailView.as_view()),
    path('api/inventory/units/<int:pk>/', UnitDetailView.as_view()),
    path('api/inventory/scan/<str:barcode>/', ScanBarcodeView.as_view()),
    path('api/inventory/<str:inv_type>/<int:pk>/history/', InventoryHistoryView.as_view()),
    path('api/barcodes/generate/', GenerateBarcodeView.as_view()),
    path('api/barcodes/<str:value>/', BarcodeDetailView.as_view()),
    path('api/barcodes/<str:value>/print-log/', PrintLogView.as_view()),
    path('api/warehouses/', WarehouseListCreateView.as_view()),
    path('api/racks/', RackListCreateView.as_view()),
    path('api/racks/<int:pk>/', RackDetailView.as_view()),
    path('api/racks/<int:pk>/inventory/', RackInventoryView.as_view()),
    path('api/locations/', LocationListView.as_view()),
    path('api/locations/allocate/', AllocateView.as_view()),
    path('api/locations/transfer/', TransferView.as_view()),
    path('api/withdrawals/validate/', WithdrawalValidateView.as_view()),
    path('api/withdrawals/', WithdrawalListCreateView.as_view()),
    path('api/withdrawals/<int:pk>/', WithdrawalDetailView.as_view()),
    path('api/reports/stock/', StockReportView.as_view()),
    path('api/reports/grn/', GRNReportView.as_view()),
    path('api/reports/withdrawals/', WithdrawalReportView.as_view()),
    path('api/reports/rack-occupancy/', RackOccupancyReportView.as_view()),
    path('api/reports/fifo/', FIFOReportView.as_view()),
]
