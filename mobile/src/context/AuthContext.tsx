import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setOnAuthFailure } from '../api/client';
import { authApi } from '../api/endpoints';
import * as storage from '../utils/secureStorage';

type User = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  employee_id?: string;
  is_main_admin?: boolean;
  is_active?: boolean;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isAuthRejected(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOnAuthFailure(() => setUser(null));
    return () => setOnAuthFailure(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    const finish = () => {
      if (!cancelled && !settled) {
        settled = true;
        setLoading(false);
      }
    };

    // Absolute failsafe — never leave BootLoading up forever.
    const failsafe = setTimeout(finish, 12000);

    (async () => {
      try {
        let token: string | null = null;
        try {
          token = await withTimeout(storage.getItem('accessToken'), 4000, 'secure_store');
        } catch {
          finish();
          return;
        }
        if (cancelled) return;

        if (!token) {
          finish();
          return;
        }

        try {
          const { data } = await withTimeout(authApi.profile(), 8000, 'profile');
          if (!cancelled) setUser(data);
        } catch (err) {
          // Only wipe session on real auth rejection. Timeouts/network keep tokens
          // so the next cold start (or login retry after reload) can succeed.
          if (isAuthRejected(err)) {
            try {
              await storage.deleteItem('accessToken');
              await storage.deleteItem('refreshToken');
            } catch {
              // ignore
            }
          }
          if (!cancelled) setUser(null);
        }
      } finally {
        finish();
        clearTimeout(failsafe);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await authApi.login(username, password);
    await storage.setItem('accessToken', data.access);
    await storage.setItem('refreshToken', data.refresh);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const refresh = await storage.getItem('refreshToken');
    try {
      if (refresh) await authApi.logout(refresh);
    } catch {
      // ignore
    }
    await storage.deleteItem('accessToken');
    await storage.deleteItem('refreshToken');
    setUser(null);
  }, []);

  // Stable identity — must not recreate when `user` changes (avoids focus-effect loops).
  const refreshProfile = useCallback(async () => {
    const { data } = await authApi.profile();
    setUser(data);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshProfile,
    }),
    [user, loading, login, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
