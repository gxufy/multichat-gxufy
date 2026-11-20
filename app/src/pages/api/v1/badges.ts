/* GET /api/v1/badges[?user=<twitch id>] — public FlossChat badge list.
 *
 * For other chat clients and tools: which Twitch accounts wear a FlossChat
 * badge, with absolute image URLs in four sizes (animated WebP and a still
 * PNG). Read-only, no credentials, CORS-open, cached for a minute. Only
 * badges people are currently wearing are listed (taking a badge off on
 * FlossChat removes it here too).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { CANONICAL_ORIGIN } from '@/lib/domains.mjs';
import { getGxufyBadges, type GxufyBadgeDefinition } from '@/lib/server/gxufyBadges';

export type PublicBadge = {
  id: string;
  title: string;
  /** Animated WebP by size; 1x = 18px, 2x = 36px, 3x = 54px, 4x = 72px. */
  urls: Record<string, string>;
  /** Still PNG by size, for clients that can't animate. */
  staticUrls: Record<string, string>;
  /** Twitch user IDs wearing this badge. */
  users: string[];
};

export type PublicBadgesResponse = { provider: 'FlossChat'; badges: PublicBadge[] };

function absolute(path: string): string {
  return `${CANONICAL_ORIGIN}${path}`;
}

export function toPublicBadge(badge: GxufyBadgeDefinition, users: string[]): PublicBadge {
  const urls: Record<string, string> = {};
  const staticUrls: Record<string, string> = {};
  for (const file of badge.files ?? []) {
    const match = /^(\d)x\.(webp|png)$/.exec(file.name);
    if (!match || !badge.host) continue;
    (match[2] === 'webp' ? urls : staticUrls)[`${match[1]}x`] = absolute(`${badge.host}/${file.name}`);
  }
  if (!urls['1x']) urls['1x'] = absolute(badge.url);
  return { id: badge.id, title: badge.title, urls, staticUrls, users };
}

function cors(res: NextApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  const user = typeof req.query.user === 'string' ? req.query.user.trim() : '';
  if (user && !/^\d{1,20}$/.test(user)) {
    res.status(400).json({ error: 'user must be a Twitch user ID.' });
    return;
  }
  let badges: GxufyBadgeDefinition[];
  try {
    badges = await getGxufyBadges();
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Badges are not available right now.' });
    return;
  }
  const body: PublicBadgesResponse = {
    provider: 'FlossChat',
    badges: badges
      .map((badge) => toPublicBadge(badge, user ? badge.userIds.filter((id) => id === user) : badge.userIds))
      .filter((badge) => !user || badge.users.length > 0),
  };
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json(body);
}
