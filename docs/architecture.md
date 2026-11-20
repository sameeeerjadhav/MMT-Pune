# Architecture

## Stack

- Mobile: Expo + React Native + TypeScript + React Navigation + Axios + SecureStore
- Backend: Django + Django REST Framework + SimpleJWT + drf-spectacular
- Database: PostgreSQL (source of truth)
- Local DB: Docker Compose
- Production target: Linux VPS + Nginx + Gunicorn + HTTPS

## Boundaries

- All stock mutations happen in Django service layers with `transaction.atomic()` and `select_for_update()`.
- Mobile screens call `/api/*` only; no direct database access.
- Integrations (`M1`, `Workroom`) are stub classes; demo uses mock GRN import.
- Hardware scanners/printers use HAL interfaces; demo uses camera/manual/preview.

## FIFO

Validated on withdrawal validate/create endpoints. Older eligible bulk batches or individual units block newer withdrawals unless a supervisor/admin supplies an override reason (audited).
