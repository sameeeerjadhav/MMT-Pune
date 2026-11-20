# API documentation

Interactive Swagger UI: `/api/docs/`

## Auth

- `POST /api/auth/login/`
- `POST /api/auth/refresh/`
- `POST /api/auth/logout/`
- `GET /api/auth/profile/`

## Core

- `GET /api/dashboard/`
- `GET/POST /api/grns/`, `POST /api/grns/import/`, `GET /api/grns/{id}/`
- `GET /api/inventory/`, `GET /api/inventory/scan/{barcode}/`
- `GET /api/inventory/batches/{id}/`, `GET /api/inventory/units/{id}/`
- `POST /api/barcodes/generate/`, `GET /api/barcodes/{value}/`
- `GET/POST /api/warehouses/`, `GET/POST /api/racks/`
- `POST /api/locations/allocate/`, `POST /api/locations/transfer/`
- `POST /api/withdrawals/validate/`, `POST /api/withdrawals/`
- Reports under `/api/reports/*`
- Health: `GET /api/health/`

Errors use `{ code, message, details? }`. FIFO violations return HTTP 409 with code `FIFO_VIOLATION`.
