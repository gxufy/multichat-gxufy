/** Server-only helper: resolve a Twitch user's chat color using a stored
 * connection's tokens, with a bounded TTL cache and per-user in-flight
 * coalescing.
 *
 * Colors are decoration on a 5-second pin poll, so this helper never throws:
 * every failure resolves to `''` and is negative-cached briefly so a broken
 * or unauthorized color endpoint is not hammered once per poll.
 *
 * Nothing sensitive is logged or cached — the cache holds only sender ids
 * mapped to colors, never tokens, connection ids, or Twitch response bodies.
 */

import { fetchTwitchUserChatColor } from './twitchUserChatColor';
import { getTwitchConnection } from './twitchConnectionReader';
import { refreshStoredTwitchConnection } from './twitchConnectionRefresher';

/* ------------------------------------------------------------------ */
/* Cache types                                                         */
/* ------------------------------------------------------------------ */

/**
 * A cached lookup outcome.
 *
 * `value` holds a resolved color (including the valid empty string for users
 * with no color configured). `failure` records that the lookup failed, so the
 * two cases stay distinguishable despite both rendering as `''`.
 */
type ColorCacheEntry =
  | { kind: 'value'; color: string; expiresAt: number }
  | { kind: 'failure'; expiresAt: number };

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Chat colors change rarely; 10 minutes collapses ~120 polls into 1 call. */
const POSITIVE_TTL_MS = 10 * 60 * 1_000;

/** Short enough to recover quickly, long enough to stop 5s hammering. */
const NEGATIVE_TTL_MS = 30 * 1_000;

/** Hard ceiling on cache size; oldest entries are evicted first. */
const MAX_ENTRIES = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/* Module state (process-local)                                        */
/* ------------------------------------------------------------------ */

/** senderUserId → cached outcome. Never holds tokens or connection ids. */
const colorCache = new Map<string, ColorCacheEntry>();

/** senderUserId → in-flight lookup, so concurrent polls share one request. */
const inFlight = new Map<string, Promise<string>>();

/* ------------------------------------------------------------------ */
/* Cache helpers                                                       */
/* ------------------------------------------------------------------ */

/** Validate that `value` is a non-empty string of decimal digits. */
function isDigits(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && /^\d+$/.test(value);
}

/**
 * Read a still-fresh cache entry, or `null` on a miss.
 *
 * Expired entries are deleted lazily here rather than on a timer.
 */
function readCache(senderUserId: string): ColorCacheEntry | null {
  const entry = colorCache.get(senderUserId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    colorCache.delete(senderUserId);
    return null;
  }
  return entry;
}

/**
 * Store an entry, refreshing its insertion position, and trim the cache to
 * {@link MAX_ENTRIES} by evicting oldest-first.
 *
 * `Map` preserves insertion order, so deleting before setting moves a
 * refreshed key to the newest position and `keys().next()` yields the oldest.
 */
function writeCache(senderUserId: string, entry: ColorCacheEntry): void {
  colorCache.delete(senderUserId);
  colorCache.set(senderUserId, entry);

  while (colorCache.size > MAX_ENTRIES) {
    const oldest = colorCache.keys().next();
    if (oldest.done) break;
    colorCache.delete(oldest.value);
  }
}

/* ------------------------------------------------------------------ */
/* Lookup                                                             */
/* ------------------------------------------------------------------ */

/**
 * Perform one uncached lookup: read the stored connection, ask Twitch, and
 * refresh the tokens once if Twitch reports the access token unauthorized.
 *
 * Resolves to the color (`''` when unset) and caches the outcome. Never
 * rejects — failures resolve to `''` behind a short negative TTL.
 */
async function lookupAndCache(
  connectionId: string,
  senderUserId: string,
): Promise<string> {
  try {
    const conn = await getTwitchConnection(connectionId);

    const first = await fetchTwitchUserChatColor(conn.accessToken, senderUserId);

    if (first.status === 'ok') {
      writeCache(senderUserId, {
        kind: 'value',
        color: first.color,
        expiresAt: Date.now() + POSITIVE_TTL_MS,
      });
      return first.color;
    }

    // Exactly one refresh + retry, only after an unauthorized response.
    const refreshed = await refreshStoredTwitchConnection(connectionId);

    const second = await fetchTwitchUserChatColor(
      refreshed.accessToken,
      senderUserId,
    );

    if (second.status === 'ok') {
      writeCache(senderUserId, {
        kind: 'value',
        color: second.color,
        expiresAt: Date.now() + POSITIVE_TTL_MS,
      });
      return second.color;
    }

    // Still unauthorized after refreshing — negative-cache and move on.
    writeCache(senderUserId, {
      kind: 'failure',
      expiresAt: Date.now() + NEGATIVE_TTL_MS,
    });
    return '';
  } catch {
    // Timeout, network error, malformed body, or refresh failure.
    writeCache(senderUserId, {
      kind: 'failure',
      expiresAt: Date.now() + NEGATIVE_TTL_MS,
    });
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve the chat color for `senderUserId` using the tokens stored against
 * `connectionId`.
 *
 * Returns an uppercase `#RRGGBB` string, or `''` when the user has no color
 * configured or the lookup could not be completed. Never throws, so a color
 * problem can never fail the surrounding pin lookup.
 *
 * Results are cached per sender id: 10 minutes for a resolved color
 * (including the empty string) and 30 seconds for a failure. Concurrent
 * callers asking for the same uncached sender share one Twitch request.
 */
export async function getStoredTwitchUserChatColor(
  connectionId: string,
  senderUserId: string,
): Promise<string> {
  // Re-validate at this boundary — never trust the caller's checks.
  if (typeof connectionId !== 'string' || !UUID_RE.test(connectionId)) {
    return '';
  }

  if (!isDigits(senderUserId)) {
    return '';
  }

  const cached = readCache(senderUserId);
  if (cached) {
    return cached.kind === 'value' ? cached.color : '';
  }

  // Coalesce concurrent lookups for the same sender within this process.
  const pending = inFlight.get(senderUserId);
  if (pending) return pending;

  const promise = lookupAndCache(connectionId, senderUserId).finally(() => {
    inFlight.delete(senderUserId);
  });

  inFlight.set(senderUserId, promise);

  return promise;
}
