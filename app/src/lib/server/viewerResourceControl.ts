import type { NextApiRequest } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';

export const VIEWER_IN_FLIGHT_MAX = 64;
export const VIEWER_ADMISSION_WINDOW_MS = 60_000;
export const VIEWER_ADMISSION_MAX_WORK = 600;
export const VIEWER_ADMISSION_MAX_CLIENTS = 2_048;
export const VIEWER_CAPACITY_RETRY_AFTER_SECONDS = 2;
export const VIEWER_TIKTOK_MAX_CONCURRENCY = 8;

type AdmissionBucket = {
  count: number;
  startedAt: number;
};

type AdmissionResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type AdmissionLimiterOptions = {
  windowMs?: number;
  maxWork?: number;
  maxClients?: number;
};

type CoordinatorOptions = {
  cacheTtlMs: number;
  cacheMaxEntries: number;
  staleIfErrorMs?: number;
  inFlightMax?: number;
  limiter?: ReturnType<typeof createViewerAdmissionLimiter>;
};

export type ViewerLookup<T> = {
  key: string;
  run: () => Promise<T>;
};

export type ViewerAdmissionKind = 'rate' | 'capacity';

export class ViewerAdmissionError extends Error {
  readonly statusCode: 429 | 503;

  constructor(
    readonly kind: ViewerAdmissionKind,
    readonly retryAfterSeconds: number,
  ) {
    super(kind === 'rate' ? 'Viewer request rate exceeded' : 'Viewer work capacity exceeded');
    this.name = 'ViewerAdmissionError';
    this.statusCode = kind === 'rate' ? 429 : 503;
  }
}

export function viewerClientKey(req: NextApiRequest): string {
  return resolveNodeClientKey(req);
}

/**
 * Fixed-window admission accounting for newly-created upstream viewer work.
 * Cache hits and joins onto existing work call this with no cost and therefore
 * create no client bucket.
 */
export function createViewerAdmissionLimiter(options: AdmissionLimiterOptions = {}) {
  const windowMs = options.windowMs ?? VIEWER_ADMISSION_WINDOW_MS;
  const maxWork = options.maxWork ?? VIEWER_ADMISSION_MAX_WORK;
  const maxClients = options.maxClients ?? VIEWER_ADMISSION_MAX_CLIENTS;
  const buckets = new Map<string, AdmissionBucket>();

  function pruneExpired(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  function consume(key: string, cost: number, now = Date.now()): AdmissionResult {
    if (cost <= 0) return { allowed: true, retryAfterSeconds: 0 };
    pruneExpired(now);

    let bucket = buckets.get(key);
    if (!bucket) {
      while (buckets.size >= maxClients) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      bucket = { count: 0, startedAt: now };
      buckets.set(key, bucket);
    } else {
      // Refresh insertion order so bounded eviction removes the least-recently-seen key.
      buckets.delete(key);
      buckets.set(key, bucket);
    }

    if (bucket.count + cost > maxWork) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowMs - (now - bucket.startedAt)) / 1_000),
        ),
      };
    }

    bucket.count += cost;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    consume,
    reset: () => buckets.clear(),
    entryCountForTests: () => buckets.size,
  };
}

type ResolutionPlan<T> =
  | { kind: 'value'; value: T }
  | {
      kind: 'promise';
      key: string;
      promise?: Promise<T>;
      stale?: T;
    };

/** Bounded successful cache plus race-safe in-flight work coalescing. */
export class ViewerWorkCoordinator<T> {
  private readonly cache = new Map<string, { at: number; data: T }>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly inFlightMax: number;
  private readonly limiter: ReturnType<typeof createViewerAdmissionLimiter>;
  private generation = 0;

  constructor(private readonly options: CoordinatorOptions) {
    this.inFlightMax = options.inFlightMax ?? VIEWER_IN_FLIGHT_MAX;
    this.limiter = options.limiter ?? createViewerAdmissionLimiter();
  }

  resolve(lookups: ViewerLookup<T>[], clientKey: string): Promise<Array<T | null>> {
    const now = Date.now();
    const newLookups = new Map<string, () => Promise<T>>();
    const staleIfErrorMs = this.options.staleIfErrorMs ?? 0;

    const plans: ResolutionPlan<T>[] = lookups.map((lookup) => {
      const hit = this.cache.get(lookup.key);

      if (hit && now - hit.at < this.options.cacheTtlMs) {
        return {
          kind: 'value',
          value: hit.data,
        };
      }

      const stale =
        hit &&
        staleIfErrorMs > 0 &&
        now - hit.at < staleIfErrorMs
          ? hit.data
          : undefined;

      const existing = this.inFlight.get(lookup.key);

      if (existing) {
        return {
          kind: 'promise',
          key: lookup.key,
          promise: existing,
          stale,
        };
      }

      if (!newLookups.has(lookup.key)) {
        newLookups.set(lookup.key, lookup.run);
      }

      return {
        kind: 'promise',
        key: lookup.key,
        stale,
      };
    });

    const staleFallback = (): Array<T | null> =>
      plans.map((plan) => {
        if (plan.kind === 'value') {
          return plan.value;
        }

        return plan.stale ?? null;
      });

    const canServeEntireRequestFromStale = plans.every(
      (plan) =>
        plan.kind === 'value' ||
        plan.stale !== undefined,
    );

    if (
      this.inFlight.size + newLookups.size >
      this.inFlightMax
    ) {
      if (canServeEntireRequestFromStale) {
        return Promise.resolve(staleFallback());
      }

      throw new ViewerAdmissionError(
        'capacity',
        VIEWER_CAPACITY_RETRY_AFTER_SECONDS,
      );
    }

    const admission = this.limiter.consume(
      clientKey,
      newLookups.size,
      now,
    );

    if (!admission.allowed) {
      if (canServeEntireRequestFromStale) {
        return Promise.resolve(staleFallback());
      }

      throw new ViewerAdmissionError(
        'rate',
        admission.retryAfterSeconds,
      );
    }

    const workGeneration = this.generation;
    for (const [key, run] of newLookups) {
      // Defer the actual upstream call until every slot in this batch has been
      // synchronously reserved in the authoritative in-flight registry.
      const promise = Promise.resolve().then(run);
      this.inFlight.set(key, promise);

      void promise
        .then(
          (data) => {
            if (workGeneration === this.generation) this.storeSuccess(key, data);
          },
          () => undefined,
        )
        .finally(() => {
          if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
        });
    }

    return Promise.all(plans.map((plan) => {
      if (plan.kind === 'value') return plan.value;
      const promise = plan.promise ?? this.inFlight.get(plan.key);
      if (!promise) return null;
      return promise.catch((error) => {
        if (error instanceof ViewerAdmissionError) {
          throw error;
        }

        return plan.stale ?? null;
      });
    }));
  }

  private storeSuccess(key: string, data: T): void {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), data });
    while (this.cache.size > this.options.cacheMaxEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  statsForTests() {
    return {
      cacheEntries: this.cache.size,
      inFlight: this.inFlight.size,
      limiterEntries: this.limiter.entryCountForTests(),
    };
  }

  resetForTests(): void {
    this.generation += 1;
    this.cache.clear();
    this.inFlight.clear();
    this.limiter.reset();
  }
}

/**
 * Caps work that offers no cancellation primitive. A response timeout does not
 * release the permit: only settlement of the real underlying operation does.
 */
export class NonAbortableWorkGate {
  private active = 0;
  private generation = 0;

  constructor(private readonly maximum: number) {}

  run<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.active >= this.maximum) {
      throw new ViewerAdmissionError('capacity', VIEWER_CAPACITY_RETRY_AFTER_SECONDS);
    }

    this.active += 1;
    const workGeneration = this.generation;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (workGeneration === this.generation) this.active -= 1;
    };

    const operation = Promise.resolve().then(work);
    void operation.then(release, release);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });

    return Promise.race([operation, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  activeForTests(): number {
    return this.active;
  }

  resetForTests(): void {
    this.generation += 1;
    this.active = 0;
  }
}

/** Fetch with real AbortController cancellation and deterministic timer cleanup. */
export async function viewerFetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
