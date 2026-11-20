# API documentation

Interactive Swagger UI: `/api/docs/`  
OpenAPI schema: `/api/schema/`

Errors use `{ code, message, details? }`. FIFO violations return HTTP 409 with code `FIFO_VIOLATION`.

## Auth

- `POST /api/auth/login/`
- `POST /api/auth/refresh/`
- `POST /api/auth/logout/`
- `GET /api/auth/profile/`

## Core

- `GET /api/health/`
- `GET /api/dashboard/`
- `GET/POST /api/grns/`, `POST /api/grns/import/`, `GET /api/grns/{id}/`
- `POST /api/grns/{id}/generate-barcodes/`
- `GET /api/inventory/`, `GET /api/inventory/scan/{barcode}/`
- `GET /api/inventory/batches/{id}/`, `GET /api/inventory/units/{id}/`
- `GET /api/inventory/{batch|unit}/{id}/history/`

## Barcodes

- `POST /api/barcodes/generate/`
- `GET /api/barcodes/{value}/` — includes `label_image_base64` (Code 128 warehouse label PNG)
- `GET /api/barcodes/{value}/label.png` — raw PNG response
- `POST /api/barcodes/{value}/print-log/`

## Warehouse

- `GET/POST /api/warehouses/`
- `GET/POST /api/racks/`, `GET /api/racks/{id}/`, `GET /api/racks/{id}/inventory/`
- `GET /api/locations/`
- `POST /api/locations/allocate/`
- `POST /api/locations/transfer/`

## Withdrawals

- `POST /api/withdrawals/validate/`
- `GET/POST /api/withdrawals/`
- `GET /api/withdrawals/{id}/`

## Reports

- `GET /api/reports/stock/`
- `GET /api/reports/grn/`
- `GET /api/reports/withdrawals/`
- `GET /api/reports/rack-occupancy/`
- `GET /api/reports/fifo/`
