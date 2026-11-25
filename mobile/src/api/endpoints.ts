import { api } from './client';

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login/', { username, password }),
  logout: (refresh: string, access?: string | null) =>
    api.post(
      '/auth/logout/',
      { refresh },
      access ? { headers: { Authorization: `Bearer ${access}` } } : undefined
    ),
  profile: () => api.get('/auth/profile/'),
  updateProfile: (payload: Record<string, unknown>) => api.patch('/auth/profile/', payload),
};

export const usersApi = {
  list: (params?: { q?: string; role?: string; include_inactive?: string }) =>
    api.get('/users/', { params }),
  detail: (id: number) => api.get(`/users/${id}/`),
  create: (payload: unknown) => api.post('/users/', payload),
  update: (id: number, payload: unknown) => api.patch(`/users/${id}/`, payload),
  delete: (id: number) => api.delete(`/users/${id}/`),
};

export const dashboardApi = {
  get: () => api.get('/dashboard/'),
};

export const inventoryApi = {
  list: (
    params?: {
      q?: string;
      type?: string;
      testing_status?: string;
      status?: string;
      allocated?: string;
      ordering?: string;
      low_stock?: string;
      limit?: number;
    },
    config?: { signal?: AbortSignal }
  ) => api.get('/inventory/', { params, signal: config?.signal }),
  categories: (params?: { q?: string }) => api.get('/inventory/categories/', { params }),
  items: (params?: { q?: string; include_inactive?: string }) =>
    api.get('/inventory/items/', { params }),
  item: (id: number) => api.get(`/inventory/items/${id}/`),
  createItem: (payload: unknown) => api.post('/inventory/items/', payload),
  updateItem: (id: number, payload: unknown) => api.patch(`/inventory/items/${id}/`, payload),
  deleteItem: (id: number) => api.delete(`/inventory/items/${id}/`),
  batch: (id: number) => api.get(`/inventory/batches/${id}/`),
  updateBatchTesting: (id: number, testing_status: string) =>
    api.patch(`/inventory/batches/${id}/`, { testing_status }),
  /** Set (or clear with null) the batch expiry date, `YYYY-MM-DD`. */
  updateBatchExpiry: (id: number, expiry_date: string | null) =>
    api.patch(`/inventory/batches/${id}/`, { expiry_date }),
  unit: (id: number) => api.get(`/inventory/units/${id}/`),
  updateUnitTesting: (id: number, testing_status: string) =>
    api.patch(`/inventory/units/${id}/`, { testing_status }),
  scan: (barcode: string) => api.get(`/inventory/scan/${encodeURIComponent(barcode)}/`),
  history: (type: 'batch' | 'unit', id: number) =>
    api.get(`/inventory/${type}/${id}/history/`),
  uploadItemImage: (itemId: number, file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('image', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
    // Do not set Content-Type manually — RN/Axios must add the multipart boundary.
    return api.post(`/inventory/items/${itemId}/image/`, form, {
      headers: { 'Content-Type': undefined as unknown as string },
      transformRequest: [(data, headers) => {
        if (headers && typeof headers === 'object') {
          delete (headers as Record<string, unknown>)['Content-Type'];
        }
        return data;
      }],
      timeout: 60000,
    });
  },
  deleteItemImage: async (itemId: number) => {
    // Query + JSON body so clear is detected even when multipart FormData is stripped.
    // Falls back to DELETE for older servers that never had POST clear.
    try {
      return await api.post(
        `/inventory/items/${itemId}/image/?clear=1`,
        { clear: true },
        { timeout: 30000 }
      );
    } catch (err: unknown) {
      try {
        return await api.delete(`/inventory/items/${itemId}/image/`, { timeout: 30000 });
      } catch {
        throw err;
      }
    }
  },
};

export const grnApi = {
  list: (params?: { q?: string }) => api.get('/grns/', { params }),
  detail: (id: number) => api.get(`/grns/${id}/`),
  create: (payload: unknown) => api.post('/grns/', payload),
  import: (payload: unknown) => api.post('/grns/import/', payload),
  generateBarcodes: (id: number) => api.post(`/grns/${id}/generate-barcodes/`),
  /** One page of label commands for every barcode on the GRN. */
  printCommands: (id: number, printerId: number, offset = 0, limit = 40) =>
    api.get(`/grns/${id}/print-commands/`, {
      params: { printer_id: printerId, offset, limit },
    }),
  printLog: (id: number, printer: string, values: string[]) =>
    api.post(`/grns/${id}/print-log/`, { printer, values }),
};

export const warehouseApi = {
  warehouses: (params?: { q?: string; include_inactive?: string }) =>
    api.get('/warehouses/', { params }),
  warehouse: (id: number) => api.get(`/warehouses/${id}/`),
  createWarehouse: (payload: unknown) => api.post('/warehouses/', payload),
  updateWarehouse: (id: number, payload: unknown) => api.patch(`/warehouses/${id}/`, payload),
  deleteWarehouse: (id: number) => api.delete(`/warehouses/${id}/`),
  floors: (params?: { warehouse?: number }) => api.get('/floors/', { params }),
  floor: (id: number) => api.get(`/floors/${id}/`),
  floorMap: (id: number) => api.get(`/floors/${id}/map/`),
  createFloor: (payload: unknown) => api.post('/floors/', payload),
  updateFloorLayout: (id: number, payload: unknown) =>
    api.patch(`/floors/${id}/layout/`, payload),
  placeRack: (floorId: number, payload: unknown) =>
    api.post(`/floors/${floorId}/place-rack/`, payload),
  racks: (params?: {
    q?: string;
    warehouse?: number | string;
    floor?: number;
    include_inactive?: string;
  }) => api.get('/racks/', { params }),
  rack: (id: number) => api.get(`/racks/${id}/`),
  updateRack: (id: number, payload: unknown) => api.patch(`/racks/${id}/`, payload),
  deleteRack: (id: number) => api.delete(`/racks/${id}/`),
  rackInventory: (id: number) => api.get(`/racks/${id}/inventory/`),
  rackMap: (id: number) => api.get(`/racks/${id}/map/`),
  updateRackLayout: (id: number, payload: unknown) =>
    api.patch(`/racks/${id}/layout/`, payload),
  locations: (params?: { q?: string }) => api.get('/locations/', { params }),
  allocation: (id: number) => api.get(`/allocations/${id}/`),
  allocate: (payload: unknown) => api.post('/locations/allocate/', payload),
  deallocate: (payload: unknown) => api.post('/locations/deallocate/', payload),
  transfer: (payload: unknown) => api.post('/locations/transfer/', payload),
  createRack: (payload: unknown) => api.post('/racks/', payload),
};

export const withdrawalApi = {
  validate: (payload: unknown) => api.post('/withdrawals/validate/', payload),
  create: (payload: unknown) => api.post('/withdrawals/', payload),
  list: (params?: { q?: string }) => api.get('/withdrawals/', { params }),
  detail: (id: number) => api.get(`/withdrawals/${id}/`),
  pdfPath: (id: number) => `/withdrawals/${id}/pdf/`,
};

export const reportsApi = {
  stock: () => api.get('/reports/stock/'),
  grn: () => api.get('/reports/grn/'),
  withdrawals: () => api.get('/reports/withdrawals/'),
  withdrawalsPdfPath: () => `/reports/withdrawals/pdf/`,
  occupancy: () => api.get('/reports/rack-occupancy/'),
  fifo: () => api.get('/reports/fifo/'),
  /** Spreadsheet-friendly exports (CSV opens in Excel). */
  csvPath: (name: 'stock' | 'grn' | 'withdrawals' | 'rack-occupancy') => `/reports/${name}.csv`,
};

export const alertsApi = {
  get: (days?: number) => api.get('/alerts/', { params: days ? { days } : undefined }),
};

export type AuditLogParams = {
  action?: string;
  entity_type?: string;
  user_id?: number;
  date_from?: string;
  date_to?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export const auditApi = {
  list: (params?: AuditLogParams) => api.get('/audit-logs/', { params }),
};

export const countsApi = {
  list: (params?: { status?: string; rack_id?: number; mine?: string }) =>
    api.get('/counts/', { params }),
  start: (rackId: number, notes?: string) => api.post('/counts/', { rack_id: rackId, notes }),
  detail: (id: number) => api.get(`/counts/${id}/`),
  removeLine: (id: number, lineId: number) => api.delete(`/counts/${id}/lines/${lineId}/`),
  submit: (id: number) => api.post(`/counts/${id}/submit/`),
  varianceCsvPath: (id: number) => `/counts/${id}/variance.csv`,
  scanPath: (id: number) => `/counts/${id}/scan/`,
};

export const barcodeApi = {
  get: (value: string) => api.get(`/barcodes/${encodeURIComponent(value)}/`),
  labelUrl: (value: string) =>
    `${api.defaults.baseURL}/barcodes/${encodeURIComponent(value)}/label.png`,
  labelPdfPath: (value: string) => `/barcodes/${encodeURIComponent(value)}/label.pdf`,
  printLog: (value: string, payload?: unknown) =>
    api.post(`/barcodes/${encodeURIComponent(value)}/print-log/`, payload || {}),
  printCommands: (value: string, printerId: number) =>
    api.get(`/barcodes/${encodeURIComponent(value)}/print-commands/`, {
      params: { printer_id: printerId },
    }),
};

export const printersApi = {
  list: (activeOnly = false) =>
    api.get('/printers/', { params: activeOnly ? { active: 1 } : undefined }),
  create: (payload: Record<string, unknown>) => api.post('/printers/', payload),
  update: (id: number, payload: Record<string, unknown>) => api.patch(`/printers/${id}/`, payload),
  remove: (id: number) => api.delete(`/printers/${id}/`),
  testLabel: (id: number) => api.get(`/printers/${id}/test-label/`),
};

export const healthApi = {
  check: () => api.get('/health/'),
};
