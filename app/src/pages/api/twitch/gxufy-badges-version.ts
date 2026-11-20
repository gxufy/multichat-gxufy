/* GET /api/twitch/gxufy-badges-version -> { v, live }
 *
 * A short fingerprint of the FlossChat badge list. Live overlays ask every
 * 15 seconds and reload the list only when it changes, so a purchase or a
 * wear/take-off on /badges shows up in chat within seconds. Tiny and cached
 * briefly at any shared cache in front of the server.
 *
 * live=false when there is no supporter store (support switched off, as in
 * production today): the list can only change with a deploy, so overlays stop
 * checking instead of asking every 15 seconds for nothing.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getGxufyBadgesVersion } from '@/lib/server/gxufyBadges';
import { openSupporterStore } from '@/lib/server/supporterStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const store = openSupporterStore();
  const v = await getGxufyBadgesVersion(store);
  res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
  res.status(200).json({ v, live: store !== null });
}
