import type { NextApiRequest } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';

export const FIXED_PROVIDER_MAX_CONCURRENT_WORK = 32;
export const FIXED_PROVIDER_IN_FLIGHT_MAX = 64;
export const FIXED_PROVIDER_ADMISSION_WINDOW_MS = 60_000;
export const FIXED_PROVIDER_ADMISSION_MAX_WORK = 360;
export const FIXED_PROVIDER_ADMISSION_MAX_CLIENTS = 2_048;
export const FIXED_PROVIDER_CAPACITY_RETRY_AFTER_SECONDS = 2;

type AdmissionBucket = {
  count: number;
  startedAt: number;
};

type AdmissionOptions = {
  maxConcurrent?: number;
  windowMs?: number;
  maxWork?: number;
  maxClients?: number;
};

export type FixedProviderAdmissionKind = 'rate' | 'capacity';

export class FixedProviderAdmissionError extends Error {
  readonly statusCode: 429 | 503;

  constructor(
    readonly kind: FixedProviderAdmissionKind,
    readonly retryAfterSeconds: number,
  ) {
    super(kind === 'rate'
      ? 'Fixed-provider request rate exceeded'
      : 'Fixed-provider work capacity exceeded');
    this.name = 'FixedProviderAdmissionError';
    this.statusCode = kind === 'rate' ? 429 : 503;
  }
}

export class FixedProviderUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixedProviderUpstreamError';
  }
}

export function fixedProviderClientKey(req: NextApiRequest): string {
  return resolveNodeClientKey(req);
}

/** Weighted process-local admission with no waiter queue. */
export function createFixedProviderAdmissionController(options: AdmissionOptions = {}) {
  const maxConcurrent = options.maxConcurrent ?? FIXED_PROVIDER_MAX_CONCURRENT_WORK;
  const windowMs = options.windowMs ?? FIXED_PROVIDER_ADMISSION_WINDOW_MS;
  const maxWork = options.maxWork ?? FIXED_PROVIDER_ADMISSION_MAX_WORK;
  const maxClients = options.maxClients ?? FIXED_PROVIDER_ADMISSION_MAX_CLIENTS;
  const buckets = new Map<string, AdmissionBucket>();
  let active = 0;
  let generation = 0;

  function pruneExpired(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  function acquire(clientKey: string, cost = 1, now = Date.now()): () => void {
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > maxConcurrent) {
      throw new FixedProviderAdmissionError(
        'capacity',
        FIXED_PROVIDER_CAPACITY_RETRY_AFTER_SECONDS,
      );
    }
    if (active + cost > maxConcurrent) {
      throw new FixedProviderAdmissionError(
        'capacity',
        FIXED_PROVIDER_CAPACITY_RETRY_AFTER_SECONDS,
      );
    }

    pruneExpired(now);
    let bucket = buckets.get(clientKey);
    if (!bucket) {
      while (buckets.size >= maxClients) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      bucket = { count: 0, startedAt: now };
      buckets.set(clientKey, bucket);
    } else {
      buckets.delete(clientKey);
      buckets.set(clientKey, bucket);
    }

    if (bucket.count + cost > maxWork) {
      throw new FixedProviderAdmissionError(
        'rate',
        Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1_000)),
      );
    }

    bucket.count += cost;
    active += cost;
    const acquiredGeneration = generation;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (acquiredGeneration === generation) active -= cost;
    };
  }

  return {
    acquire,
    reset: () => {
      generation += 1;
      active = 0;
      buckets.clear();
    },
    statsForTests: () => ({ active, clientBuckets: buckets.size }),
  };
}

type WorkOptions<T> = {
  key: string;
  clientKey: string;
  cost?: number;
  run: () => Promise<T>;
};

export class FixedProviderWorkCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(
    private readonly admission = createFixedProviderAdmissionController(),
    private readonly maximumInFlight = FIXED_PROVIDER_IN_FLIGHT_MAX,
  ) {}

  run<T>({ key, clientKey, cost = 1, run }: WorkOptions<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    if (this.inFlight.size >= this.maximumInFlight) {
      throw new FixedProviderAdmissionError(
        'capacity',
        FIXED_PROVIDER_CAPACITY_RETRY_AFTER_SECONDS,
      );
    }

    const release = this.admission.acquire(clientKey, cost);
    const workGeneration = this.generation;
    const promise = Promise.resolve().then(run);
    this.inFlight.set(key, promise);

    const finish = () => {
      release();
      if (workGeneration === this.generation && this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    };
    void promise.then(finish, finish);
    return promise;
  }

  statsForTests() {
    return {
      ...this.admission.statsForTests(),
      inFlight: this.inFlight.size,
    };
  }

  resetForTests(): void {
    this.generation += 1;
    this.inFlight.clear();
    this.admission.reset();
  }
}

const sharedCoordinator = new FixedProviderWorkCoordinator();

export function runFixedProviderWork<T>(options: WorkOptions<T>): Promise<T> {
  return sharedCoordinator.run(options);
}

export function fixedProviderResourceStatsForTests() {
  return sharedCoordinator.statsForTests();
}

export function resetFixedProviderResourcesForTests(): void {
  sharedCoordinator.resetForTests();
}

/** Abort fetch work and bound callers even if a test double ignores the signal. */
export async function withFixedProviderTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve().then(() => run(controller.signal));
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FixedProviderUpstreamError('upstream timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

export async function discardFixedProviderBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Rejected provider responses are cancelled on a best-effort basis.
  }
}

function declaredContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/** Buffer one provider response without ever accepting more than maximumBytes. */
export async function readBoundedFixedProviderBody(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > maximumBytes) {
    await discardFixedProviderBody(response);
    throw new FixedProviderUpstreamError('upstream response too large');
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new FixedProviderUpstreamError('upstream response too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original read or byte-limit error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    total,
  );
}

export async function readBoundedFixedProviderText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  return (await readBoundedFixedProviderBody(response, maximumBytes)).toString('utf8');
}

export async function readBoundedFixedProviderJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const body = await readBoundedFixedProviderText(response, maximumBytes);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new FixedProviderUpstreamError('malformed upstream response');
  }
}
