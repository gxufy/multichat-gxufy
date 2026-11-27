/* POST /api/support/stripe-confirm { sessionId } -> { status, recipient, tier }
 *
 * Called when Stripe sends the buyer back. Reads the Checkout Session from
 * Stripe and grants the badge only when Stripe itself says: finished and
 * paid, exactly the amount we set for this order (never under $5), USD, and
 * the same order/recipient we created. Safe to call twice. The webhook does
 * the same for buyers who close the tab before coming back.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { STRIPE_SESSION_ID_RE, describeStripeError, getStripeCheckout } from '@/lib/server/stripe';
import { grantVerifiedCapture, stripeDeps, stripeSessionMatchesOrder } from '@/lib/server/supportCheckout';
import { requestBody } from '@/lib/server/supportOrderRequest';

const FAILED = { error: 'We could not confirm this payment.' };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const deps = stripeDeps();
  if (!deps) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const sessionId = typeof requestBody(req).sessionId === 'string' ? String(requestBody(req).sessionId) : '';
  if (!STRIPE_SESSION_ID_RE.test(sessionId)) return res.status(400).json(FAILED);
  const stored = await deps.store.getOrder(sessionId);
  /* Only checkouts this server created can ever grant anything. */
  if (!stored) return res.status(404).json(FAILED);
  const recipient = stored.recipient
    ? { login: stored.recipient.login, displayName: stored.recipient.displayName }
    : null;
  if (stored.status === 'completed') return res.status(200).json({ status: 'completed', recipient, tier: stored.tier ?? null });
  if (stored.status === 'reversed') return res.status(409).json(FAILED);
  try {
    const session = await getStripeCheckout(deps.stripe, sessionId);
    /* Finished, but a bank-based method is still clearing: the webhook grants later. */
    if (session.status === 'complete' && session.paymentStatus === 'unpaid') {
      return res.status(202).json({ status: 'pending', recipient, tier: stored.tier ?? null });
    }
    if (!stripeSessionMatchesOrder(session, stored)) return res.status(409).json(FAILED);
    const completed = await grantVerifiedCapture(deps, sessionId, session.paymentIntentId!);
    if (!completed) return res.status(409).json(FAILED);
    return res.status(200).json({ status: 'completed', recipient, tier: stored.tier ?? null });
  } catch (error) {
    console.warn(`[stripe confirm] failed: ${describeStripeError(error)}`);
    return res.status(502).json(FAILED);
  }
}
