/**
 * Offline write queue.
 *
 * Warehouse Wi-Fi drops. For the few writes that are safe to replay later (count scans, put-away,
 * transfers) the app sends the request normally and, if the network is unreachable, stores it on
 * the phone and retries in order once the connection is back.
 *
 * Every queued request carries an `Idempotency-Key`. If the first attempt actually reached the
 * server (e.g. the response was lost), the replay returns the stored result instead of applying
 * the change twice. Withdrawals are deliberately NOT queued: they depend on live oldest-first
 * stock checks that cannot be decided offline.
 */
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { api, getErrorMessage } from '../api/client';

export type QueuedJobType = 'count_scan' | 'allocate' | 'transfer';

export type QueuedJob = {
  id: string;
  /** Idempotency-Key sent with every attempt of this request. */
  key: string;
  type: QueuedJobType;
  path: string;
  body: Record<string, unknown>;
  userId: number;
  /** Short human description for the sync list, e.g. "Count #4 · scan U0000000012". */
  label: string;
  meta?: { sessionId?: number };
  createdAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  error?: string;
};

export type FlushResult = { sent: number; failed: number; remaining: number; offline: boolean };

const QUEUE_FILE = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}offline-queue.json` : null;

let jobs: QueuedJob[] = [];
let loaded: Promise<void> | null = null;
let owner: number | null = null;
let flushing: Promise<FlushResult> | null = null;
const listeners = new Set<() => void>();

function randomPart() {
  return Math.random().toString(36).slice(2, 10);
}

export function newIdempotencyKey() {
  return `${Date.now().toString(36)}-${randomPart()}${randomPart()}`;
}

/** True when the request never got an HTTP response (offline, Wi-Fi dropped, timeout). */
export function isNetworkError(error: unknown) {
  return axios.isAxiosError(error) && !error.response;
}

function notify() {
  listeners.forEach((fn) => fn());
}

async function persist() {
  if (!QUEUE_FILE) return;
  try {
    await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(jobs));
  } catch {
    // The in-memory queue still works for this session.
  }
}

function ensureLoaded() {
  if (!loaded) {
    loaded = (async () => {
      if (!QUEUE_FILE) return;
      try {
        const info = await FileSystem.getInfoAsync(QUEUE_FILE);
        if (!info.exists) return;
        const parsed = JSON.parse(await FileSystem.readAsStringAsync(QUEUE_FILE));
        if (Array.isArray(parsed)) jobs = parsed;
      } catch {
        // Corrupt file: start clean rather than blocking the app.
        jobs = [];
      }
    })();
  }
  return loaded;
}

export async function initQueue() {
  await ensureLoaded();
  notify();
}

/** Only the signed-in user's jobs are shown and sent (their token is the one that is valid). */
export function setQueueOwner(userId: number | null) {
  owner = userId;
  notify();
}

export function getJobs(): QueuedJob[] {
  return jobs.filter((j) => j.userId === owner);
}

export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function patchJob(id: string, patch: Partial<QueuedJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
}

async function addJob(input: Omit<QueuedJob, 'id' | 'createdAt' | 'attempts' | 'status' | 'userId'>) {
  await ensureLoaded();
  if (owner == null) throw new Error('Sign in before queueing changes');
  jobs = [
    ...jobs,
    {
      ...input,
      id: `${Date.now().toString(36)}-${randomPart()}`,
      userId: owner,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    },
  ];
  await persist();
  notify();
}

export type PostOrQueueResult = { queued: false; data: any } | { queued: true };

/**
 * POST now; if the network is unreachable, keep the request (same Idempotency-Key) for later.
 * Server rejections (validation, permission, ...) are thrown as usual - those would fail on replay too.
 */
export async function postOrQueue(args: {
  type: QueuedJobType;
  path: string;
  body: Record<string, unknown>;
  label: string;
  meta?: QueuedJob['meta'];
}): Promise<PostOrQueueResult> {
  const key = newIdempotencyKey();
  try {
    const res = await api.post(args.path, args.body, { headers: { 'Idempotency-Key': key } });
    return { queued: false, data: res.data };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await addJob({ key, type: args.type, path: args.path, body: args.body, label: args.label, meta: args.meta });
    return { queued: true };
  }
}

async function doFlush(): Promise<FlushResult> {
  await ensureLoaded();
  let sent = 0;
  let failed = 0;
  let offline = false;

  for (const job of getJobs().filter((j) => j.status === 'pending')) {
    try {
      await api.post(job.path, job.body, { headers: { 'Idempotency-Key': job.key } });
      jobs = jobs.filter((j) => j.id !== job.id);
      sent += 1;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      const retryLater = !status || status === 401 || status === 408 || status === 429 || status >= 500;
      if (retryLater) {
        // Keep order: stop here and try again later rather than skipping ahead.
        patchJob(job.id, { attempts: job.attempts + 1 });
        offline = !status;
        await persist();
        notify();
        break;
      }
      patchJob(job.id, { status: 'failed', error: getErrorMessage(error), attempts: job.attempts + 1 });
      failed += 1;
    }
    await persist();
    notify();
  }

  return { sent, failed, remaining: getJobs().filter((j) => j.status === 'pending').length, offline };
}

/** Send queued changes in order. Only one flush runs at a time. */
export function flushQueue(): Promise<FlushResult> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

/** Put rejected jobs back in line (e.g. after the cause was fixed) and send again. */
export async function retryFailed() {
  await ensureLoaded();
  jobs = jobs.map((j) => (j.userId === owner && j.status === 'failed' ? { ...j, status: 'pending', error: undefined } : j));
  await persist();
  notify();
  return flushQueue();
}

export async function discardJob(id: string) {
  await ensureLoaded();
  jobs = jobs.filter((j) => j.id !== id);
  await persist();
  notify();
}
