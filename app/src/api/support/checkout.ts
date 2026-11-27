/* POST /api/support/checkout { amountCents?, login?: string } | { amountCents?, forSelf: true }
 *   -> { approveUrl, orderId }
 *
 * fundingSource ('paypal' | 'venmo' | 'paylater' | 'card'): the PayPal button
 * pressed on the support page, which then approves the order in PayPal's own
 * window and asks /api/support/capture to finish it. Left out: the redirect
 * flow (approveUrl).
 *
 * Starts a one-time PayPal order of $5 or more (amountCents, whole cents,
 * $5–$500; $5 when left out). The amount is checked here and stored with the
 * order, and capture grants only that exact amount. The buyer must be
 * signed in with Twitch, so every payment is tied to a known account.
 * The badge goes to:
 *  - forSelf: the signed-in Twitch account (read from the signed session
 *    cookie, never from the request body);
 *  - login: a gift, the Twitch name resolved here to its account ID;
 *  - neither: no badge, just support.
 * The browser is then sent to PayPal to approve.
 */
import { randomUUID } from 'crypto';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { FixedProviderAdmissionError } from '@/lib/server/fixedProviderProxy';
import { queueAbuseRateLimit } from '@/lib/server/abuseDiscord';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { PayPalError, createSupportOrder, isSupportFundingSource } from '@/lib/server/paypal';
import { checkoutDeps, recipientCustomId, supportReturnOrigin } from '@/lib/server/supportCheckout';
import { supporterTier } from '@/lib/supporterTiers';
import { readSupportOrderRequest, requestBody } from '@/lib/server/supportOrderRequest';

const UNAVAILABLE = { error: 'Checkout is not available right now.' };

/* A real supporter starts a checkout a handful of times at most. */
const checkoutLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 8 });

export function __resetSupportCheckoutLimitForTests(): void {
  checkoutLimit.reset();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const deps = checkoutDeps();
  if (!deps) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const clientKey = resolveNodeClientKey(req);
  if (!checkoutLimit.admit(clientKey)) {
    queueAbuseRateLimit({ clientIp: clientKey, area: 'support-checkout', retryAfterSeconds: 600 });
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const body = requestBody(req);
  if (body.fundingSource !== undefined && !isSupportFundingSource(body.fundingSource)) {
    return res.status(400).json({ error: 'Choose a payment method on the page.' });
  }
  const fundingSource = isSupportFundingSource(body.fundingSource) ? body.fundingSource : undefined;
  try {
    const request = await readSupportOrderRequest(req, deps.store);
    if (!request.ok) return res.status(request.status).json({ error: request.error });
    const { amountCents, recipient, kind, tier } = request.order;
    const reference = randomUUID();
    const origin = supportReturnOrigin(req);
    const order = await createSupportOrder(deps.paypal, {
      reference,
      amountCents,
      customId: recipientCustomId(recipient?.id ?? null),
      description: recipient ? `FlossChat ${supporterTier(tier ?? 'supporter').name} badge for ${recipient.login}` : 'Support FlossChat',
      returnUrl: `${origin}/support?paypal=return`,
      cancelUrl: `${origin}/support?paypal=cancel`,
      ...(fundingSource ? { fundingSource } : {}),
    });
    await deps.store.recordCreated({
      orderId: order.id,
      reference,
      recipient,
      kind,
      amountCents,
      ...(tier ? { tier } : {}),
    });
    return res.status(200).json({ approveUrl: order.approveUrl, orderId: order.id });
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(UNAVAILABLE);
    }
    return res.status(502).json({ ...UNAVAILABLE, ...devDetail(error) });
  }
}

/** Under `npm run dev` only: which step failed (PayPal status/issue code, never keys). */
function devDetail(error: unknown): { detail?: string } {
  if (process.env.NODE_ENV !== 'development') return {};
  if (error instanceof PayPalError) return { detail: `${error.message} (${error.status}${error.issue ? ` ${error.issue}` : ''})` };
  return { detail: error instanceof Error ? error.message.slice(0, 200) : 'unknown error' };
}
