import { api } from './client';

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login/', { username, password }),
  logout: (refresh: string) => api.post('/auth/logout/', { refresh }),
  profile: () => api.get('/auth/profile/'),
};

export const dashboardApi = {
  get: () => api.get('/dashboard/'),
};

export const inventoryApi = {
  list: (params?: { q?: string; type?: string }) => api.get('/inventory/', { params }),
  batch: (id: number) => api.get(`/inventory/batches/${id}/`),
  unit: (id: number) => api.get(`/inventory/units/${id}/`),
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
};

export const grnApi = {
  list: () => api.get('/grns/'),
  detail: (id: number) => api.get(`/grns/${id}/`),
  create: (payload: unknown) => api.post('/grns/', payload),
  import: (payload: unknown) => api.post('/grns/import/', payload),
  generateBarcodes: (id: number) => api.post(`/grns/${id}/generate-barcodes/`),
};

export const warehouseApi = {
  warehouses: () => api.get('/warehouses/'),
  racks: () => api.get('/racks/'),
  rack: (id: number) => api.get(`/racks/${id}/`),
  rackInventory: (id: number) => api.get(`/racks/${id}/inventory/`),
  rackMap: (id: number) => api.get(`/racks/${id}/map/`),
  locations: () => api.get('/locations/'),
  allocate: (payload: unknown) => api.post('/locations/allocate/', payload),
  transfer: (payload: unknown) => api.post('/locations/transfer/', payload),
  createRack: (payload: unknown) => api.post('/racks/', payload),
};

export const withdrawalApi = {
  validate: (payload: unknown) => api.post('/withdrawals/validate/', payload),
  create: (payload: unknown) => api.post('/withdrawals/', payload),
  list: () => api.get('/withdrawals/'),
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
};

export const barcodeApi = {
  get: (value: string) => api.get(`/barcodes/${encodeURIComponent(value)}/`),
  labelUrl: (value: string) =>
    `${api.defaults.baseURL}/barcodes/${encodeURIComponent(value)}/label.png`,
  printLog: (value: string, payload?: unknown) =>
    api.post(`/barcodes/${encodeURIComponent(value)}/print-log/`, payload || {}),
};

export const healthApi = {
  check: () => api.get('/health/'),
};
