import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOnAuthFailure(() => setUser(null));
    return () => setOnAuthFailure(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = await storage.getItem('accessToken');
        if (token) {
          const { data } = await authApi.profile();
          setUser(data);
        }
      } catch {
        await storage.deleteItem('accessToken');
        await storage.deleteItem('refreshToken');
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(username, password) {
        const { data } = await authApi.login(username, password);
        await storage.setItem('accessToken', data.access);
        await storage.setItem('refreshToken', data.refresh);
        setUser(data.user);
      },
      async logout() {
        const refresh = await storage.getItem('refreshToken');
        try {
          if (refresh) await authApi.logout(refresh);
        } catch {
          // ignore
        }
        await storage.deleteItem('accessToken');
        await storage.deleteItem('refreshToken');
        setUser(null);
      },
      async refreshProfile() {
        const { data } = await authApi.profile();
        setUser(data);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
