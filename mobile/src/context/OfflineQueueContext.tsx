import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import {
  discardJob,
  flushQueue,
  getJobs,
  initQueue,
  retryFailed as retryFailedJobs,
  setQueueOwner,
  subscribeQueue,
  type QueuedJob,
} from '../services/offlineQueue';

const SYNC_INTERVAL_MS = 20000;

type OfflineQueueValue = {
  jobs: QueuedJob[];
  pending: number;
  failed: number;
  syncing: boolean;
  /** Increments whenever a sync actually sent something, so screens can reload their data. */
  syncVersion: number;
  lastMessage: string;
  syncNow: () => Promise<void>;
  retryFailed: () => Promise<void>;
  discard: (id: string) => Promise<void>;
};

const OfflineQueueContext = createContext<OfflineQueueValue | undefined>(undefined);

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [jobs, setJobs] = useState<QueuedJob[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const [lastMessage, setLastMessage] = useState('');
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current || getJobs().every((j) => j.status !== 'pending')) return;
    busy.current = true;
    setSyncing(true);
    try {
      const result = await flushQueue();
      if (result.sent > 0) setSyncVersion((v) => v + 1);
      if (result.failed > 0) {
        setLastMessage(`${result.failed} change(s) were rejected by the server - check the list.`);
      } else if (result.offline) {
        setLastMessage('Still offline - will retry automatically.');
      } else if (result.sent > 0) {
        setLastMessage(`Synced ${result.sent} change(s).`);
      }
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  // Follow the signed-in user and the persisted queue.
  useEffect(() => {
    setQueueOwner(userId);
    const refresh = () => setJobs(getJobs());
    const unsubscribe = subscribeQueue(refresh);
    void initQueue().then(() => {
      refresh();
      if (userId != null) void sync();
    });
    return unsubscribe;
  }, [userId, sync]);

  // Retry when the app returns to the foreground and on a timer while anything is waiting.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => sub.remove();
  }, [sync]);

  const hasPending = jobs.some((j) => j.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasPending, sync]);

  // Try straight away when something new is queued.
  const pendingCount = jobs.filter((j) => j.status === 'pending').length;
  useEffect(() => {
    if (pendingCount > 0) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);

  const value = useMemo<OfflineQueueValue>(
    () => ({
      jobs,
      pending: pendingCount,
      failed: jobs.filter((j) => j.status === 'failed').length,
      syncing,
      syncVersion,
      lastMessage,
      syncNow: sync,
      retryFailed: async () => {
        setSyncing(true);
        try {
          const result = await retryFailedJobs();
          if (result.sent > 0) setSyncVersion((v) => v + 1);
        } finally {
          setSyncing(false);
        }
      },
      discard: discardJob,
    }),
    [jobs, pendingCount, syncing, syncVersion, lastMessage, sync]
  );

  return <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>;
}

export function useOfflineQueue() {
  const ctx = useContext(OfflineQueueContext);
  if (!ctx) throw new Error('useOfflineQueue must be used within OfflineQueueProvider');
  return ctx;
}
