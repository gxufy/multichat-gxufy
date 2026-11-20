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
  parseEnhancerUserBadges,
  type EnhancerUserBadge,
} from '../../../lib/server/enhancerBadges';

const ENHANCER_USER_URL = 'https://api.enhancer.at/v1/user/twitch/';
const REQUEST_TIMEOUT_MS = 5_000;
export const ENHANCER_USER_MAX_BYTES = 256 * 1024;
export const ENHANCER_USER_SUCCESS_TTL_MS = 15 * 60_000;
export const ENHANCER_USER_FAILURE_TTL_MS = 5 * 60_000;
export const ENHANCER_USER_CACHE_MAX_KEYS = 2_000;
const GENERIC_ERROR = { error: 'Unable to load Enhancer badges.' };

type CacheEntry = { badges: EnhancerUserBadge[]; expiresAt: number };
const cache = new Map<string, CacheEntry>();

class EnhancerNotFound extends Error {}

function remember(userId: string, badges: EnhancerUserBadge[], ttlMs: number): void {
  cache.delete(userId);
  while (cache.size >= ENHANCER_USER_CACHE_MAX_KEYS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(userId, { badges, expiresAt: Date.now() + ttlMs });
}

export function __resetEnhancerUserBadgeCacheForTests(): void {
  cache.clear();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const userId = Array.isArray(req.query.userId) ? '' : String(req.query.userId ?? '').trim();
  if (!/^\d{1,25}$/.test(userId)) {
    return res.status(400).json({ error: 'Invalid Twitch user ID.' });
  }

  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
    return res.status(200).json(cached.badges);
  }

  try {
    const badges = await runFixedProviderWork({
      key: `enhancer-user:${userId}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        const response = await fetch(`${ENHANCER_USER_URL}${encodeURIComponent(userId)}`, {
          signal,
          redirect: 'error',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 404) {
          await discardFixedProviderBody(response);
          throw new EnhancerNotFound();
        }
        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error('Enhancer user lookup failed');
        }
        const parsed = parseEnhancerUserBadges(
          await readBoundedFixedProviderJson(response, ENHANCER_USER_MAX_BYTES),
          userId,
        );
        if (parsed === null) throw new Error('malformed Enhancer user response');
        return parsed;
      }),
    });
    remember(userId, badges, ENHANCER_USER_SUCCESS_TTL_MS);
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
    return res.status(200).json(badges);
  } catch (error) {
    if (error instanceof EnhancerNotFound) {
      /* Not an Enhancer user: an authoritative "no badges". */
      remember(userId, [], ENHANCER_USER_FAILURE_TTL_MS);
      res.setHeader('Cache-Control', 'public, s-maxage=300');
      return res.status(200).json([]);
    }
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(GENERIC_ERROR);
    }
    return res.status(502).json(GENERIC_ERROR);
  }
}
