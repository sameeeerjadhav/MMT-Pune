import axios from 'axios';
import Constants from 'expo-constants';
import * as storage from '../utils/secureStorage';

const hostUri = Constants.expoConfig?.hostUri;
const debuggerHost = hostUri?.split(':')[0];

export const API_BASE_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  (debuggerHost ? `http://${debuggerHost}:8000/api` : 'http://127.0.0.1:8000/api');

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
  const token = await storage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retry) {
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
  const err = error as { response?: { data?: { message?: string; details?: unknown } }; message?: string };
  return err.response?.data?.message || err.message || 'Something went wrong';
}
