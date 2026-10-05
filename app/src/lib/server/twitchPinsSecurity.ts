import { resolveWebClientKey } from '@/lib/server/clientIdentity';

export const TWITCH_PINS_BODY_MAX_BYTES = 4_096;
export const TWITCH_PINS_MAX_CONCURRENT_WORK = 16;
export const TWITCH_PINS_ADMISSION_WINDOW_MS = 60_000;
export const TWITCH_PINS_ADMISSION_MAX_REQUESTS = 360;
export const TWITCH_PINS_ADMISSION_MAX_CLIENTS = 2_048;
export const TWITCH_PINS_CAPACITY_RETRY_AFTER_SECONDS = 2;

type AdmissionBucket = {
  count: number;
  startedAt: number;
};

type AdmissionOptions = {
  maxConcurrent?: number;
  windowMs?: number;
  maxRequests?: number;
  maxClients?: number;
};

export type TwitchPinsAdmissionKind = 'rate' | 'capacity';
export type TwitchPinsBodyErrorKind = 'invalid' | 'too-large';

export class TwitchPinsAdmissionError extends Error {
  readonly statusCode: 429 | 503;

  constructor(
    readonly kind: TwitchPinsAdmissionKind,
    readonly retryAfterSeconds: number,
  ) {
    super(kind === 'rate'
      ? 'Twitch pins request rate exceeded'
      : 'Twitch pins work capacity exceeded');
    this.name = 'TwitchPinsAdmissionError';
    this.statusCode = kind === 'rate' ? 429 : 503;
  }
}

export class TwitchPinsBodyError extends Error {
  readonly statusCode: 400 | 413;

  constructor(readonly kind: TwitchPinsBodyErrorKind) {
    super(kind === 'too-large'
      ? 'Twitch pins request body too large'
      : 'Invalid Twitch pins request body');
    this.name = 'TwitchPinsBodyError';
    this.statusCode = kind === 'too-large' ? 413 : 400;
  }
}

export function twitchPinsClientKey(request: Request): string {
  return resolveWebClientKey(request);
}

/** Process-local admission with no waiter queue and bounded client state. */
export function createTwitchPinsAdmissionController(options: AdmissionOptions = {}) {
  const maxConcurrent = options.maxConcurrent ?? TWITCH_PINS_MAX_CONCURRENT_WORK;
  const windowMs = options.windowMs ?? TWITCH_PINS_ADMISSION_WINDOW_MS;
  const maxRequests = options.maxRequests ?? TWITCH_PINS_ADMISSION_MAX_REQUESTS;
  const maxClients = options.maxClients ?? TWITCH_PINS_ADMISSION_MAX_CLIENTS;
  const buckets = new Map<string, AdmissionBucket>();
  let active = 0;
  let generation = 0;

  function pruneExpired(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  function acquire(clientKey: string, now = Date.now()): () => void {
    if (active >= maxConcurrent) {
      throw new TwitchPinsAdmissionError(
        'capacity',
        TWITCH_PINS_CAPACITY_RETRY_AFTER_SECONDS,
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

    if (bucket.count >= maxRequests) {
      throw new TwitchPinsAdmissionError(
        'rate',
        Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1_000)),
      );
    }

    bucket.count += 1;
    active += 1;
    const acquiredGeneration = generation;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      if (acquiredGeneration === generation) active -= 1;
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

const sharedAdmission = createTwitchPinsAdmissionController();

export function acquireTwitchPinsAdmission(
  clientKey: string,
): () => void {
  return sharedAdmission.acquire(clientKey);
}

export function twitchPinsResourceStatsForTests() {
  return sharedAdmission.statsForTests();
}

export function resetTwitchPinsResourcesForTests(): void {
  sharedAdmission.reset();
}

async function cancelRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // Cancellation is best-effort; the bounded error remains authoritative.
  }
}

/**
 * Read a request stream without retaining more than {@link maximumBytes}.
 * The chunk that crosses the boundary is never copied into the retained
 * buffer, and the stream is cancelled immediately.
 */
export async function readBoundedTwitchPinsBody(
  request: Request,
  maximumBytes = TWITCH_PINS_BODY_MAX_BYTES,
): Promise<string> {
  const rawContentLength = request.headers.get('content-length');
  let declared: bigint | null = null;

  if (rawContentLength !== null) {
    if (!/^\d+$/.test(rawContentLength)) {
      await cancelRequestBody(request);
      throw new TwitchPinsBodyError('invalid');
    }

    try {
      declared = BigInt(rawContentLength);
    } catch {
      await cancelRequestBody(request);
      throw new TwitchPinsBodyError('invalid');
    }
  }

  if (declared !== null && declared > BigInt(maximumBytes)) {
    await cancelRequestBody(request);
    throw new TwitchPinsBodyError('too-large');
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      if (request.signal.aborted) throw new TwitchPinsBodyError('invalid');

      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      if (value.byteLength > maximumBytes - total) {
        throw new TwitchPinsBodyError('too-large');
      }
      total += value.byteLength;
      // Copy only accepted bytes so a small view cannot retain an oversized
      // backing ArrayBuffer owned by the request stream implementation.
      chunks.push(value.slice());
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the byte-limit/read failure.
    }

    if (error instanceof TwitchPinsBodyError) throw error;
    throw new TwitchPinsBodyError('invalid');
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    )),
    total,
  ).toString('utf8');
}
