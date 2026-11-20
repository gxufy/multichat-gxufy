/* GET /api/support/status -> { checkoutReady, signInReady }
 *
 * Lets the (static) MultiChat page know whether to show its Support button,
 * and its Badges button (Twitch sign-in set up). 404 while the support page
 * is switched off, so both stay hidden.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { checkoutDeps } from '@/lib/server/supportCheckout';
import { signInReady } from '@/lib/server/twitchOAuth';
import { supportPageEnabled } from '@/lib/supportPage';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!supportPageEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  return res.status(200).json({ checkoutReady: checkoutDeps() !== null, signInReady: signInReady() });
}
