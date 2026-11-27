/*
 * JilTV cosmetics (jiltv.app — not JilChat, not 7TV): shared parsing, the
 * browser lookup and paint styling. The server proxy is
 * api/jiltv/cosmetics.ts; see lib/server/jiltvCosmetics.ts for the
 * upstream contract.
 *
 * Release gate: the overlay only asks for JilTV paints when the build has
 * NEXT_PUBLIC_GXUFY_JILTV_COSMETICS=1, and the server only answers when
 * GXUFY_JILTV_COSMETICS_ENABLED=1. Both are off unless the server setup turns
 * them on. JilTV emotes are not part of this and stay out of the codebase.
 */
import {
  JILCHAT_CLIENT_BURST,
  JILCHAT_CLIENT_FAILURE_TTL_MS,
  JILCHAT_CLIENT_MAX_CONCURRENT,
  JILCHAT_CLIENT_REFILL_MS,
} from './communityBadges';
import { retryAfterMs } from './perUserLookupGuard';
import {
  JILTV_LOOKUP_MAX_LOGINS,
  TWITCH_LOGIN_RE,
  parseJilTVPaintAnswer,
  type JilTVPaintView,
} from './jiltvCosmeticsContract';

export * from './jiltvCosmeticsContract';

export const JILTV_COSMETICS_ENABLED = process.env.NEXT_PUBLIC_GXUFY_JILTV_COSMETICS === '1';

/** How long an answer (a paint, or none) is kept. */
export const JILTV_CLIENT_CACHE_TTL_MS = 5 * 60_000;
/** New chatters are gathered this long and asked about in one request. */
export const JILTV_CLIENT_BATCH_WINDOW_MS = 200;
/** Chatters waiting for a lookup at most; the rest are skipped for a while. */
export const JILTV_CLIENT_MAX_WAITING = 200;
const JILTV_CLIENT_THROTTLED_TTL_MS = 10_000;
const JILTV_CLIENT_REQUEST_TIMEOUT_MS = 6_000;
const JILTV_CLIENT_MAX_KEYS = 500;

type Waiter = (paint: JilTVPaintView | null) => void;
type Batch = { channel: string; logins: Map<string, Waiter[]> };

type RequestBatch = (
  logins: readonly string[],
  channel: string,
  onRateLimit: (retryAfter: string | null) => void,
) => Promise<Map<string, JilTVPaintView | null>>;

async function requestJilTVPaints(
  logins: readonly string[],
  channel: string,
  onRateLimit: (retryAfter: string | null) => void,
): Promise<Map<string, JilTVPaintView | null>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JILTV_CLIENT_REQUEST_TIMEOUT_MS);
  try {
    const query = `logins=${logins.join(',')}${channel ? `&channel=${channel}` : ''}`;
    const response = await fetch(`/api/jiltv/cosmetics?${query}`, { signal: controller.signal });
    if (response.status === 429) onRateLimit(response.headers.get('Retry-After'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseJilTVPaintAnswer(await response.json());
    if (!parsed) throw new Error('malformed JilTV cosmetics');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-chatter JilTV paint lookups, gathered into one request per channel for
 * every chatter seen within a short window (as JilTV asks chat clients to),
 * with the same budget shape as the JilChat guard, applied per request: a
 * token bucket (burst 16, one more each second), at most 6 requests at once,
 * a cooldown on 429, and an LRU cache of answers ("wears nothing" included).
 */
export function createJilTVPaintLookups(request: RequestBatch = requestJilTVPaints) {
  let cache = new Map<string, { paint: JilTVPaintView | null; expiresAt: number }>();
  let waiting = new Map<string, Map<string, Waiter[]>>();
  let windows = new Map<string, ReturnType<typeof setTimeout>>();
  let batches: Batch[] = [];
  let tokens = JILCHAT_CLIENT_BURST;
  let tokensUpdatedAt = Date.now();
  let active = 0;
  let cooldownUntil = 0;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const remember = (key: string, paint: JilTVPaintView | null, ttlMs: number) => {
    cache.delete(key);
    while (cache.size >= JILTV_CLIENT_MAX_KEYS) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    cache.set(key, { paint, expiresAt: Date.now() + ttlMs });
  };

  const waitingCount = () => {
    let count = 0;
    for (const logins of waiting.values()) count += logins.size;
    for (const batch of batches) count += batch.logins.size;
    return count;
  };

  const settle = (batch: Batch, paints: Map<string, JilTVPaintView | null> | null, ttlMs: number) => {
    for (const [login, waiters] of batch.logins) {
      const paint = paints?.get(login) ?? null;
      remember(`${batch.channel}|${login}`, paint, paints?.has(login) ? JILTV_CLIENT_CACHE_TTL_MS : ttlMs);
      for (const resolve of waiters) resolve(paint);
    }
  };

  const pause = (retryAfter: string | null) => {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfterMs(retryAfter));
    for (const batch of batches.splice(0)) settle(batch, null, JILTV_CLIENT_THROTTLED_TTL_MS);
  };

  const refill = (now: number) => {
    if (now < tokensUpdatedAt) tokensUpdatedAt = now;
    const earned = Math.floor((now - tokensUpdatedAt) / JILCHAT_CLIENT_REFILL_MS);
    if (earned > 0) {
      tokens = Math.min(JILCHAT_CLIENT_BURST, tokens + earned);
      tokensUpdatedAt += earned * JILCHAT_CLIENT_REFILL_MS;
    }
  };

  const run = async (batch: Batch, runGeneration: number) => {
    let rateLimited = false;
    try {
      const paints = await request([...batch.logins.keys()], batch.channel, (retryAfter) => {
        rateLimited = true;
        if (runGeneration === generation) pause(retryAfter);
      });
      if (runGeneration === generation) settle(batch, paints, JILCHAT_CLIENT_FAILURE_TTL_MS);
    } catch {
      if (runGeneration === generation) {
        settle(batch, null, rateLimited ? JILTV_CLIENT_THROTTLED_TTL_MS : JILCHAT_CLIENT_FAILURE_TTL_MS);
      }
    }
  };

  function drain(): void {
    const now = Date.now();
    if (now < cooldownUntil) {
      for (const batch of batches.splice(0)) settle(batch, null, JILTV_CLIENT_THROTTLED_TTL_MS);
      return;
    }
    refill(now);
    while (active < JILCHAT_CLIENT_MAX_CONCURRENT && tokens > 0 && batches.length > 0) {
      const batch = batches.shift()!;
      tokens -= 1;
      active += 1;
      const runGeneration = generation;
      void run(batch, runGeneration).finally(() => {
        if (runGeneration !== generation) return;
        active -= 1;
        drain();
      });
    }
    if (batches.length > 0 && tokens === 0 && drainTimer === null) {
      drainTimer = setTimeout(() => {
        drainTimer = null;
        drain();
      }, Math.max(1, tokensUpdatedAt + JILCHAT_CLIENT_REFILL_MS - Date.now()));
    }
  }

  /* The channel's gathered chatters become requests of up to 50 each. */
  function close(channel: string): void {
    const timer = windows.get(channel);
    if (timer !== undefined) clearTimeout(timer);
    windows.delete(channel);
    const gathered = waiting.get(channel);
    waiting.delete(channel);
    if (!gathered?.size) return;
    let batch: Batch = { channel, logins: new Map() };
    for (const [login, waiters] of gathered) {
      if (batch.logins.size >= JILTV_LOOKUP_MAX_LOGINS) {
        batches.push(batch);
        batch = { channel, logins: new Map() };
      }
      batch.logins.set(login, waiters);
    }
    batches.push(batch);
    drain();
  }

  return {
    /**
     * The JilTV paint `login` wears in `channel` (a Twitch login; empty for
     * the chatter's own look), or null when they wear none, the lookup was
     * skipped or failed. Resolves once the gathered request has answered.
     */
    lookup(login: string, channel = ''): Promise<JilTVPaintView | null> {
      const user = login.trim().toLowerCase();
      const room = channel.trim().toLowerCase();
      if (!TWITCH_LOGIN_RE.test(user) || (room && !TWITCH_LOGIN_RE.test(room))) return Promise.resolve(null);
      const key = `${room}|${user}`;
      const hit = cache.get(key);
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.paint);
      if (hit) cache.delete(key);
      const queued = waiting.get(room)?.get(user)
        ?? batches.find((batch) => batch.channel === room && batch.logins.has(user))?.logins.get(user);
      if (queued) return new Promise((resolve) => queued.push(resolve));
      if (Date.now() < cooldownUntil || waitingCount() >= JILTV_CLIENT_MAX_WAITING) {
        remember(key, null, JILTV_CLIENT_THROTTLED_TTL_MS);
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        const gathered = waiting.get(room) ?? new Map<string, Waiter[]>();
        waiting.set(room, gathered);
        gathered.set(user, [resolve]);
        if (gathered.size >= JILTV_LOOKUP_MAX_LOGINS) close(room);
        else if (!windows.has(room)) windows.set(room, setTimeout(() => close(room), JILTV_CLIENT_BATCH_WINDOW_MS));
      });
    },
    reset(): void {
      generation += 1;
      for (const timer of windows.values()) clearTimeout(timer);
      if (drainTimer !== null) clearTimeout(drainTimer);
      drainTimer = null;
      for (const gathered of waiting.values()) for (const waiters of gathered.values()) for (const resolve of waiters) resolve(null);
      for (const batch of batches) for (const waiters of batch.logins.values()) for (const resolve of waiters) resolve(null);
      cache = new Map();
      waiting = new Map();
      windows = new Map();
      batches = [];
      tokens = JILCHAT_CLIENT_BURST;
      tokensUpdatedAt = Date.now();
      active = 0;
      cooldownUntil = 0;
    },
  };
}

const jiltvPaints = createJilTVPaintLookups();

/**
 * The JilTV paint a Twitch chatter wears in a channel, or `null` when the gate
 * is off, we're not in a browser, they wear none, or the lookup was skipped or
 * failed. Waits for the answer (the caller updates the already-shown message
 * when it arrives).
 */
export async function lookupJilTVPaint(
  login: string,
  channel = '',
  enabled: boolean = JILTV_COSMETICS_ENABLED,
): Promise<JilTVPaintView | null> {
  if (!enabled || typeof window === 'undefined') return null;
  return jiltvPaints.lookup(login, channel);
}

export function __resetJilTVCosmeticsClientForTests(): void {
  jiltvPaints.reset();
}
