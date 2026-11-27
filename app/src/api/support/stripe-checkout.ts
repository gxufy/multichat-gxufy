/* POST /api/support/stripe-checkout { amountCents?, login? } | { amountCents?, forSelf: true } -> { url }
 *
 * The Stripe side of supporting ($5 or more): card, Apple Pay or Google Pay on
 * Stripe's own checkout page. Same rules as the PayPal checkout: signed-in
 * buyer, amount checked and stored here, recipient resolved here. Stripe then
 * sends the buyer back to /support?stripe=return&session_id=..., and
 * /api/support/stripe-confirm checks the payment with Stripe before granting.
 * With Managed Payments only badges go by card: Stripe sells digital products
 * as the merchant of record, and support without a badge isn't one (PayPal
 * still takes it).
 */
import { randomUUID } from 'crypto';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { FixedProviderAdmissionError } from '@/lib/server/fixedProviderProxy';
import { queueAbuseRateLimit } from '@/lib/server/abuseDiscord';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { createStripeCheckout, describeStripeError } from '@/lib/server/stripe';
import { stripeDeps, supportReturnOrigin } from '@/lib/server/supportCheckout';
import { supporterTier } from '@/lib/supporterTiers';
import { readSupportOrderRequest } from '@/lib/server/supportOrderRequest';

const UNAVAILABLE = { error: 'Card checkout is not available right now.' };

/* A real supporter starts a checkout a handful of times at most. */
const stripeCheckoutLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 8 });

export function __resetStripeCheckoutLimitForTests(): void {
  stripeCheckoutLimit.reset();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const deps = stripeDeps();
  if (!deps) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const clientKey = resolveNodeClientKey(req);
  if (!stripeCheckoutLimit.admit(clientKey)) {
    queueAbuseRateLimit({ clientIp: clientKey, area: 'support-stripe-checkout', retryAfterSeconds: 600 });
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  try {
    const request = await readSupportOrderRequest(req, deps.store);
    if (!request.ok) return res.status(request.status).json({ error: request.error });
    const { amountCents, recipient, kind, tier } = request.order;
    if (deps.stripe.managedPayments && !recipient) {
      return res.status(400).json({ error: 'Card checkout is for badges. Use PayPal to support without a badge.' });
    }
    const reference = randomUUID();
    const origin = supportReturnOrigin(req);
    const session = await createStripeCheckout(deps.stripe, {
      reference,
      amountCents,
      recipientId: recipient?.id ?? null,
      kind,
      description: recipient ? `FlossChat ${supporterTier(tier ?? 'supporter').name} badge for ${recipient.login}` : 'Support FlossChat',
      successUrl: `${origin}/support?stripe=return&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/support?stripe=cancel`,
    });
    await deps.store.recordCreated({ orderId: session.id, reference, recipient, kind, amountCents, ...(tier ? { tier } : {}) });
    return res.status(200).json({ url: session.url });
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(UNAVAILABLE);
    }
    const reason = describeStripeError(error);
    console.warn(`[stripe checkout] failed: ${reason}`);
    /* Under `npm run dev` the page shows the reason too (never a key). */
    return res.status(502).json({ ...UNAVAILABLE, ...(process.env.NODE_ENV === 'development' ? { detail: reason } : {}) });
  }
}
