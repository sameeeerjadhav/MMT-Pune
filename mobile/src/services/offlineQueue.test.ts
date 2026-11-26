import { AxiosError } from 'axios';

type Queue = typeof import('./offlineQueue');

const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');
const serverError = (status: number, data: unknown = { message: 'Rejected' }) =>
  new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, { status, data } as never);

let post: jest.Mock;
let files: Record<string, string>;
let queue: Queue;

/** Fresh copy of the module (and fake phone storage) for every test, since the queue keeps state. */
function load(existingFiles: Record<string, string> = {}) {
  jest.resetModules();
  files = existingFiles;
  post = jest.fn();
  jest.doMock('../api/client', () => ({
    api: { post: (...args: unknown[]) => post(...args) },
    getErrorMessage: (e: { message?: string }) => e?.message || 'error',
  }));
  jest.doMock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///docs/',
    getInfoAsync: async (path: string) => ({ exists: path in files }),
    readAsStringAsync: async (path: string) => files[path],
    writeAsStringAsync: async (path: string, text: string) => {
      files[path] = text;
    },
  }));
  queue = require('./offlineQueue');
}

const scan = (code: string) => ({
  type: 'count_scan' as const,
  path: '/counts/1/scan/',
  body: { code },
  label: `Scan ${code}`,
});

beforeEach(() => load());

describe('postOrQueue', () => {
  it('sends online requests immediately with an Idempotency-Key and queues nothing', async () => {
    queue.setQueueOwner(1);
    post.mockResolvedValueOnce({ data: { ok: true } });

    const result = await queue.postOrQueue(scan('U1'));

    expect(result).toEqual({ queued: false, data: { ok: true } });
    expect(post).toHaveBeenCalledWith('/counts/1/scan/', { code: 'U1' }, { headers: { 'Idempotency-Key': expect.any(String) } });
    expect(queue.getJobs()).toHaveLength(0);
  });

  it('keeps the request when the network is down, reusing the same key on replay', async () => {
    queue.setQueueOwner(1);
    post.mockRejectedValueOnce(networkError());
    const result = await queue.postOrQueue(scan('U1'));
    const firstKey = post.mock.calls[0][2].headers['Idempotency-Key'];

    expect(result).toEqual({ queued: true });
    expect(queue.getJobs()).toHaveLength(1);
    expect(queue.getJobs()[0].key).toBe(firstKey);

    post.mockResolvedValueOnce({ data: {} });
    await queue.flushQueue();
    expect(post.mock.calls[1][2].headers['Idempotency-Key']).toBe(firstKey);
  });

  it('does not queue requests the server rejected - they would fail again', async () => {
    queue.setQueueOwner(1);
    post.mockRejectedValueOnce(serverError(400));
    await expect(queue.postOrQueue(scan('U1'))).rejects.toBeTruthy();
    expect(queue.getJobs()).toHaveLength(0);
  });

  it('refuses to queue when nobody is signed in', async () => {
    post.mockRejectedValueOnce(networkError());
    await expect(queue.postOrQueue(scan('U1'))).rejects.toThrow('Sign in');
  });
});

describe('flushQueue', () => {
  async function queueThree() {
    queue.setQueueOwner(1);
    post.mockRejectedValue(networkError());
    for (const code of ['A', 'B', 'C']) await queue.postOrQueue(scan(code));
    post.mockReset();
  }

  it('sends everything in the order it was queued and empties the queue', async () => {
    await queueThree();
    post.mockResolvedValue({ data: {} });

    const result = await queue.flushQueue();

    expect(result).toEqual({ sent: 3, failed: 0, remaining: 0, offline: false });
    expect(post.mock.calls.map((c) => c[1].code)).toEqual(['A', 'B', 'C']);
    expect(queue.getJobs()).toHaveLength(0);
  });

  it('stops at the first unreachable request so order is preserved', async () => {
    await queueThree();
    post.mockResolvedValueOnce({ data: {} }).mockRejectedValue(networkError());

    const result = await queue.flushQueue();

    expect(result).toEqual({ sent: 1, failed: 0, remaining: 2, offline: true });
    expect(post).toHaveBeenCalledTimes(2);
    expect(queue.getJobs().map((j) => j.label)).toEqual(['Scan B', 'Scan C']);
  });

  it('marks a rejected request as failed and carries on with the rest', async () => {
    await queueThree();
    post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(serverError(400))
      .mockResolvedValueOnce({ data: {} });

    const result = await queue.flushQueue();

    expect(result).toMatchObject({ sent: 2, failed: 1, remaining: 0 });
    const left = queue.getJobs();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ label: 'Scan B', status: 'failed' });
  });

  it('treats server errors (5xx) as "try again later", not as a failure', async () => {
    await queueThree();
    post.mockRejectedValue(serverError(503));

    const result = await queue.flushQueue();

    expect(result).toMatchObject({ sent: 0, failed: 0, remaining: 3 });
    expect(queue.getJobs().every((j) => j.status === 'pending')).toBe(true);
  });

  it('runs only one flush at a time', async () => {
    await queueThree();
    post.mockResolvedValue({ data: {} });
    const [a, b] = await Promise.all([queue.flushQueue(), queue.flushQueue()]);
    expect(a).toBe(b);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('retryFailed puts rejected jobs back in line and sends them', async () => {
    queue.setQueueOwner(1);
    post.mockRejectedValueOnce(networkError());
    await queue.postOrQueue(scan('A'));
    post.mockRejectedValueOnce(serverError(400));
    await queue.flushQueue();
    expect(queue.getJobs()[0].status).toBe('failed');

    post.mockResolvedValueOnce({ data: {} });
    const result = await queue.retryFailed();
    expect(result).toMatchObject({ sent: 1, remaining: 0 });
  });
});

describe('ownership and persistence', () => {
  it("only shows and sends the signed-in user's jobs", async () => {
    queue.setQueueOwner(1);
    post.mockRejectedValueOnce(networkError());
    await queue.postOrQueue(scan('MINE'));

    queue.setQueueOwner(2);
    expect(queue.getJobs()).toHaveLength(0);
    post.mockReset();
    await queue.flushQueue();
    expect(post).not.toHaveBeenCalled();

    queue.setQueueOwner(1);
    expect(queue.getJobs()).toHaveLength(1);
  });

  it('survives an app restart', async () => {
    queue.setQueueOwner(1);
    post.mockRejectedValueOnce(networkError());
    await queue.postOrQueue(scan('KEEP'));
    const saved = { ...files };

    load(saved); // "restart": fresh module, same phone storage
    queue.setQueueOwner(1);
    await queue.initQueue();
    expect(queue.getJobs().map((j) => j.label)).toEqual(['Scan KEEP']);
  });

  it('starts clean if the saved file is corrupt', async () => {
    load({ 'file:///docs/offline-queue.json': '{not json' });
    queue.setQueueOwner(1);
    await queue.initQueue();
    expect(queue.getJobs()).toEqual([]);
  });

  it('discardJob removes a job for good', async () => {
    queue.setQueueOwner(1);
    post.mockRejectedValueOnce(networkError());
    await queue.postOrQueue(scan('X'));
    await queue.discardJob(queue.getJobs()[0].id);
    expect(queue.getJobs()).toHaveLength(0);
  });
});
