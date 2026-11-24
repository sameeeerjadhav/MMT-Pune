import axios from 'axios';
import Constants from 'expo-constants';
import * as storage from '../utils/secureStorage';

type ExtraConfig = {
  apiUrl?: string;
  /** When true, Expo Go (__DEV__) uses apiUrl instead of the LAN debugger host. */
  preferRemoteApiInDev?: boolean;
};

const hostUri = Constants.expoConfig?.hostUri;
const debuggerHost = hostUri?.split(':')[0];
const extra = Constants.expoConfig?.extra as ExtraConfig | undefined;
const configuredApiUrl = (extra?.apiUrl || '').trim();
const localApiUrl = debuggerHost
  ? `http://${debuggerHost}:8000/api`
  : 'http://127.0.0.1:8000/api';

// Release builds always use configured production URL.
// In Expo Go, default to LAN so local runserver keeps working; set
// extra.preferRemoteApiInDev=true to hit the VPS while developing.
export const API_BASE_URL =
  __DEV__ && !extra?.preferRemoteApiInDev
    ? localApiUrl
    : configuredApiUrl || localApiUrl;

/** Seed/demo UI only when talking to a local backend in Expo Go. */
export const SHOW_DEMO_TOOLS = __DEV__ && API_BASE_URL === localApiUrl;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

type AuthFailureHandler = () => void;
let onAuthFailure: AuthFailureHandler | null = null;

/** Register a handler (e.g. clear user) when refresh fails and session is cleared. */
export function setOnAuthFailure(handler: AuthFailureHandler | null) {
  onAuthFailure = handler;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await storage.getItem('refreshToken');
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/refresh/`, { refresh });
    await storage.setItem('accessToken', data.access);
    if (data.refresh) await storage.setItem('refreshToken', data.refresh);
    return data.access as string;
  } catch {
    await storage.deleteItem('accessToken');
    await storage.deleteItem('refreshToken');
    onAuthFailure?.();
    return null;
  }
}

api.interceptors.request.use(async (config) => {
  try {
    const token = await Promise.race([
      storage.getItem('accessToken'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Proceed without auth header rather than hanging the request.
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const url = String(original?.url || '');
    const skipRefresh = url.includes('/auth/login/') || url.includes('/auth/refresh/');
    if (error.response?.status === 401 && original && !original._retry && !skipRefresh) {
      original._retry = true;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const access = await refreshPromise;
      if (access) {
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(error: unknown): string {
  const err = error as {
    response?: {
      data?:
        | string
        | {
            message?: string;
            detail?: string | string[] | Record<string, unknown>;
            details?: unknown;
            code?: string;
            non_field_errors?: string[];
          };
    };
    message?: string;
  };
  const data = err.response?.data;
  if (typeof data === 'string' && data.trim()) {
    // Avoid dumping HTML error pages
    if (data.trim().startsWith('<')) return 'Request failed';
    return data.length > 180 ? `${data.slice(0, 180)}…` : data;
  }
  if (data && typeof data === 'object') {
    // The API uses "Request failed" as a generic message for validation errors and puts the
    // real reason (e.g. "current_password: Current password is incorrect") in `details`.
    const isGenericMessage = data.message === 'Request failed' && Boolean(data.details);
    if (data.message && !isGenericMessage) return data.message;
    if (Array.isArray(data.non_field_errors) && data.non_field_errors.length) {
      return data.non_field_errors.join('; ');
    }
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map(String).join('; ');

    const details = data.details;
    if (typeof details === 'string') return details;
    if (Array.isArray(details)) return details.map(String).join('; ');
    if (details && typeof details === 'object') {
      const parts = Object.entries(details as Record<string, unknown>).map(([key, value]) => {
        if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
        if (value && typeof value === 'object') return `${key}: ${JSON.stringify(value)}`;
        return `${key}: ${String(value)}`;
      });
      if (parts.length) return parts.join('; ');
    }

    // Plain DRF field-error shape: { field: ["msg"] }
    if (!('message' in data) && !('code' in data)) {
      const parts = Object.entries(data as Record<string, unknown>)
        .filter(([k]) => k !== 'detail')
        .map(([key, value]) => {
          if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
          return `${key}: ${String(value)}`;
        });
      if (parts.length) return parts.join('; ');
    }
  }

  return err.message || 'Something went wrong';
}
