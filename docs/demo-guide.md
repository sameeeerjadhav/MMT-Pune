# Client demo guide

## Setup

1. `docker compose up -d` (or use existing PostgreSQL)
2. Python 3.12+ venv → `pip install -r backend/requirements.txt`
3. Copy `backend/.env.example` → `backend/.env`
4. `python manage.py migrate` then `python manage.py seed_demo`
5. `python manage.py runserver 0.0.0.0:8000`
6. `cd mobile && npm install && npx expo start` (Expo Go on Android)

## Credentials

- admin / Demo@12345
- supervisor / Demo@12345
- employee / Demo@12345

## Script (10–12 minutes)

1. **Login** as admin — dashboard metrics, FIFO alerts, recent activity.
2. **GRN list** — open GRN-1001 / GRN-1002 (Steel Bolt older/newer).
3. **Inventory** — open BATCH-001 (partially withdrawn) and BATCH-002; show Code 128 label preview image.
4. **Scanner** — Simulate BATCH-002 barcode; show FIFO warning with older location.
5. **Withdrawal** as employee — attempt BATCH-002 qty 5 — blocked (no override fields for employee).
6. **Withdrawal** as supervisor — same request with override reason — succeeds; open confirmation + recent list.
7. **Warehouses** — pick WH-MAIN, open R-01 inventory; allocate / transfer with location pickers.
8. **Import GRN** — post mock sample payload; show duplicate rejection if re-imported.
9. **Reports** — stock, occupancy, FIFO (readable rows, not raw JSON).

## Notes for stakeholders

- M1/Workroom are mocked for this demo.
- Zebra hardware is designed via HAL but not claimed complete until on-device testing.
- PostgreSQL is the source of truth; the mobile app only talks to the HTTPS/HTTP API.
