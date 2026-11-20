/* POST /api/badges/wear { badgeId: 'supporter', worn: boolean } -> { worn }
 *
 * Signed-in owners only, from our own pages only. Live overlays pick the
 * change up within about 15 seconds (see /api/twitch/gxufy-badges-version).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { ownsSupporterBadge } from '@/lib/server/gxufyBadges';
import { isSameOriginRequest, readSession } from '@/lib/server/session';
import { openSupporterStore } from '@/lib/server/supporterStore';
import { signInReady } from '@/lib/server/twitchOAuth';
import { SUPPORT_BADGE } from '@/lib/supportPage';

const wearLimit = createClientWindowLimit({ windowMs: 60_000, max: 30 });

export function __resetWearLimitForTests(): void {
  wearLimit.reset();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const store = openSupporterStore();
  if (!signInReady() || !store) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Forbidden.' });
  const user = readSession(req);
  if (!user) return res.status(401).json({ error: 'Sign in again.' });
  if (!wearLimit.admit(`${resolveNodeClientKey(req)}:${user.id}`)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Slow down a little.' });
  }
  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};
  if (body.badgeId !== SUPPORT_BADGE.id || typeof body.worn !== 'boolean') {
    return res.status(400).json({ error: 'Unknown badge.' });
  }
  if (!await ownsSupporterBadge(user.id, store)) return res.status(403).json({ error: 'You do not own this badge.' });
  try {
    await store.setBadgeWorn(user.id, body.worn);
  } catch {
    return res.status(503).json({ error: 'Could not save. Try again.' });
  }
  return res.status(200).json({ worn: body.worn });
}
