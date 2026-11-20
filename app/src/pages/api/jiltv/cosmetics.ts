/* GET /api/jiltv/cosmetics?userId=<numeric Twitch id>
 *
 * What one Twitch chatter wears on JilTV: `{ paint, badge }`, ready to render.
 * Off (404) unless GXUFY_JILTV_COSMETICS_ENABLED=1. Runs through the shared
 * fixed-provider limiter like every other provider proxy; per-user answers
 * and the paint catalog are cached so chat traffic never fans out upstream.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';
import {
  JILTV_CATALOG_MAX_BYTES,
  JILTV_CATALOG_URL,
  JILTV_GRAPHQL_URL,
  JILTV_USER_MAX_BYTES,
  JILTV_USER_QUERY,
  jiltvCosmeticsServerEnabled,
  parseJilTVCatalog,
  parseJilTVUserResponse,
  type JilTVCatalog,
  type JilTVUserCosmetics,
} from '../../../lib/server/jiltvCosmetics';

const REQUEST_TIMEOUT_MS = 5_000;
export const JILTV_USER_SUCCESS_TTL_MS = 5 * 60_000;
export const JILTV_USER_EMPTY_TTL_MS = 10 * 60_000;
export const JILTV_USER_CACHE_MAX_KEYS = 2_000;
export const JILTV_CATALOG_TTL_MS = 10 * 60_000;
/** A paint we don't know yet may refresh the catalog, but not more than this often. */
export const JILTV_CATALOG_MIN_REFRESH_MS = 60_000;
const GENERIC_ERROR = { error: 'Unable to load JilTV cosmetics.' };

type CacheEntry = { value: JilTVUserCosmetics; expiresAt: number };
const userCache = new Map<string, CacheEntry>();
let catalogState: { catalog: JilTVCatalog; etag: string; fetchedAt: number } | null = null;

export function __resetJilTVCosmeticsForTests(): void {
  userCache.clear();
  catalogState = null;
}

function remember(userId: string, value: JilTVUserCosmetics, ttlMs: number): void {
  userCache.delete(userId);
  while (userCache.size >= JILTV_USER_CACHE_MAX_KEYS) {
    const oldest = userCache.keys().next();
    if (oldest.done) break;
    userCache.delete(oldest.value);
  }
  userCache.set(userId, { value, expiresAt: Date.now() + ttlMs });
}

async function loadCatalog(signal: AbortSignal, force: boolean): Promise<JilTVCatalog | null> {
  const now = Date.now();
  if (catalogState) {
    const age = now - catalogState.fetchedAt;
    if (age < JILTV_CATALOG_TTL_MS && (!force || age < JILTV_CATALOG_MIN_REFRESH_MS)) {
      return catalogState.catalog;
    }
  }
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
    return catalogState?.catalog ?? null;
  }
  const catalog = parseJilTVCatalog(await readBoundedFixedProviderJson(response, JILTV_CATALOG_MAX_BYTES));
  if (!catalog) return catalogState?.catalog ?? null;
  catalogState = { catalog, etag: response.headers.get('etag') ?? '', fetchedAt: now };
  return catalog;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!jiltvCosmeticsServerEnabled()) {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const userId = Array.isArray(req.query.userId) ? '' : String(req.query.userId ?? '').trim();
  if (!/^\d{1,25}$/.test(userId)) {
    return res.status(400).json({ error: 'Invalid Twitch user ID.' });
  }

  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=180');
    return res.status(200).json(cached.value);
  }

  try {
    const value = await runFixedProviderWork({
      key: `jiltv-cosmetics:${userId}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        const response = await fetch(JILTV_GRAPHQL_URL, {
          method: 'POST',
          signal,
          redirect: 'error',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: JILTV_USER_QUERY, variables: { id: userId } }),
        });
        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error('JilTV user lookup failed');
        }
        const ref = parseJilTVUserResponse(await readBoundedFixedProviderJson(response, JILTV_USER_MAX_BYTES));
        if (!ref) throw new Error('malformed JilTV user response');
        let paint = null;
        if (ref.paintId) {
          let catalog = await loadCatalog(signal, false);
          if (catalog && !catalog.paints.has(ref.paintId)) catalog = await loadCatalog(signal, true);
          paint = catalog?.paints.get(ref.paintId) ?? null;
        }
        return { paint, badge: ref.badge } satisfies JilTVUserCosmetics;
      }),
    });
    remember(userId, value, value.paint || value.badge ? JILTV_USER_SUCCESS_TTL_MS : JILTV_USER_EMPTY_TTL_MS);
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=180');
    return res.status(200).json(value);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(GENERIC_ERROR);
    }
    return res.status(502).json(GENERIC_ERROR);
  }
}
