import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest } from 'next';
import {
  NonAbortableWorkGate,
  ViewerAdmissionError,
  ViewerWorkCoordinator,
  VIEWER_ADMISSION_MAX_WORK,
  createViewerAdmissionLimiter,
  viewerClientKey,
  viewerFetchWithTimeout,
} from '@/lib/server/viewerResourceControl';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

function request(
  remoteAddress: string,
  headers: NextApiRequest['headers'] = {},
): NextApiRequest {
  return { headers, socket: { remoteAddress } } as unknown as NextApiRequest;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('viewer request admission', () => {
  it('trusts forwarding headers only in a Vercel runtime', () => {
    delete process.env.VERCEL;
    const req = request('::ffff:127.0.0.1', {
      'x-forwarded-for': '203.0.113.10',
      'x-vercel-forwarded-for': '198.51.100.20',
      'x-real-ip': '198.51.100.21',
    });
    expect(viewerClientKey(req)).toBe('127.0.0.1');

    process.env.VERCEL = '1';
    expect(viewerClientKey(req)).toBe('203.0.113.10');
  });

  it('allows normal work, expires stale buckets, and bounds client storage', () => {
    const limiter = createViewerAdmissionLimiter({
      windowMs: 1_000,
      maxWork: 3,
      maxClients: 2,
    });
    expect(limiter.consume('one', 0, 0).allowed).toBe(true);
    expect(limiter.entryCountForTests()).toBe(0);
    expect(limiter.consume('one', 2, 0).allowed).toBe(true);
    expect(limiter.consume('one', 1, 1).allowed).toBe(true);
    expect(limiter.consume('one', 1, 2)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });

    expect(limiter.consume('two', 1, 2).allowed).toBe(true);
    expect(limiter.consume('three', 1, 2).allowed).toBe(true);
    expect(limiter.entryCountForTests()).toBe(2);
    expect(limiter.consume('two', 1, 1_002).allowed).toBe(true);
  });

  it('comfortably allows a normal three-provider counter cadence', () => {
    const limiter = createViewerAdmissionLimiter();
    for (let poll = 0; poll < 6; poll += 1) {
      expect(limiter.consume('counter', 3, poll * 10_000).allowed).toBe(true);
    }
    expect(6 * 3).toBeLessThan(VIEWER_ADMISSION_MAX_WORK);
  });
});

describe('bounded viewer work coordination', () => {
  it('coalesces identical work and leaves cache hits uncharged', async () => {
    const limiter = createViewerAdmissionLimiter({ maxWork: 1, maxClients: 10 });
    const coordinator = new ViewerWorkCoordinator<number>({
      cacheTtlMs: 8_000,
      cacheMaxEntries: 10,
      inFlightMax: 2,
      limiter,
    });
    const pending = deferred<number>();
    const run = vi.fn(() => pending.promise);

    const first = coordinator.resolve([{ key: 'same', run }], 'client');
    const second = coordinator.resolve([{ key: 'same', run }], 'client');
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(coordinator.statsForTests().inFlight).toBe(1);

    pending.resolve(7);
    await expect(first).resolves.toEqual([7]);
    await expect(second).resolves.toEqual([7]);
    await expect(coordinator.resolve([{ key: 'same', run }], 'client')).resolves.toEqual([7]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(() => coordinator.resolve([
      { key: 'new', run: async () => 8 },
    ], 'client')).toThrow(ViewerAdmissionError);
  });

  it('admits through the in-flight cap, preserves active work, and releases slots', async () => {
    const coordinator = new ViewerWorkCoordinator<number>({
      cacheTtlMs: 0,
      cacheMaxEntries: 10,
      inFlightMax: 2,
      limiter: createViewerAdmissionLimiter({ maxWork: 100, maxClients: 10 }),
    });
    const one = deferred<number>();
    const two = deferred<number>();
    const runOne = vi.fn(() => one.promise);
    const runTwo = vi.fn(() => two.promise);

    const first = coordinator.resolve([{ key: 'one', run: runOne }], 'client');
    const second = coordinator.resolve([{ key: 'two', run: runTwo }], 'client');
    const joined = coordinator.resolve([{ key: 'one', run: runOne }], 'client');
    expect(coordinator.statsForTests().inFlight).toBe(2);
    expect(() => coordinator.resolve([
      { key: 'three', run: async () => 3 },
    ], 'client')).toThrow(ViewerAdmissionError);

    one.resolve(1);
    await expect(first).resolves.toEqual([1]);
    await expect(joined).resolves.toEqual([1]);
    await Promise.resolve();
    expect(coordinator.statsForTests().inFlight).toBe(1);

    await expect(coordinator.resolve([
      { key: 'three', run: async () => 3 },
    ], 'client')).resolves.toEqual([3]);
    two.resolve(2);
    await expect(second).resolves.toEqual([2]);
    expect(runOne).toHaveBeenCalledTimes(1);
    expect(runTwo).toHaveBeenCalledTimes(1);
  });

  it('releases an in-flight slot after upstream rejection', async () => {
    const coordinator = new ViewerWorkCoordinator<number>({
      cacheTtlMs: 8_000,
      cacheMaxEntries: 10,
      inFlightMax: 1,
      limiter: createViewerAdmissionLimiter({ maxWork: 100, maxClients: 10 }),
    });
    const pending = deferred<number>();
    const failed = coordinator.resolve([
      { key: 'failed', run: () => pending.promise },
    ], 'client');
    expect(coordinator.statsForTests().inFlight).toBe(1);
    pending.reject(new Error('upstream'));
    await expect(failed).resolves.toEqual([null]);
    await Promise.resolve();
    expect(coordinator.statsForTests().inFlight).toBe(0);
    await expect(coordinator.resolve([
      { key: 'replacement', run: async () => 9 },
    ], 'client')).resolves.toEqual([9]);
  });

  it('serves bounded stale data when refresh admission is temporarily exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const limiter = createViewerAdmissionLimiter({
      windowMs: 60_000,
      maxWork: 1,
      maxClients: 10,
    });

    const coordinator =
      new ViewerWorkCoordinator<number>({
        cacheTtlMs: 10,
        staleIfErrorMs: 1_000,
        cacheMaxEntries: 10,
        limiter,
      });

    await expect(
      coordinator.resolve(
        [
          {
            key: 'channel',
            run: async () => 55,
          },
        ],
        'client',
      ),
    ).resolves.toEqual([55]);

    vi.setSystemTime(20);

    await expect(
      coordinator.resolve(
        [
          {
            key: 'channel',
            run: async () => {
              throw new Error('upstream');
            },
          },
        ],
        'client',
      ),
    ).resolves.toEqual([55]);

    vi.setSystemTime(1_001);

    expect(() =>
      coordinator.resolve(
        [
          {
            key: 'channel',
            run: async () => 99,
          },
        ],
        'client',
      ),
    ).toThrow(ViewerAdmissionError);
  });

  it('preserves bounded successful-cache storage and TTL expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const coordinator = new ViewerWorkCoordinator<number>({
      cacheTtlMs: 100,
      cacheMaxEntries: 2,
      limiter: createViewerAdmissionLimiter({ maxWork: 100, maxClients: 10 }),
    });
    const run = vi.fn(async () => 1);

    for (const key of ['one', 'two', 'three']) {
      await coordinator.resolve([{ key, run }], 'client');
    }
    expect(coordinator.statsForTests().cacheEntries).toBe(2);

    await coordinator.resolve([{ key: 'three', run }], 'client');
    expect(run).toHaveBeenCalledTimes(3);
    vi.setSystemTime(100);
    await coordinator.resolve([{ key: 'three', run }], 'client');
    expect(run).toHaveBeenCalledTimes(4);
  });
});

describe('viewer upstream timeout controls', () => {
  it('aborts fetch-based work and clears its timeout handle', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }));

    const requestPromise = viewerFetchWithTimeout('https://example.test', {}, 100);
    const rejection = expect(requestPromise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds non-abortable capacity until the real operation settles', async () => {
    vi.useFakeTimers();
    const gate = new NonAbortableWorkGate(1);
    const underlying = deferred<string>();
    const timed = gate.run(() => underlying.promise, 100);
    await Promise.resolve();
    expect(gate.activeForTests()).toBe(1);

    const rejection = expect(timed).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(gate.activeForTests()).toBe(1);
    expect(() => gate.run(async () => 'blocked', 100)).toThrow(ViewerAdmissionError);

    underlying.resolve('late');
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.activeForTests()).toBe(0);
    await expect(gate.run(async () => 'next', 100)).resolves.toBe('next');
    expect(vi.getTimerCount()).toBe(0);
  });
});
