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

const CHATSEN_BADGES_URL = 'https://api.chatsen.app/account/badges';
const REQUEST_TIMEOUT_MS = 5_000;
export const CHATSEN_BADGES_MAX_BYTES = 1024 * 1024;
const GENERIC_ERROR = { error: 'Unable to load Chatsen badges.' };
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

type ChatsenBadge = {
  id: string;
  title: string;
  url: string;
  users: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(stringValue).filter(Boolean))]
    : [];
}

function parseBadges(value: unknown): ChatsenBadge[] | null {
  if (!Array.isArray(value)) return null;
  const badges: ChatsenBadge[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = stringValue(raw.id);
    const title = stringValue(raw.name) || id || 'Chatsen';
    const users = stringList(raw.users);
    const mipmap = Array.isArray(raw.mipmap) ? raw.mipmap : [];
    const url = [...mipmap]
      .reverse()
      .map((candidate) => validateCommunityBadgeAssetUrl(candidate, 'chatsen'))
      .find(Boolean) ?? null;
    if (!id || !url || !users.length) continue;
    badges.push({ id, title, url, users });
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
      key: 'chatsen-badges',
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        const response = await fetch(CHATSEN_BADGES_URL, {
          signal,
          redirect: 'error',
          headers: {
            Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
            'User-Agent': BROWSER_USER_AGENT,
          },
        });
        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error('Chatsen badge lookup failed');
        }
        return readBoundedFixedProviderJson(response, CHATSEN_BADGES_MAX_BYTES);
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
