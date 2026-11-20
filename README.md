# Warehouse Inventory Management System

React Native (Expo) mobile app + Django REST Framework + PostgreSQL for airport-equipment warehouse operations.

## Demo credentials (local development only)

| User | Password | Role |
|---|---|---|
| `admin` | `Demo@12345` | Administrator |
| `supervisor` | `Demo@12345` | Supervisor |
| `employee` | `Demo@12345` | Warehouse Employee |

Do not use these credentials in production.

## Quick start (local)

### 1. Database

```bash
docker compose up -d
```

PostgreSQL: `warehouse` / `warehouse_pass` @ `127.0.0.1:5432` / `warehouse_inventory`

### 2. Backend

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r backend/requirements.txt
cd backend
copy .env.example .env
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 0.0.0.0:8000
```

- API health: http://127.0.0.1:8000/api/health/
- Swagger: http://127.0.0.1:8000/api/docs/

### 3. Mobile

```bash
cd mobile
npm install
npx expo start
```

On a physical Android device, ensure the phone can reach your PC IP on port 8000. The Axios client auto-uses the Expo debugger host IP when available.

## FIFO demo

1. Login as `employee` or `admin`.
2. Open Scanner → Simulate BATCH-002 (or Withdrawal → Load BATCH-002).
3. Confirm withdrawal of quantity 5.
4. Backend returns **FIFO VIOLATION** pointing to BATCH-001 (10 Nov, available 80, location WH-MAIN/R-01/A/01).
5. Login as `supervisor`, retry with an override reason to demonstrate audited override.

## Project layout

```

  backend/     Django + DRF + PostgreSQL
  mobile/      Expo React Native
  docs/        Architecture, API, deployment, demo guide
  docker-compose.yml
```

## Important limitations

- M1 / Workroom integrations are **mock/stub only** until real APIs and credentials are provided.
- Zebra DataWedge / Link-OS are **HAL stubs** — camera + manual entry are used for demo.
- Do not deploy to VPS without explicit approval.
