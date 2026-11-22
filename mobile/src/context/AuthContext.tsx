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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOnAuthFailure(() => setUser(null));
    return () => setOnAuthFailure(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Wait for SecureStore — never treat a slow read as "logged out".
        // On hard hang, timeout leaves tokens in place for the next cold start.
        let token: string | null = null;
        try {
          token = await withTimeout(storage.getItem('accessToken'), 10000, 'secure_store');
        } catch {
          if (!cancelled) setLoading(false);
          return;
        }
        if (cancelled) return;

        if (!token) {
          setLoading(false);
          return;
        }

        // Keep boot spinner until profile settles so Login does not flash.
        const { data } = await withTimeout(authApi.profile(), 15000, 'profile');
        if (!cancelled) setUser(data);
      } catch {
        await storage.deleteItem('accessToken');
        await storage.deleteItem('refreshToken');
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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
