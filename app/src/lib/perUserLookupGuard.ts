/*
 * Client-side traffic guard for optional per-chatter cosmetic lookups.
 *
 * Same budget shape as the JilChat guard in communityBadges.ts (which stays
 * as-is): a token bucket (burst, 1 token per refill interval), a concurrency
 * cap, a bounded queue, a short wait on the live chat path, cooldown on 429,
 * and an LRU cache with separate success / failure / throttled lifetimes.
 *
 * `lookup` resolves to `{ value }` when the provider actually answered (fresh or
 * cached) and to `null` when the user was skipped, throttled, failed, or is
 * still pending — callers then fall back to whatever they had before.
 */

export type PerUserLookupGuardOptions<T> = {
  burst: number;
  maxConcurrent: number;
  maxQueue: number;
  refillMs: number;
  liveWaitMs: number;
  cacheTtlMs: number;
  failureTtlMs: number;
  throttledTtlMs: number;
  maxKeys: number;
  /** Fetch one user. Call onRateLimit with Retry-After when the server says 429. Throw on failure. */
  request: (userId: string, onRateLimit: (retryAfter: string | null) => void) => Promise<T>;
};

export type PerUserLookupResult<T> = { value: T };

type CacheEntry<T> = { result: PerUserLookupResult<T> | null; expiresAt: number };
type Queued<T> = { userId: string; resolve: (result: PerUserLookupResult<T> | null) => void };

export type PerUserLookupGuard<T> = {
  lookup(userId: string, waitForResult?: boolean): Promise<PerUserLookupResult<T> | null>;
  reset(): void;
};

export function retryAfterMs(value: string | null, now = Date.now()): number {
  const raw = value?.trim() ?? '';
  const millis = /^\d+$/.test(raw)
    ? Number(raw) * 1_000
    : raw && Number.isFinite(Date.parse(raw))
      ? Date.parse(raw) - now
      : 60_000;
  return Math.max(1_000, Math.min(120_000, millis));
}

export function createPerUserLookupGuard<T>(options: PerUserLookupGuardOptions<T>): PerUserLookupGuard<T> {
  let cache = new Map<string, CacheEntry<T>>();
  let inFlight = new Map<string, Promise<PerUserLookupResult<T> | null>>();
  let queue: Queued<T>[] = [];
  let tokens = options.burst;
  let tokensUpdatedAt = Date.now();
  let active = 0;
  let cooldownUntil = 0;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const remember = (userId: string, result: PerUserLookupResult<T> | null, ttlMs: number) => {
    cache.delete(userId);
    while (cache.size >= options.maxKeys) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    cache.set(userId, { result, expiresAt: Date.now() + ttlMs });
  };

  const cached = (userId: string): CacheEntry<T> | null => {
    const entry = cache.get(userId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(userId);
      return null;
    }
    cache.delete(userId);
    cache.set(userId, entry);
    return entry;
  };

  const skip = (userId: string) => {
    remember(userId, null, options.throttledTtlMs);
    return null;
  };

  const refill = (now: number) => {
    if (now < tokensUpdatedAt) tokensUpdatedAt = now;
    const earned = Math.floor((now - tokensUpdatedAt) / options.refillMs);
    if (earned > 0) {
      tokens = Math.min(options.burst, tokens + earned);
      tokensUpdatedAt += earned * options.refillMs;
    }
  };

  const scheduleDrain = (delayMs: number) => {
    if (drainTimer !== null) return;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drain();
    }, Math.max(1, delayMs));
  };

  const pause = (retryAfter: string | null) => {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfterMs(retryAfter));
    if (drainTimer !== null) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    for (const queued of queue.splice(0)) queued.resolve(skip(queued.userId));
  };

  const run = async (userId: string, runGeneration: number): Promise<PerUserLookupResult<T> | null> => {
    let rateLimited = false;
    try {
      const value = await options.request(userId, (retryAfter) => {
        rateLimited = true;
        if (runGeneration === generation) pause(retryAfter);
      });
      if (runGeneration !== generation) return null;
      const result = { value };
      remember(userId, result, options.cacheTtlMs);
      return result;
    } catch {
      if (runGeneration === generation) {
        remember(userId, null, rateLimited ? options.throttledTtlMs : options.failureTtlMs);
      }
      return null;
    }
  };

  function drain(): void {
    const now = Date.now();
    if (now < cooldownUntil) {
      for (const queued of queue.splice(0)) queued.resolve(skip(queued.userId));
      return;
    }
    refill(now);
    while (active < options.maxConcurrent && tokens > 0 && queue.length > 0) {
      const next = queue.shift()!;
      tokens -= 1;
      active += 1;
      const runGeneration = generation;
      void run(next.userId, runGeneration).then(next.resolve).finally(() => {
        if (runGeneration !== generation) return;
        active -= 1;
        drain();
      });
    }
    if (queue.length > 0 && tokens === 0) {
      scheduleDrain(tokensUpdatedAt + options.refillMs - Date.now());
    }
  }

  const live = (work: Promise<PerUserLookupResult<T> | null>) =>
    new Promise<PerUserLookupResult<T> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), options.liveWaitMs);
      void work.then(
        (result) => { clearTimeout(timer); resolve(result); },
        () => { clearTimeout(timer); resolve(null); },
      );
    });

  return {
    lookup(userId, waitForResult = false) {
      if (!/^\d{1,25}$/.test(userId)) return Promise.resolve(null);
      const hit = cached(userId);
      if (hit) return Promise.resolve(hit.result);
      const existing = inFlight.get(userId);
      if (existing) return waitForResult ? existing : live(existing);
      if (Date.now() < cooldownUntil || queue.length >= options.maxQueue) {
        return Promise.resolve(skip(userId));
      }
      const work = new Promise<PerUserLookupResult<T> | null>((resolve) => {
        queue.push({ userId, resolve });
        drain();
      });
      inFlight.set(userId, work);
      void work.then(() => {
        if (inFlight.get(userId) === work) inFlight.delete(userId);
      });
      return waitForResult ? work : live(work);
    },
    reset() {
      generation += 1;
      if (drainTimer !== null) clearTimeout(drainTimer);
      drainTimer = null;
      for (const queued of queue.splice(0)) queued.resolve(null);
      cache = new Map();
      inFlight = new Map();
      tokens = options.burst;
      tokensUpdatedAt = Date.now();
      active = 0;
      cooldownUntil = 0;
    },
  };
}
