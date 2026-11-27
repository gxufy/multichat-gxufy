/* GET /api/auth/me -> { signInReady, user, badges, standing }
 *
 * The signed-in account (from the signed cookie), the FlossChat badges it
 * holds (Owner, Founder, its tier and the tiers below) and which one it wears (one at a time),
 * and what each tier costs it from here. Never cached: it is per visitor.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { getGxufyBadges, heldBadgeIds, supporterStanding, wornBadgeId } from '@/lib/server/gxufyBadges';
import { isOwner } from '@/lib/server/owner';
import { readSession } from '@/lib/server/session';
import { openSupporterStore } from '@/lib/server/supporterStore';
import { signInReady } from '@/lib/server/twitchOAuth';

export type MeBadge = { id: string; title: string; url: string; owned: boolean; worn: boolean };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!signInReady()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const user = readSession(req);
  if (!user) return res.status(200).json({ signInReady: true, user: null, badges: [] });
  const store = openSupporterStore();
  const standing = await supporterStanding(user.id, store);
  const wearing = await wornBadgeId(user.id, store);
  /* Owner, Founder, their tier and the tiers below it. */
  const held = new Set<string>(heldBadgeIds(standing));
  const badges: MeBadge[] = (await getGxufyBadges(store))
    .filter((badge) => held.has(badge.id))
    .map((badge) => ({ id: badge.id, title: badge.title, url: badge.url, owned: true, worn: badge.id === wearing }));
  return res.status(200).json({ signInReady: true, user, badges, standing, ...(isOwner(user.id) ? { owner: true } : {}) });
}
