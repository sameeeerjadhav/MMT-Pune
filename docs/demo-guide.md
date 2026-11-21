# Client demo guide (development)

**Phase:** Development / demo polish only. No VPS deployment in this phase.

## Setup (local)

1. Use local PostgreSQL (already installed) or `docker compose up -d`
2. Python 3.12+ venv → `pip install -r backend/requirements.txt`
3. Copy `backend/.env.example` → `backend/.env`
   - Include your LAN IP in `DJANGO_ALLOWED_HOSTS` for phone testing
4. `python manage.py migrate` then `python manage.py seed_demo`
5. `python manage.py runserver 0.0.0.0:8000`
6. `cd mobile && npm install && npx expo start` (Expo Go on Android)

Optional PC browser preview:

```bash
cd mobile
npx expo start --web --port 8082
```

Open http://localhost:8082 (requires CORS origins for 8082 in `.env`).

## Credentials (dev only)

| User | Password | Role |
|------|----------|------|
| `admin` | `Demo@12345` | Administrator |
| `supervisor` | `Demo@12345` | Supervisor |
| `employee` | `Demo@12345` | Warehouse Employee |

## What each login shows

| Role | Primary tabs | Key powers |
|------|--------------|------------|
| Employee | Home · Scan · Out · Stock · More | Scan, allocate, transfer, withdraw. **No** import, reports, FIFO override |
| Supervisor | Home · Scan · GRN · Racks · More | Import GRN, create racks, reports, FIFO override |
| Admin | Home · Stock · GRN · Reports · More | Full control + reports |

## Walkthrough script (~12 minutes)

1. **Login as employee** — show floor tabs (no Reports). Dashboard metrics from PostgreSQL.
2. **Scan** — Simulate BATCH-002. Show Steel Bolt + FIFO risk if older stock remains.
3. **Out (Withdrawal)** — try qty 5 on BATCH-002 → **FIFO VIOLATION**. Confirm employee cannot override.
4. **Sign out → Login as supervisor** — tabs now include GRN + Racks.
5. **Withdrawal** — same BATCH-002 with override reason → success + confirmation.
6. **GRN** — open GRN-1001 / GRN-1002; show Import button; import sample, then re-import → duplicate rejected.
7. **Racks** — WH-MAIN → R-01; allocate / transfer with pickers.
8. **Sign out → Login as admin** — Reports tab visible.
9. **Inventory / Stock** — BATCH-001 & BATCH-002; Code 128 label preview.
10. **Reports** — stock, occupancy, FIFO (readable rows).

## Stakeholder notes

- M1 / Workroom are **mock/stub only**.
- Zebra DataWedge / Link-OS are **HAL stubs** (camera + manual for demo).
- PostgreSQL is the source of truth; mobile talks only to the API.
- Deployment (Phase 4 / VPS) is **deferred** until development sign-off.
