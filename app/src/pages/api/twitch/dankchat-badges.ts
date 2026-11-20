import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';
import { validateCommunityBadgeAssetUrl } from '../../../lib/server/communityBadgeAsset';

const DANKCHAT_BADGES_URL = 'https://flxrs.com/api/badges';
const REQUEST_TIMEOUT_MS = 5_000;
export const DANKCHAT_BADGES_MAX_BYTES = 1024 * 1024;
const GENERIC_ERROR = { error: 'Unable to load DankChat badges.' };
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

type DankChatBadge = {
  type: string;
  url: string;
  users: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBadges(value: unknown): DankChatBadge[] | null {
  if (!Array.isArray(value)) return null;
  const badges: DankChatBadge[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    const url = validateCommunityBadgeAssetUrl(raw.url, 'dankchat');
    const users = Array.isArray(raw.users)
      ? raw.users
          .map((user) => typeof user === 'string' || typeof user === 'number' ? String(user).trim() : '')
          .filter(Boolean)
      : [];
    if (!type || !url || !users.length) continue;
    badges.push({ type, url, users: [...new Set(users)] });
  }
  return badges;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = await runFixedProviderWork({
      key: 'dankchat-badges',
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        const response = await fetch(DANKCHAT_BADGES_URL, {
          signal,
          redirect: 'error',
          headers: {
            Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
            'User-Agent': BROWSER_USER_AGENT,
          },
        });
        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error('DankChat badge lookup failed');
        }
        return readBoundedFixedProviderJson(response, DANKCHAT_BADGES_MAX_BYTES);
      }),
    });

    const badges = parseBadges(body);
    if (badges === null) return res.status(502).json(GENERIC_ERROR);

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
    return res.status(200).json(badges);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(GENERIC_ERROR);
    }
    return res.status(502).json(GENERIC_ERROR);
  }
}
