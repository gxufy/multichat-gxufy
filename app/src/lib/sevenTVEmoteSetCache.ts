/* A single process-wide cache for 7TV emote sets, keyed by set id.
 *
 * The v3 split fetch (lib/kick.ts) turns one channel load into two requests,
 * and the same set id shows up more than once in a session: the initial load,
 * a `!multichat refresh emotes`, and — when two connected platforms happen to
 * share a set — both connectors. Without a cache each of those refetches the
 * whole set; with one, a set is fetched at most once per TTL and concurrent
 * askers share a single in-flight request.
 *
 * What it deliberately does NOT do: it does not know about channels, platforms,
 * or the active-vs-personal distinction. It is a pure id → emotes memo. The
 * caller decides which set id is the channel's active set, which is global, and
 * which is personal (see lib/kick.ts and pages/multichat.tsx); this layer only
 * guarantees that asking for the same id twice is cheap and consistent.
 */
import { fetchSevenTVEmoteSet, type SevenTVEmote } from './kick';

/* A resolved set lives this long before the next ask refetches it. Sets change
   rarely (a streamer adding an emote), and the overlay's live EventAPI path
   already applies emote_set.update deltas without a reload, so this TTL only
   governs how stale a *cold reload* of the generator or a refresh command can
   be — minutes, not seconds, is the right order. */
export const EMOTE_SET_TTL_MS = 10 * 60 * 1000; // 10 minutes

/* A 404 (the set id does not resolve) is remembered too, so a channel whose
   connection points at a deleted set does not re-request it on every refresh.
   Kept far shorter than the positive TTL: a set can be recreated, and negative
   caching is a courtesy to the API, not a correctness requirement. */
export const EMOTE_SET_NEGATIVE_TTL_MS = 60 * 1000; // 1 minute

type CacheEntry =
  /** A resolved set (possibly empty — an empty 200 is still authoritative). */
  | { kind: 'emotes'; emotes: SevenTVEmote[]; expiresAt: number }
  /** A confirmed-missing set (404), cached negatively for a short window. */
  | { kind: 'missing'; expiresAt: number };

/* Module-level so every overlay mount and refresh shares it. Transient
   failures are never written here — see resolve() — so a network blip during
   one load never denies the emotes to the next. */
const cache = new Map<string, CacheEntry>();

/* In-flight requests, so N concurrent askers for one id issue ONE fetch and
   all await the same promise. Cleared the moment the fetch settles, whether it
   populated the cache or not, so a transient failure doesn't wedge the id. */
const inFlight = new Map<string, Promise<SevenTVEmote[]>>();

function fresh(entry: CacheEntry | undefined, now: number): CacheEntry | undefined {
  if (!entry) return undefined;
  return entry.expiresAt > now ? entry : undefined;
}

/* Resolve an emote set by id through the cache.
 *
 * - A fresh positive or negative entry answers without a request.
 * - A concurrent ask for the same id joins the in-flight request.
 * - HTTP 200 populates the positive cache (even when empty).
 * - HTTP 404 populates the negative cache.
 * - A transient failure (network, abort, 429, 5xx) is NOT cached and NOT
 *   retried here — the caller gets [] and the next ask will try again.
 *
 * `signal` aborts THIS caller's wait and the underlying request if this caller
 * started it; a set fetch shared with another live caller is not cancelled out
 * from under them, which is why abort resolves to [] rather than throwing.
 */
export function resolveSevenTVEmoteSet(setId: string, signal?: AbortSignal): Promise<SevenTVEmote[]> {
  const now = Date.now();
  const cached = fresh(cache.get(setId), now);
  if (cached) {
    return Promise.resolve(cached.kind === 'emotes' ? cached.emotes : []);
  }

  const existing = inFlight.get(setId);
  if (existing) return guardAbort(existing, signal);

  const request = fetchSevenTVEmoteSet(setId, signal)
    .then(outcome => {
      if (outcome.status === 'ok') {
        cache.set(setId, { kind: 'emotes', emotes: outcome.emotes, expiresAt: Date.now() + EMOTE_SET_TTL_MS });
        return outcome.emotes;
      }
      if (outcome.status === 'missing') {
        cache.set(setId, { kind: 'missing', expiresAt: Date.now() + EMOTE_SET_NEGATIVE_TTL_MS });
        return [];
      }
      // 'error' — transient. Do not write the cache; let the next ask retry.
      return [];
    })
    .finally(() => {
      inFlight.delete(setId);
    });

  inFlight.set(setId, request);
  return guardAbort(request, signal);
}

/* Let a caller's own abort signal end its wait early without disturbing a
   shared request. The underlying fetch still settles and still populates the
   cache for everyone else. */
function guardAbort(promise: Promise<SevenTVEmote[]>, signal?: AbortSignal): Promise<SevenTVEmote[]> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve([]);
  return new Promise<SevenTVEmote[]>(resolve => {
    const onAbort = () => resolve([]);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      emotes => { signal.removeEventListener('abort', onAbort); resolve(emotes); },
      () => { signal.removeEventListener('abort', onAbort); resolve([]); },
    );
  });
}

/* Drop cached entries so the next ask refetches. In-flight requests are left
   alone: a caller already awaiting one still gets its result, and clearing only
   the settled cache means the immediate refetch below shares that in-flight
   request rather than racing a second one.
 *
 * The `!multichat refresh emotes` command calls this before re-fetching, which
 * is the whole point of the command — a moderator runs it precisely because a
 * set changed, so honoring the positive TTL there would make refresh a silent
 * no-op. Ordinary loads keep the TTL. */
export function clearSevenTVEmoteSetCache(): void {
  cache.clear();
}

/* Test-only: drop all cached AND in-flight state so one test's fetches can't
   answer another's. Not used by the app. */
export function __resetSevenTVEmoteSetCache(): void {
  cache.clear();
  inFlight.clear();
}
