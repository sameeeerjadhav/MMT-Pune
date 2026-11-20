# Client demo guide

## Setup

1. `docker compose up -d`
2. Activate venv, migrate, `python manage.py seed_demo`
3. `python manage.py runserver 0.0.0.0:8000`
4. `cd mobile && npx expo start` (scan QR with Expo Go)

## Credentials

- admin / Demo@12345
- supervisor / Demo@12345
- employee / Demo@12345

## Script (10 minutes)

1. **Login** as admin — show dashboard metrics and FIFO alerts.
2. **GRN list** — open GRN-1001 / GRN-1002 (Steel Bolt older/newer).
3. **Inventory** — open BATCH-001 (partially withdrawn) and BATCH-002.
4. **Scanner** — Simulate BATCH-002 barcode; show FIFO warning with older location.
5. **Withdrawal** as employee — attempt BATCH-002 qty 5 — blocked.
6. **Withdrawal** as supervisor — same request with override reason — succeeds and is audited.
7. **Racks** — open R-01 inventory; show allocate/transfer screens.
8. **Import GRN** — post mock sample payload; show duplicate rejection if re-imported.
9. **Reports** — FIFO + stock reports.

## Notes for stakeholders

- M1/Workroom are mocked for this demo.
- Zebra hardware is designed via HAL but not claimed complete until on-device testing.
