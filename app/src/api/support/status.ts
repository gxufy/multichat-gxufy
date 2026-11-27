/* GET /api/support/status -> { checkoutReady, signInReady, paypal?, stripe?, founderSlotsLeft }
 *
 * Lets the (static) MultiChat page know whether to show its Support button,
 * and its Badges button (Twitch sign-in set up). 404 while the support page
 * is switched off, so both stay hidden.
 *
 * paypal: { clientId, env } when checkout is ready, for the PayPal buttons on
 * the support page. The client ID is public by design (it goes in the PayPal
 * script URL); the secret never leaves the server.
 * stripe: true when Stripe Checkout (card, Apple Pay, Google Pay) is set up.
 * founderSlotsLeft: how many of the first FOUNDER_LIMIT Founder badges are
 * still open (null when the supporter store can't be read).
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { checkoutDeps, stripeDeps } from '@/lib/server/supportCheckout';
import { signInReady } from '@/lib/server/twitchOAuth';
import { openSupporterStore } from '@/lib/server/supporterStore';
import { supportPageEnabled } from '@/lib/supportPage';
import { FOUNDER_LIMIT } from '@/lib/supporterTiers';

async function founderSlotsLeft(): Promise<number | null> {
  try {
    const store = openSupporterStore();
    return store ? Math.max(0, FOUNDER_LIMIT - (await store.founderIds(FOUNDER_LIMIT)).length) : null;
  } catch {
    return null;
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!supportPageEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const deps = checkoutDeps();
  return res.status(200).json({
    checkoutReady: deps !== null,
    signInReady: signInReady(),
    ...(deps ? { paypal: { clientId: deps.paypal.clientId, env: deps.paypal.env } } : {}),
    ...(stripeDeps() ? { stripe: true } : {}),
    founderSlotsLeft: await founderSlotsLeft(),
  });
}
