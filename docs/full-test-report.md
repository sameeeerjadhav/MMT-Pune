# Full test report — Warehouse Inventory

Date: 2026-11-21  
Scope: Full API + PC web UI (Expo web at http://localhost:8082). Phone Expo Go not automated.

## Preference

User requested **full tests only** (not partial smoke). Saved in agent store.

## API results (21 checks after RBAC fix)

| Area | Result |
|------|--------|
| Login employee / supervisor / admin | PASS |
| Employee dashboard, inventory, locations | PASS |
| Employee scan BATCH-002 | PASS |
| Employee FIFO block on BATCH-002 | PASS |
| Employee cannot FIFO override | PASS |
| Employee cannot import GRN | PASS |
| Employee reports blocked (403) | PASS (fixed during test) |
| Supervisor FIFO override | PASS |
| Supervisor GRN list + import + duplicate reject | PASS |
| Supervisor reports / racks | PASS |
| Admin all reports | PASS |
| Admin Code 128 label PNG | PASS |
| Admin withdraw older BATCH-001 | PASS |
| Admin profile | PASS |

## UI results (PC browser)

| Role | Tabs observed | Result |
|------|---------------|--------|
| Employee | Home · Scan · Out · Stock · More | PASS |
| Supervisor | Home · Scan · GRN · Racks · More | PASS |
| Admin | Home · Stock · GRN · Reports · More | PASS |

| UI flow | Result |
|---------|--------|
| Employee login + dashboard metrics | PASS |
| Employee Scan → Simulate BATCH-002 → BATCH detail | PASS |
| Employee Withdrawal screen | PASS |
| Employee More → Sign out | PASS |
| Supervisor login (Hello Sara) + GRN tab | PASS |
| Supervisor Sign out | PASS |
| Admin login (Hello Admin) + Reports tab + stock report click | PASS |

## Fix applied during full test

- Reports endpoints now require `IsSupervisorOrAdmin` (employees get 403).

## Not covered by automation

- Physical phone Expo Go / camera hardware
- Physical Zebra scanner/printer
- Live M1 / Workroom APIs (stubs by design)
