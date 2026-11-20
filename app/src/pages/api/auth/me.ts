/* GET /api/auth/me -> { signInReady, user, badges }
 *
 * The signed-in account (from the signed cookie) and the FlossChat badges it
 * owns and wears. Never cached: it is per visitor.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { ownsSupporterBadge } from '@/lib/server/gxufyBadges';
import { isOwner } from '@/lib/server/owner';
import { readSession } from '@/lib/server/session';
import { openSupporterStore } from '@/lib/server/supporterStore';
import { signInReady } from '@/lib/server/twitchOAuth';
import { SUPPORT_BADGE } from '@/lib/supportPage';

export type MeBadge = { id: string; title: string; url: string; owned: boolean; worn: boolean };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!signInReady()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const user = readSession(req);
  if (!user) return res.status(200).json({ signInReady: true, user: null, badges: [] });
  const store = openSupporterStore();
  const owned = await ownsSupporterBadge(user.id, store);
  let worn = owned;
  try {
    worn = owned && !(store ? await store.hiddenIds() : []).includes(user.id);
  } catch {
    worn = owned;
  }
  const badges: MeBadge[] = [{
    id: SUPPORT_BADGE.id,
    title: SUPPORT_BADGE.title,
    url: SUPPORT_BADGE.url,
    owned,
    worn,
  }];
  return res.status(200).json({ signInReady: true, user, badges, ...(isOwner(user.id) ? { owner: true } : {}) });
}
