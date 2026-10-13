import type { NextApiHandler, NextApiRequest } from 'next';
import {
  normalizeYouTubeChannelSearchQuery,
  type YouTubeChannelSuggestion,
} from '@/lib/youtubeChannelSearch';
import { searchYouTubeChannels } from '@/lib/server/youtubeChannelSearch';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_MAX_CLIENTS = 1_000;
const rateLimits = new Map<string, { count: number; startedAt: number }>();

type ErrorResponse = { error: string };

function consumeRateLimit(
  req: NextApiRequest,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const key = resolveNodeClientKey(req);
  const current = rateLimits.get(key);

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.delete(key);
    rateLimits.set(key, { count: 1, startedAt: now });

    while (rateLimits.size > RATE_LIMIT_MAX_CLIENTS) {
      const oldest = rateLimits.keys().next();
      if (oldest.done) break;
      rateLimits.delete(oldest.value);
    }

    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.max(
        1,
        Math.ceil(
          (RATE_LIMIT_WINDOW_MS - (now - current.startedAt)) / 1_000,
        ),
      ),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

const handler: NextApiHandler<YouTubeChannelSuggestion[] | ErrorResponse> = async (
  req,
  res,
) => {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const query = Array.isArray(req.query.q)
    ? null
    : normalizeYouTubeChannelSearchQuery(req.query.q);

  if (!query) {
    return res.status(400).json({ error: 'Invalid YouTube channel search.' });
  }

  const rateLimit = consumeRateLimit(req);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    return res.status(429).json({ error: 'Too many YouTube channel searches.' });
  }

  try {
    return res.status(200).json(await searchYouTubeChannels(query));
  } catch {
    return res.status(502).json({ error: 'Unable to search YouTube channels.' });
  }
};

export function __resetYouTubeChannelSearchRateLimitForTests(): void {
  rateLimits.clear();
}

export default handler;
