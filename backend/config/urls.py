from django.contrib import admin
from django.urls import path, re_path
from django.views.generic import RedirectView
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from inventory.media_urls import serve_signed_media

from accounts.views import (
    HealthView,
    LoginView,
    LogoutView,
    ProfileView,
    RefreshView,
    StaffUserDetailView,
    StaffUserListCreateView,
)
from barcodes.views import (
    BarcodeDetailView,
    BarcodeLabelImageView,
    BarcodeLabelPdfView,
    GenerateBarcodeView,
    PrintLogView,
)
from grn.views import GRNDetailView, GRNGenerateBarcodesView, GRNImportView, GRNListCreateView
from inventory.views import (
    AllocationDetailView,
    BatchDetailView,
    CategoryListView,
    DashboardView,
    InventoryHistoryView,
    InventoryListView,
    ItemDetailView,
    ItemImageUploadView,
    ItemListCreateView,
    ScanBarcodeView,
    UnitDetailView,
)
from reports.views import (
    FIFOReportView,
    GRNReportView,
    RackOccupancyReportView,
    StockReportView,
    WithdrawalReportPdfView,
    WithdrawalReportView,
)
from warehouses.views import (
    AllocateView,
    DeallocateView,
    FloorDetailView,
    FloorLayoutView,
    FloorListCreateView,
    FloorMapView,
    FloorPlaceRackView,
    LocationListView,
    RackDetailView,
    RackInventoryView,
    RackLayoutView,
    RackListCreateView,
    RackMapView,
    TransferView,
    WarehouseDetailView,
    WarehouseListCreateView,
)
from withdrawals.views import (
    WithdrawalDetailView,
    WithdrawalListCreateView,
    WithdrawalPdfView,
    WithdrawalValidateView,
)

urlpatterns = [
    path('', RedirectView.as_view(url='/api/docs/', permanent=False)),
    path('admin/', admin.site.urls),
    path('api/health/', HealthView.as_view()),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/auth/login/', LoginView.as_view()),
    path('api/auth/refresh/', RefreshView.as_view()),
    path('api/auth/logout/', LogoutView.as_view()),
    path('api/auth/profile/', ProfileView.as_view()),
    path('api/users/', StaffUserListCreateView.as_view()),
    path('api/users/<int:pk>/', StaffUserDetailView.as_view()),
    path('api/dashboard/', DashboardView.as_view()),
    path('api/grns/', GRNListCreateView.as_view()),
    path('api/grns/import/', GRNImportView.as_view()),
    path('api/grns/<int:pk>/', GRNDetailView.as_view()),
    path('api/grns/<int:pk>/generate-barcodes/', GRNGenerateBarcodesView.as_view()),
    path('api/inventory/', InventoryListView.as_view()),
    path('api/inventory/categories/', CategoryListView.as_view()),
    path('api/inventory/items/', ItemListCreateView.as_view()),
    path('api/inventory/items/<int:pk>/', ItemDetailView.as_view()),
    path('api/inventory/batches/<int:pk>/', BatchDetailView.as_view()),
    path('api/inventory/units/<int:pk>/', UnitDetailView.as_view()),
    path('api/inventory/items/<int:pk>/image/', ItemImageUploadView.as_view()),
    path('api/inventory/scan/<str:barcode>/', ScanBarcodeView.as_view()),
    path('api/inventory/<str:inv_type>/<int:pk>/history/', InventoryHistoryView.as_view()),
    path('api/allocations/<int:pk>/', AllocationDetailView.as_view()),
    path('api/barcodes/generate/', GenerateBarcodeView.as_view()),
    path('api/barcodes/<str:value>/label.png', BarcodeLabelImageView.as_view()),
    path('api/barcodes/<str:value>/label.pdf', BarcodeLabelPdfView.as_view()),
    path('api/barcodes/<str:value>/', BarcodeDetailView.as_view()),
    path('api/barcodes/<str:value>/print-log/', PrintLogView.as_view()),
    path('api/warehouses/', WarehouseListCreateView.as_view()),
    path('api/warehouses/<int:pk>/', WarehouseDetailView.as_view()),
    path('api/floors/', FloorListCreateView.as_view()),
    path('api/floors/<int:pk>/', FloorDetailView.as_view()),
    path('api/floors/<int:pk>/map/', FloorMapView.as_view()),
    path('api/floors/<int:pk>/layout/', FloorLayoutView.as_view()),
    path('api/floors/<int:pk>/place-rack/', FloorPlaceRackView.as_view()),
    path('api/racks/', RackListCreateView.as_view()),
    path('api/racks/<int:pk>/', RackDetailView.as_view()),
    path('api/racks/<int:pk>/inventory/', RackInventoryView.as_view()),
    path('api/racks/<int:pk>/map/', RackMapView.as_view()),
    path('api/racks/<int:pk>/layout/', RackLayoutView.as_view()),
    path('api/locations/', LocationListView.as_view()),
    path('api/locations/allocate/', AllocateView.as_view()),
    path('api/locations/deallocate/', DeallocateView.as_view()),
    path('api/locations/transfer/', TransferView.as_view()),
    path('api/withdrawals/validate/', WithdrawalValidateView.as_view()),
    path('api/withdrawals/', WithdrawalListCreateView.as_view()),
    path('api/withdrawals/<int:pk>/', WithdrawalDetailView.as_view()),
    path('api/withdrawals/<int:pk>/pdf/', WithdrawalPdfView.as_view()),
    path('api/reports/stock/', StockReportView.as_view()),
    path('api/reports/grn/', GRNReportView.as_view()),
    path('api/reports/withdrawals/', WithdrawalReportView.as_view()),
    path('api/reports/withdrawals/pdf/', WithdrawalReportPdfView.as_view()),
    path('api/reports/rack-occupancy/', RackOccupancyReportView.as_view()),
    path('api/reports/fifo/', FIFOReportView.as_view()),
]

# Serve uploaded media with a signed query param (serializers attach ?sig=...).
# django.conf.urls.static.static() is a no-op when DEBUG=False, so use serve explicitly.
urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve_signed_media),
]
