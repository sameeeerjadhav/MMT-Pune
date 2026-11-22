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
  | 'editFloorLayout'
  | 'fifoOverride'
  | 'manageMasterData'
  | 'manageUsers';

const ALL_STAFF: RoleCode[] = ['ADMIN', 'SUPERVISOR', 'WAREHOUSE_EMPLOYEE'];
const LEADS: RoleCode[] = ['ADMIN', 'SUPERVISOR'];
const ADMIN_ONLY: RoleCode[] = ['ADMIN'];

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
  editFloorLayout: LEADS,
  fifoOverride: LEADS,
  manageMasterData: LEADS,
  manageUsers: ADMIN_ONLY,
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
      return 'Full control: create supervisors/employees, floors, racks, GRN, reports, and FIFO overrides.';
    case 'SUPERVISOR':
      return 'Floor lead: floor grids, master data, GRN import, reports, and FIFO overrides.';
    case 'WAREHOUSE_EMPLOYEE':
      return 'Floor ops: scan, allocate, transfer, withdraw. No master-data edits or FIFO override.';
    default:
      return 'Signed in.';
  }
}

/** Map tab route names to access modules (More is always allowed). */
export const TAB_ACCESS: Record<string, AppModule | null> = {
  Dashboard: 'dashboard',
  Scanner: 'scanner',
  Inventory: 'inventory',
  Withdrawal: 'withdrawal',
  GRN: 'grn',
  Warehouse: 'warehouse',
  Reports: 'reports',
  Users: 'manageUsers',
  Settings: 'settings',
  More: null,
};

export function canAccessTab(role: RoleCode | undefined | null, tabName: string): boolean {
  const module = TAB_ACCESS[tabName];
  if (module === null) return true;
  if (!module) return false;
  return canAccess(role, module);
}

/** Primary bottom tabs — max 5, role-specific. Scanner is always the center tab. */
export function primaryTabsForRole(role: RoleCode | undefined | null): string[] {
  // Pattern: [left, left, Scanner, right, More]
  if (role === 'ADMIN') {
    // Racks tab = visual shelf/position map + stock management
    return ['Dashboard', 'Inventory', 'Scanner', 'Warehouse', 'More'];
  }
  if (role === 'SUPERVISOR') {
    return ['Dashboard', 'GRN', 'Scanner', 'Warehouse', 'More'];
  }
  // Employee default
  return ['Dashboard', 'Withdrawal', 'Scanner', 'Inventory', 'More'];
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
      title: 'Racks map',
      subtitle: 'Visual rows/columns and stock allocate / transfer',
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
      key: 'users',
      title: 'Users',
      subtitle: 'Create supervisors and warehouse employees',
      tab: 'Users',
      module: 'manageUsers',
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
