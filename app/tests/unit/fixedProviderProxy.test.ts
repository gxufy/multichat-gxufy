import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest } from 'next';
import {
  FixedProviderAdmissionError,
  FixedProviderWorkCoordinator,
  createFixedProviderAdmissionController,
  fixedProviderClientKey,
  readBoundedFixedProviderBody,
  withFixedProviderTimeout,
} from '@/lib/server/fixedProviderProxy';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

function request(remoteAddress: string, headers: NextApiRequest['headers'] = {}): NextApiRequest {
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

describe('fixed-provider client and admission policy', () => {
  it('trusts forwarding headers only under Vercel', () => {
    const req = request('::ffff:127.0.0.1', {
      'x-forwarded-for': '203.0.113.9',
      'x-vercel-forwarded-for': '198.51.100.3',
      'x-real-ip': '198.51.100.4',
    });
    delete process.env.VERCEL;
    expect(fixedProviderClientKey(req)).toBe('127.0.0.1');
    process.env.VERCEL = '1';
    expect(fixedProviderClientKey(req)).toBe('203.0.113.9');
  });

  it('bounds weighted concurrency without a queue and releases exactly once', () => {
    const admission = createFixedProviderAdmissionController({
      maxConcurrent: 3,
      maxWork: 10,
      maxClients: 10,
    });
    const releaseTwo = admission.acquire('one', 2);
    const releaseOne = admission.acquire('two', 1);
    expect(admission.statsForTests().active).toBe(3);
    expect(() => admission.acquire('three', 1)).toThrow(FixedProviderAdmissionError);
    releaseTwo();
    releaseTwo();
    expect(admission.statsForTests().active).toBe(1);
    admission.acquire('three', 2)();
    releaseOne();
    expect(admission.statsForTests().active).toBe(0);
  });

  it('bounds and expires per-client admission storage', () => {
    const admission = createFixedProviderAdmissionController({
      maxConcurrent: 10,
      windowMs: 1_000,
      maxWork: 2,
      maxClients: 2,
    });
    admission.acquire('one', 2, 0)();
    expect(() => admission.acquire('one', 1, 1)).toThrow(FixedProviderAdmissionError);
    admission.acquire('two', 1, 2)();
    admission.acquire('three', 1, 3)();
    expect(admission.statsForTests().clientBuckets).toBe(2);
    admission.acquire('fresh', 1, 1_003)();
    expect(admission.statsForTests().clientBuckets).toBe(1);
  });
});

describe('fixed-provider in-flight work', () => {
  it('coalesces identical keys without charging a second slot', async () => {
    const admission = createFixedProviderAdmissionController({
      maxConcurrent: 2,
      maxWork: 10,
      maxClients: 10,
    });
    const coordinator = new FixedProviderWorkCoordinator(admission, 2);
    const pending = deferred<string>();
    const run = vi.fn(() => pending.promise);
    const first = coordinator.run({ key: 'route:one', clientKey: 'a', run });
    const joined = coordinator.run({ key: 'route:one', clientKey: 'b', run });
    expect(first).toBe(joined);
    expect(run).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(coordinator.statsForTests()).toMatchObject({ active: 1, inFlight: 1 });
    pending.resolve('ok');
    await expect(Promise.all([first, joined])).resolves.toEqual(['ok', 'ok']);
    await Promise.resolve();
    expect(coordinator.statsForTests()).toMatchObject({ active: 0, inFlight: 0 });
  });

  it('keeps different keys distinct and removes failed work', async () => {
    const coordinator = new FixedProviderWorkCoordinator(
      createFixedProviderAdmissionController({ maxConcurrent: 2, maxWork: 10 }),
      2,
    );
    const first = deferred<string>();
    const second = deferred<string>();
    const one = coordinator.run({ key: 'route:one', clientKey: 'a', run: () => first.promise });
    const two = coordinator.run({ key: 'route:two', clientKey: 'a', run: () => second.promise });
    expect(() => coordinator.run({ key: 'route:three', clientKey: 'a', run: async () => 'three' }))
      .toThrow(FixedProviderAdmissionError);
    first.reject(new Error('failed'));
    second.resolve('ok');
    await expect(one).rejects.toThrow('failed');
    await expect(two).resolves.toBe('ok');
    await Promise.resolve();
    expect(coordinator.statsForTests()).toMatchObject({ active: 0, inFlight: 0 });
  });
});

describe('fixed-provider time and body bounds', () => {
  it('aborts timed work and clears its timer', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = withFixedProviderTimeout(100, (nextSignal) => {
      signal = nextSignal;
      return new Promise((_resolve, reject) => {
        nextSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const rejection = expect(pending).rejects.toThrow('upstream timeout');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts the exact byte boundary and rejects oversized Content-Length', async () => {
    await expect(readBoundedFixedProviderBody(
      new Response(new Uint8Array([1, 2, 3])),
      3,
    )).resolves.toEqual(Buffer.from([1, 2, 3]));

    const pull = vi.fn();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ pull, cancel }), {
      headers: { 'Content-Length': '4' },
    });
    await expect(readBoundedFixedProviderBody(response, 3)).rejects.toThrow('too large');
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a chunked body when the running limit is exceeded', async () => {
    const cancel = vi.fn();
    let sent = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
      cancel,
    }));
    await expect(readBoundedFixedProviderBody(response, 3)).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
