/*
 * Limerino's live badge feed, held by the server: one stream for the whole
 * app, as Limerino asks (GET /v1/badges/events, server-sent events).
 *
 *  - `sync` {catalog, holders}: the current ETags. Sent when the stream opens,
 *    when the catalog changes and when a change is too big to patch. If either
 *    differs from the lists the server holds, the server refreshes them; open
 *    overlays are then told to reload the list (spread out, see the client).
 *  - `holders` {etag, users}: each listed user's new badge list. Applied to the
 *    held list straight away and passed on to open overlays as a small patch
 *    (user id → the badge they now show, or null), batched once a second.
 *    A patch that arrives while a refresh runs triggers one more refresh
 *    instead, because it may be older than the snapshot.
 *
 * Reconnects after the stream's own `retry` delay when it ends (Limerino
 * renews streams every 15-19 minutes). Refusals (429/503) and network errors
 * wait `retry-after` or 60 s, doubling, at most 10 minutes, plus a little
 * jitter. A heartbeat comes every 20 s; 60 s of silence means the stream is
 * dead and it is reopened. The stream is only open while overlays that show
 * badges are connected; two minutes after the last one leaves it closes.
 * The 10-minute list refresh keeps running underneath as the fallback.
 */
import {
  applyLimerinoHoldersPatch,
  limerinoBadgesVersion,
  limerinoCachedEtags,
  limerinoHasCache,
  limerinoRefreshInFlight,
  limerinoShownBadge,
  parseLimerinoHolders,
  refreshLimerinoBadgesNow,
  sameLimerinoEtag,
} from './limerinoBadges';

export const LIMERINO_EVENTS_URL = 'https://api.limerino.com/v1/badges/events';
export const LIMERINO_LIVE_DEFAULT_RETRY_MS = 7_000;
export const LIMERINO_LIVE_REFUSED_RETRY_MS = 60_000;
export const LIMERINO_LIVE_MAX_RETRY_MS = 10 * 60_000;
export const LIMERINO_LIVE_JITTER_MS = 3_000;
export const LIMERINO_LIVE_SILENCE_MS = 60_000;
export const LIMERINO_LIVE_IDLE_CHECK_MS = 30_000;
export const LIMERINO_LIVE_IDLE_STOP_MS = 2 * 60_000;
export const LIMERINO_LIVE_BATCH_MS = 1_000;
/** More users than this in one batch: overlays reload the list instead. */
export const LIMERINO_LIVE_MAX_PATCH_USERS = 2_000;
/** Limerino sends at most 64 KiB in a patch; anything far bigger is dropped. */
export const LIMERINO_LIVE_MAX_EVENT_CHARS = 256 * 1024;

/** What open overlays are sent (event `limerino` on /api/overlay/live). */
export type LimerinoLiveUpdate =
  | { t: 'patch'; users: Record<string, string | null> }
  | { t: 'reload'; v: number };

type SseEvent = { event: string; data: string };

/**
 * A small server-sent events reader: feed it text as it arrives, it calls
 * back for each complete event, each `retry:` value and each comment
 * (heartbeat). Events with more than `maxChars` of data are dropped.
 */
export function createSseReader(handlers: {
  onEvent: (event: SseEvent) => void;
  onRetry?: (ms: number) => void;
  onComment?: () => void;
}, maxChars = LIMERINO_LIVE_MAX_EVENT_CHARS): (chunk: string) => void {
  let buffer = '';
  let eventName = '';
  let data: string[] = [];
  let size = 0;
  let oversized = false;

  const line = (text: string) => {
    if (text === '') {
      if (data.length && !oversized) handlers.onEvent({ event: eventName || 'message', data: data.join('\n') });
      eventName = '';
      data = [];
      size = 0;
      oversized = false;
      return;
    }
    if (text.startsWith(':')) {
      handlers.onComment?.();
      return;
    }
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') {
      size += value.length + 1;
      if (size > maxChars) oversized = true;
      else data.push(value);
    } else if (field === 'retry' && /^\d{1,9}$/.test(value)) handlers.onRetry?.(Number(value));
  };

  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer);
      if (!match) break;
      /* A lone \r at the very end may be the first half of \r\n. */
      if (match[0] === '\r' && match.index === buffer.length - 1) break;
      line(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (buffer.length > maxChars) {
      buffer = '';
      oversized = true;
    }
  };
}

function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  if (/^\d{1,6}$/.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

export type LimerinoLiveDeps = {
  fetch: typeof fetch;
  broadcast: (update: LimerinoLiveUpdate) => void;
  /** Overlays that show badges, connected right now. */
  connections: () => number;
  now?: () => number;
  random?: () => number;
};

type Live = {
  deps: LimerinoLiveDeps;
  running: boolean;
  controller: AbortController | null;
  retryMs: number;
  failures: number;
  reconnect: ReturnType<typeof setTimeout> | null;
  silence: ReturnType<typeof setTimeout> | null;
  idleCheck: ReturnType<typeof setInterval> | null;
  idleSince: number | null;
  batch: ReturnType<typeof setTimeout> | null;
  pending: Map<string, string | null>;
  refreshing: boolean;
  refreshAgain: boolean;
  /** Bumped each time the stream is (re)opened or stopped, so old loops quit. */
  generation: number;
};

function createLive(deps: LimerinoLiveDeps): Live {
  return {
    deps,
    running: false,
    controller: null,
    retryMs: LIMERINO_LIVE_DEFAULT_RETRY_MS,
    failures: 0,
    reconnect: null,
    silence: null,
    idleCheck: null,
    idleSince: null,
    batch: null,
    pending: new Map(),
    refreshing: false,
    refreshAgain: false,
    generation: 0,
  };
}

const now = (live: Live) => (live.deps.now ?? Date.now)();
const jitter = (live: Live) => Math.floor((live.deps.random ?? Math.random)() * LIMERINO_LIVE_JITTER_MS);

function flushPatch(live: Live): void {
  live.batch = null;
  if (!live.pending.size) return;
  if (live.pending.size > LIMERINO_LIVE_MAX_PATCH_USERS) {
    live.pending.clear();
    live.deps.broadcast({ t: 'reload', v: limerinoBadgesVersion() });
    return;
  }
  const users = Object.fromEntries(live.pending);
  live.pending.clear();
  live.deps.broadcast({ t: 'patch', users });
}

async function refresh(live: Live): Promise<void> {
  if (live.refreshing) {
    live.refreshAgain = true;
    return;
  }
  live.refreshing = true;
  const hadList = limerinoHasCache();
  const before = limerinoBadgesVersion();
  try {
    await refreshLimerinoBadgesNow();
  } catch { /* keep what we have; the 10-minute refresh tries again */ }
  live.refreshing = false;
  if (live.refreshAgain) {
    live.refreshAgain = false;
    await refresh(live);
    return;
  }
  /* A freshly started server has nothing to compare with: overlays already
     hold a list, so there is nothing to tell them. */
  if (hadList && limerinoBadgesVersion() !== before) {
    live.pending.clear();
    live.deps.broadcast({ t: 'reload', v: limerinoBadgesVersion() });
  }
}

function onEvent(live: Live, event: SseEvent): void {
  let body: unknown;
  try {
    body = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!body || typeof body !== 'object') return;
  if (event.event === 'sync') {
    const { catalog, holders } = body as Record<string, unknown>;
    if (typeof catalog !== 'string' || typeof holders !== 'string') return;
    const held = limerinoCachedEtags();
    if (limerinoHasCache() && sameLimerinoEtag(held.catalog, catalog) && sameLimerinoEtag(held.holders, holders)) return;
    void refresh(live);
    return;
  }
  if (event.event === 'holders') {
    const users = parseLimerinoHolders({ users: (body as Record<string, unknown>).users });
    if (!users || users.size === 0) return;
    if (live.refreshing || limerinoRefreshInFlight() || !limerinoHasCache()) {
      void refresh(live);
      return;
    }
    if (!applyLimerinoHoldersPatch(users)) return;
    for (const [userId, badgeIds] of users) live.pending.set(userId, limerinoShownBadge(badgeIds));
    if (!live.batch) live.batch = setTimeout(() => flushPatch(live), LIMERINO_LIVE_BATCH_MS);
  }
  /* Unknown events are ignored, as Limerino asks. */
}

function clearSilence(live: Live): void {
  if (live.silence) clearTimeout(live.silence);
  live.silence = null;
}

function armSilence(live: Live, controller: AbortController): void {
  clearSilence(live);
  live.silence = setTimeout(() => controller.abort(), LIMERINO_LIVE_SILENCE_MS);
  live.silence.unref?.();
}

function scheduleReconnect(live: Live, delayMs: number): void {
  if (!live.running) return;
  if (live.reconnect) clearTimeout(live.reconnect);
  live.reconnect = setTimeout(() => {
    live.reconnect = null;
    void connect(live);
  }, delayMs);
  live.reconnect.unref?.();
}

function failureDelay(live: Live, providerMs: number): number {
  live.failures += 1;
  const base = Math.max(providerMs, LIMERINO_LIVE_REFUSED_RETRY_MS);
  return Math.min(base * (2 ** Math.min(live.failures - 1, 4)), LIMERINO_LIVE_MAX_RETRY_MS) + jitter(live);
}

async function connect(live: Live): Promise<void> {
  if (!live.running) return;
  const generation = ++live.generation;
  const controller = new AbortController();
  live.controller = controller;
  let response: Response;
  try {
    response = await live.deps.fetch(LIMERINO_EVENTS_URL, {
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'text/event-stream' },
    });
  } catch {
    if (generation === live.generation) scheduleReconnect(live, failureDelay(live, 0));
    return;
  }
  if (generation !== live.generation) {
    controller.abort();
    return;
  }
  if (!response.ok || !response.body) {
    const providerMs = retryAfterMs(response.headers.get('retry-after'));
    try { await response.body?.cancel(); } catch { /* nothing to do */ }
    scheduleReconnect(live, failureDelay(live, providerMs));
    return;
  }
  live.failures = 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseReader({
    onEvent: (event) => onEvent(live, event),
    onRetry: (ms) => { live.retryMs = Math.min(Math.max(ms, 1_000), LIMERINO_LIVE_MAX_RETRY_MS); },
  });
  armSilence(live, controller);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || generation !== live.generation) break;
      armSilence(live, controller);
      feed(decoder.decode(value, { stream: true }));
    }
  } catch { /* aborted or dropped: reconnect below */ }
  clearSilence(live);
  try { reader.releaseLock(); } catch { /* already released */ }
  if (generation === live.generation) scheduleReconnect(live, live.retryMs + jitter(live));
}

function checkIdle(live: Live): void {
  if (live.deps.connections() > 0) {
    live.idleSince = null;
    return;
  }
  const at = now(live);
  if (live.idleSince === null) live.idleSince = at;
  else if (at - live.idleSince >= LIMERINO_LIVE_IDLE_STOP_MS) stop(live);
}

function start(live: Live): void {
  if (live.running) return;
  live.running = true;
  live.idleSince = null;
  live.idleCheck = setInterval(() => checkIdle(live), LIMERINO_LIVE_IDLE_CHECK_MS);
  live.idleCheck.unref?.();
  void connect(live);
}

function stop(live: Live): void {
  live.running = false;
  live.generation += 1;
  live.controller?.abort();
  live.controller = null;
  clearSilence(live);
  if (live.reconnect) clearTimeout(live.reconnect);
  if (live.idleCheck) clearInterval(live.idleCheck);
  if (live.batch) clearTimeout(live.batch);
  live.reconnect = null;
  live.idleCheck = null;
  live.batch = null;
  live.pending.clear();
}

/* One per server process (kept across hot reloads in development). */
const store = globalThis as { __flosschatLimerinoLive?: Live };

/**
 * Opens the stream if it isn't open (call when an overlay that shows badges
 * connects). Does nothing in tests unless they installed their own deps.
 */
export function ensureLimerinoLive(deps: () => LimerinoLiveDeps): void {
  if (!store.__flosschatLimerinoLive) {
    if (process.env.NODE_ENV === 'test') return;
    store.__flosschatLimerinoLive = createLive(deps());
  }
  start(store.__flosschatLimerinoLive);
}

export function limerinoLiveRunning(): boolean {
  return store.__flosschatLimerinoLive?.running === true;
}

export function startLimerinoLiveForTests(deps: LimerinoLiveDeps): void {
  stopLimerinoLiveForTests();
  store.__flosschatLimerinoLive = createLive(deps);
  start(store.__flosschatLimerinoLive);
}

export function stopLimerinoLiveForTests(): void {
  const live = store.__flosschatLimerinoLive;
  if (live) stop(live);
  delete store.__flosschatLimerinoLive;
}
