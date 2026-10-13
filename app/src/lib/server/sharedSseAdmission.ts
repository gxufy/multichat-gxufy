import type { NextApiRequest } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';

export const SHARED_SSE_CAPACITY_RETRY_AFTER_SECONDS = 30;
export const SHARED_SSE_ADMISSION_WINDOW_MS = 60_000;
export const SHARED_SSE_ADMISSION_MAX_REQUESTS = 30;
export const SHARED_SSE_ADMISSION_MAX_CLIENTS = 2_048;

export type SharedSseCapacityKind =
  | 'channels'
  | 'channel-subscribers'
  | 'provider-subscribers';

export class SharedSseCapacityError extends Error {
  constructor(readonly kind: SharedSseCapacityKind) {
    super('Shared stream capacity exceeded');
    this.name = 'SharedSseCapacityError';
  }
}

type AdmissionBucket = {
  count: number;
  startedAt: number;
};

type AdmissionLimit = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type AdmissionLimiterOptions = {
  windowMs?: number;
  maxRequests?: number;
  maxClients?: number;
};

export function sharedSseClientKey(req: NextApiRequest): string {
  return resolveNodeClientKey(req);
}

export function createSharedSseAdmissionLimiter(options: AdmissionLimiterOptions = {}) {
  const windowMs = options.windowMs ?? SHARED_SSE_ADMISSION_WINDOW_MS;
  const maxRequests = options.maxRequests ?? SHARED_SSE_ADMISSION_MAX_REQUESTS;
  const maxClients = options.maxClients ?? SHARED_SSE_ADMISSION_MAX_CLIENTS;
  const buckets = new Map<string, AdmissionBucket>();

  function pruneExpired(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  function consume(key: string, now = Date.now()): AdmissionLimit {
    pruneExpired(now);
    const current = buckets.get(key);
    if (!current) {
      while (buckets.size >= maxClients) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      buckets.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    // Refresh insertion order so the hard cap evicts the least recently seen key.
    buckets.delete(key);
    buckets.set(key, current);
    if (current.count >= maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowMs - (now - current.startedAt)) / 1_000),
        ),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    consume,
    reset: () => buckets.clear(),
    entryCountForTests: () => buckets.size,
  };
}
