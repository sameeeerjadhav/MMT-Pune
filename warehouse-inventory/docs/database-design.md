# Database design

PostgreSQL models (Django ORM):

- accounts: Role, User
- barcodes: Barcode, PrintLog
- warehouses: Warehouse, Rack, Shelf, RackPosition, RackTransfer
- inventory: Category, Vendor, Item, InventoryBatch, InventoryUnit, StockAllocation, InventoryTransaction
- grn: GRN, GRNLine
- withdrawals: Withdrawal, WithdrawalLine
- integrations: IntegrationLog
- audit: AuditLog

Key constraints:

- Unique barcode values
- Unique GRN numbers
- Unique (external_system, external_ref) when external_ref is set
- Batch and unit codes unique
- Inventory transactions are append-only
