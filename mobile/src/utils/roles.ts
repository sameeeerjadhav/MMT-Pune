export type RoleCode = 'ADMIN' | 'SUPERVISOR' | 'WAREHOUSE_EMPLOYEE' | string;

export type AppModule =
  | 'dashboard'
  | 'scanner'
  | 'inventory'
  | 'withdrawal'
  | 'warehouse'
  | 'grn'
  | 'grnImport'
  | 'reports'
  | 'settings'
  | 'createRack'
  | 'fifoOverride';

const ALL_STAFF: RoleCode[] = ['ADMIN', 'SUPERVISOR', 'WAREHOUSE_EMPLOYEE'];
const LEADS: RoleCode[] = ['ADMIN', 'SUPERVISOR'];

const MODULE_ROLES: Record<AppModule, RoleCode[]> = {
  dashboard: ALL_STAFF,
  scanner: ALL_STAFF,
  inventory: ALL_STAFF,
  withdrawal: ALL_STAFF,
  warehouse: ALL_STAFF,
  grn: ALL_STAFF,
  settings: ALL_STAFF,
  grnImport: LEADS,
  reports: LEADS,
  createRack: LEADS,
  fifoOverride: LEADS,
};

export function canAccess(role: RoleCode | undefined | null, module: AppModule): boolean {
  if (!role) return false;
  return MODULE_ROLES[module].includes(role);
}

export function roleLabel(role: RoleCode | undefined | null): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'SUPERVISOR':
      return 'Supervisor';
    case 'WAREHOUSE_EMPLOYEE':
      return 'Warehouse Employee';
    default:
      return role || 'Unknown';
  }
}

export function roleBlurb(role: RoleCode | undefined | null): string {
  switch (role) {
    case 'ADMIN':
      return 'Full control: inventory, GRN import, warehouses, reports, and FIFO overrides.';
    case 'SUPERVISOR':
      return 'Floor lead: operations, GRN import, rack setup, reports, and FIFO overrides.';
    case 'WAREHOUSE_EMPLOYEE':
      return 'Floor ops: scan, allocate, transfer, withdraw. No import, reports, or FIFO override.';
    default:
      return 'Signed in.';
  }
}

/** Primary bottom tabs — max 5, role-specific so each login feels different. */
export function primaryTabsForRole(role: RoleCode | undefined | null): string[] {
  if (role === 'ADMIN') {
    return ['Dashboard', 'Inventory', 'GRN', 'Reports', 'More'];
  }
  if (role === 'SUPERVISOR') {
    return ['Dashboard', 'Scanner', 'GRN', 'Warehouse', 'More'];
  }
  // Employee default
  return ['Dashboard', 'Scanner', 'Withdrawal', 'Inventory', 'More'];
}

export type MoreLink = {
  key: string;
  title: string;
  subtitle: string;
  tab: string;
  module: AppModule;
};

export function moreLinksForRole(role: RoleCode | undefined | null): MoreLink[] {
  const links: MoreLink[] = [
    {
      key: 'scan',
      title: 'Scanner',
      subtitle: 'Camera, manual, or simulate barcode',
      tab: 'Scanner',
      module: 'scanner',
    },
    {
      key: 'withdraw',
      title: 'Withdrawal',
      subtitle: 'Shipment or assembly with FIFO checks',
      tab: 'Withdrawal',
      module: 'withdrawal',
    },
    {
      key: 'warehouse',
      title: 'Warehouses & racks',
      subtitle: 'Allocate and transfer stock locations',
      tab: 'Warehouse',
      module: 'warehouse',
    },
    {
      key: 'grn',
      title: 'GRN receiving',
      subtitle: 'View receipts and generate barcodes',
      tab: 'GRN',
      module: 'grn',
    },
    {
      key: 'inventory',
      title: 'Inventory',
      subtitle: 'Batches, units, and history',
      tab: 'Inventory',
      module: 'inventory',
    },
    {
      key: 'reports',
      title: 'Reports',
      subtitle: 'Stock, occupancy, FIFO, withdrawals',
      tab: 'Reports',
      module: 'reports',
    },
    {
      key: 'settings',
      title: 'Settings',
      subtitle: 'Profile, API status, hardware HAL',
      tab: 'Settings',
      module: 'settings',
    },
  ];

  const primary = new Set(primaryTabsForRole(role));
  return links.filter((l) => canAccess(role, l.module) && !primary.has(l.tab));
}
