import {
  canAccess,
  canAccessTab,
  moreLinksForRole,
  primaryTabsForRole,
  roleLabel,
  type AppModule,
} from './roles';

const ROLES = ['ADMIN', 'SUPERVISOR', 'WAREHOUSE_EMPLOYEE'] as const;

describe('canAccess', () => {
  it('denies everything when signed out or role unknown', () => {
    expect(canAccess(null, 'dashboard')).toBe(false);
    expect(canAccess(undefined, 'scanner')).toBe(false);
    expect(canAccess('INTRUDER', 'dashboard')).toBe(false);
  });

  it('lets only the admin manage users and see the audit log', () => {
    const adminOnly: AppModule[] = ['manageUsers', 'auditLog'];
    for (const module of adminOnly) {
      expect(canAccess('ADMIN', module)).toBe(true);
      expect(canAccess('SUPERVISOR', module)).toBe(false);
      expect(canAccess('WAREHOUSE_EMPLOYEE', module)).toBe(false);
    }
  });

  it('keeps master data, reports and older-stock overrides for admin and supervisor', () => {
    const leads: AppModule[] = ['reports', 'grnImport', 'manageMasterData', 'fifoOverride', 'createRack'];
    for (const module of leads) {
      expect(canAccess('ADMIN', module)).toBe(true);
      expect(canAccess('SUPERVISOR', module)).toBe(true);
      expect(canAccess('WAREHOUSE_EMPLOYEE', module)).toBe(false);
    }
  });

  it('gives floor staff the everyday tools', () => {
    for (const module of ['scanner', 'inventory', 'withdrawal', 'counts', 'alerts'] as AppModule[]) {
      expect(canAccess('WAREHOUSE_EMPLOYEE', module)).toBe(true);
    }
  });
});

describe('tabs', () => {
  it.each(ROLES)('%s has five primary tabs with the Scanner in the centre', (role) => {
    const tabs = primaryTabsForRole(role);
    expect(tabs).toHaveLength(5);
    expect(tabs[2]).toBe('Scanner');
    expect(tabs[4]).toBe('More');
  });

  it.each(ROLES)('%s can open every one of its primary tabs', (role) => {
    for (const tab of primaryTabsForRole(role)) {
      expect(canAccessTab(role, tab)).toBe(true);
    }
  });

  it('never exposes admin tabs to other roles, and unknown tabs are closed', () => {
    expect(canAccessTab('SUPERVISOR', 'Users')).toBe(false);
    expect(canAccessTab('WAREHOUSE_EMPLOYEE', 'Audit')).toBe(false);
    expect(canAccessTab('ADMIN', 'DoesNotExist')).toBe(false);
    expect(canAccessTab('WAREHOUSE_EMPLOYEE', 'More')).toBe(true);
  });
});

describe('moreLinksForRole', () => {
  it('lists only what the role may open and nothing already in the tab bar', () => {
    for (const role of ROLES) {
      const primary = new Set(primaryTabsForRole(role));
      for (const link of moreLinksForRole(role)) {
        expect(canAccess(role, link.module)).toBe(true);
        expect(primary.has(link.tab)).toBe(false);
      }
    }
  });

  it('shows the audit log and users only to the admin', () => {
    const keys = (role: string) => moreLinksForRole(role).map((l) => l.key);
    expect(keys('ADMIN')).toEqual(expect.arrayContaining(['audit', 'users']));
    expect(keys('SUPERVISOR')).not.toEqual(expect.arrayContaining(['audit']));
    expect(keys('WAREHOUSE_EMPLOYEE')).not.toEqual(expect.arrayContaining(['users']));
  });
});

describe('roleLabel', () => {
  it('uses friendly names and falls back safely', () => {
    expect(roleLabel('ADMIN')).toBe('Administrator');
    expect(roleLabel('WAREHOUSE_EMPLOYEE')).toBe('Warehouse Employee');
    expect(roleLabel(null)).toBe('Unknown');
    expect(roleLabel('CUSTOM')).toBe('CUSTOM');
  });
});
