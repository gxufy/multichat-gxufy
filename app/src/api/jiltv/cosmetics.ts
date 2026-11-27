/* GET /api/jiltv/cosmetics?logins=<a,b,…>&channel=<login>
 *
 * The JilTV paint each Twitch chatter wears in a channel, ready to render:
 * `{ paints: { login: paint | null } }`, null for one wearing no JilTV paint
 * there. Up to 50 logins at once; `channel` is the login of the channel shown
 * (empty for the chatter's own, global look). Off (404) unless
 * GXUFY_JILTV_COSMETICS_ENABLED=1.
 *
 * Asks JilTV's chat-client lookup for the logins it hasn't answered about in
 * the last minute (JilTV caches its answers for as long), in one request, and
 * draws the paints from the cached catalog. Runs through the shared
 * fixed-provider limiter like every other provider proxy. When JilTV says
 * we're asking too often (429), nobody is looked up until its Retry-After has
 * passed, and browsers are told to wait the same; a catalog that fails to load
 * is not asked for again for a minute.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../lib/server/fixedProviderProxy';
import {
  JILTV_CATALOG_MAX_BYTES,
  JILTV_CATALOG_URL,
  JILTV_LOOKS_MAX_BYTES,
  JILTV_LOOKS_URL,
  JILTV_LOOKUP_MAX_LOGINS,
  TWITCH_LOGIN_RE,
  jiltvCosmeticsServerEnabled,
  parseJilTVCatalog,
  parseJilTVLooks,
  type JilTVCatalog,
  type JilTVPaintView,
} from '../../lib/server/jiltvCosmetics';
import { retryAfterMs } from '../../lib/perUserLookupGuard';

const REQUEST_TIMEOUT_MS = 5_000;
/** As long as JilTV caches its own answers. */
export const JILTV_LOOK_TTL_MS = 60_000;
export const JILTV_LOOK_CACHE_MAX_KEYS = 4_000;
export const JILTV_CATALOG_TTL_MS = 10 * 60_000;
/** A paint we don't know yet may refresh the catalog, but not more than this often. */
export const JILTV_CATALOG_MIN_REFRESH_MS = 60_000;
const GENERIC_ERROR = { error: 'Unable to load JilTV cosmetics.' };
const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=60';

type CacheEntry = { paint: JilTVPaintView | null; expiresAt: number };
/** Keyed `${channel}|${login}`: a look can differ per channel. */
const lookCache = new Map<string, CacheEntry>();
let catalogState: { catalog: JilTVCatalog; etag: string; fetchedAt: number } | null = null;
/** No catalog request before this time (after one failed). */
let catalogRetryAt = 0;
/** No lookups before this time (after JilTV answered 429). */
let upstreamCooldownUntil = 0;

class JilTVRateLimitedError extends Error {}

export function __resetJilTVCosmeticsForTests(): void {
  lookCache.clear();
  catalogState = null;
  catalogRetryAt = 0;
  upstreamCooldownUntil = 0;
}

function remember(key: string, paint: JilTVPaintView | null, ttlMs: number): void {
  lookCache.delete(key);
  while (lookCache.size >= JILTV_LOOK_CACHE_MAX_KEYS) {
    const oldest = lookCache.keys().next();
    if (oldest.done) break;
    lookCache.delete(oldest.value);
  }
  lookCache.set(key, { paint, expiresAt: Date.now() + ttlMs });
}

function cachedLook(key: string): CacheEntry | null {
  const entry = lookCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    lookCache.delete(key);
    return null;
  }
  return entry;
}

async function loadCatalog(signal: AbortSignal, force: boolean): Promise<JilTVCatalog | null> {
  const now = Date.now();
  if (catalogState) {
    const age = now - catalogState.fetchedAt;
    if (age < JILTV_CATALOG_TTL_MS && (!force || age < JILTV_CATALOG_MIN_REFRESH_MS)) {
      return catalogState.catalog;
    }
  }
  if (now < catalogRetryAt) return catalogState?.catalog ?? null;
  const response = await fetch(JILTV_CATALOG_URL, {
    signal,
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      ...(catalogState?.etag ? { 'If-None-Match': catalogState.etag } : {}),
    },
  });
  if (response.status === 304 && catalogState) {
    await discardFixedProviderBody(response);
    catalogState = { ...catalogState, fetchedAt: now };
    return catalogState.catalog;
  }
  if (!response.ok) {
    await discardFixedProviderBody(response);
    /* Keep serving the last good catalog through an upstream hiccup. */
    catalogRetryAt = now + JILTV_CATALOG_MIN_REFRESH_MS;
    return catalogState?.catalog ?? null;
  }
  const catalog = parseJilTVCatalog(await readBoundedFixedProviderJson(response, JILTV_CATALOG_MAX_BYTES));
  if (!catalog) {
    catalogRetryAt = now + JILTV_CATALOG_MIN_REFRESH_MS;
    return catalogState?.catalog ?? null;
  }
  catalogRetryAt = 0;
  catalogState = { catalog, etag: response.headers.get('etag') ?? '', fetchedAt: now };
  return catalog;
}

/** The logins asked about, lowercased and deduplicated, or null when any is invalid. */
function requestedLogins(raw: ApiRequest['query'][string]): string[] | null {
  if (typeof raw !== 'string') return null;
  const logins = [...new Set(raw.split(',').map((login) => login.trim().toLowerCase()))];
  if (!logins.length || logins.length > JILTV_LOOKUP_MAX_LOGINS) return null;
  return logins.every((login) => TWITCH_LOGIN_RE.test(login)) ? logins : null;
}

function requestedChannel(raw: ApiRequest['query'][string]): string | null {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') return null;
  const channel = raw.trim().toLowerCase();
  return channel === '' || TWITCH_LOGIN_RE.test(channel) ? channel : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!jiltvCosmeticsServerEnabled()) {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const logins = requestedLogins(req.query.logins);
  if (!logins) return res.status(400).json({ error: 'Invalid Twitch logins.' });
  const channel = requestedChannel(req.query.channel);
  if (channel === null) return res.status(400).json({ error: 'Invalid Twitch channel.' });

  const paints: Record<string, JilTVPaintView | null> = {};
  const missing: string[] = [];
  for (const login of logins) {
    const cached = cachedLook(`${channel}|${login}`);
    if (cached) paints[login] = cached.paint;
    else missing.push(login);
  }
  if (!missing.length) {
    res.setHeader('Cache-Control', CACHE_CONTROL);
    return res.status(200).json({ paints });
  }
  const coolingFor = upstreamCooldownUntil - Date.now();
  if (coolingFor > 0) {
    res.setHeader('Retry-After', String(Math.ceil(coolingFor / 1_000)));
    return res.status(429).json(GENERIC_ERROR);
  }

  try {
    const { found, ttlMs } = await runFixedProviderWork({
      key: `jiltv-cosmetics:${channel}:${missing.join(',')}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        /* Logins and channel are [a-z0-9_] only, so they go in as they are,
           commas included, as JilTV's docs show them. */
        const url = `${JILTV_LOOKS_URL}?logins=${missing.join(',')}${channel ? `&channel=${channel}` : ''}`;
        const response = await fetch(url, {
          signal,
          redirect: 'error',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 429) {
          upstreamCooldownUntil = Math.max(
            upstreamCooldownUntil,
            Date.now() + retryAfterMs(response.headers.get('Retry-After')),
          );
          await discardFixedProviderBody(response);
          throw new JilTVRateLimitedError('JilTV asked us to slow down');
        }
        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error('JilTV lookup failed');
        }
        const looks = parseJilTVLooks(await readBoundedFixedProviderJson(response, JILTV_LOOKS_MAX_BYTES));
        if (!looks) throw new Error('malformed JilTV lookup');
        const worn = missing.flatMap((login) => {
          const paintId = looks.get(login);
          return paintId ? [paintId] : [];
        });
        let catalog: JilTVCatalog | null = null;
        if (worn.length) {
          catalog = await loadCatalog(signal, false);
          if (catalog && worn.some((paintId) => !catalog!.paints.has(paintId))) {
            catalog = await loadCatalog(signal, true);
          }
        }
        const result = new Map<string, JilTVPaintView | null>();
        for (const login of missing) {
          const paintId = looks.get(login);
          result.set(login, paintId ? catalog?.paints.get(paintId) ?? null : null);
        }
        /* Paints we couldn't draw (no catalog yet) are asked about again soon. */
        return { found: result, ttlMs: worn.length && !catalog ? 15_000 : JILTV_LOOK_TTL_MS };
      }),
    });
    for (const [login, paint] of found) {
      remember(`${channel}|${login}`, paint, ttlMs);
      paints[login] = paint;
    }
    res.setHeader('Cache-Control', CACHE_CONTROL);
    return res.status(200).json({ paints });
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(GENERIC_ERROR);
    }
    if (error instanceof JilTVRateLimitedError) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((upstreamCooldownUntil - Date.now()) / 1_000))));
      return res.status(429).json(GENERIC_ERROR);
    }
    return res.status(502).json(GENERIC_ERROR);
  }
}
