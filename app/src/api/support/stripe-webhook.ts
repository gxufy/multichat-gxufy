/* POST /api/support/stripe-webhook
 *
 * Stripe's notices about a payment after the fact. Every event's
 * Stripe-Signature is checked against the raw body (STRIPE_WEBHOOK_SECRET)
 * before anything happens.
 *  - checkout.session.completed / async_payment_succeeded: grants, for buyers
 *    who never came back to the page or paid with a slower method. The
 *    session is re-read from Stripe and checked like the return page does.
 *  - charge.refunded / charge.dispute.created: the badge comes off (a refund
 *    or chargeback removes the badge, as the terms say).
 * Subscribe the endpoint to exactly those events.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { STRIPE_SESSION_ID_RE, getStripeCheckout, verifyStripeSignature } from '@/lib/server/stripe';
import { grantVerifiedCapture, stripeDeps, stripeSessionMatchesOrder } from '@/lib/server/supportCheckout';

/* The signature covers the exact bytes Stripe sent, so Next must not parse them. */
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 256 * 1024;
const GRANTING = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
const REVOKING = new Set(['charge.refunded', 'charge.dispute.created']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readRawBody(req: ApiRequest): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The Checkout Session a completed event is about. */
export function sessionIdFromEvent(event: unknown): string | null {
  const object = isRecord(event) && isRecord(event.data) && isRecord(event.data.object) ? event.data.object : null;
  return object && typeof object.id === 'string' && STRIPE_SESSION_ID_RE.test(object.id) ? object.id : null;
}

/** The payment a refund or dispute event is about. */
export function paymentIntentIdFromEvent(event: unknown): string | null {
  const object = isRecord(event) && isRecord(event.data) && isRecord(event.data.object) ? event.data.object : null;
  const intent = object?.payment_intent;
  return typeof intent === 'string' && /^pi_[A-Za-z0-9]{10,100}$/.test(intent) ? intent : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const deps = stripeDeps();
  if (!deps?.stripe.webhookSecret) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const raw = await readRawBody(req);
  const signature = typeof req.headers['stripe-signature'] === 'string' ? req.headers['stripe-signature'] : undefined;
  if (raw === null || !verifyStripeSignature(raw, signature, deps.stripe.webhookSecret)) {
    return res.status(400).json({ error: 'Bad signature.' });
  }
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Bad event.' });
  }
  const type = isRecord(event) && typeof event.type === 'string' ? event.type : '';
  /* A sandbox event never touches live orders, and the other way round. */
  if (isRecord(event) && (event.livemode === true) !== (deps.stripe.env === 'live')) {
    return res.status(200).json({ received: true });
  }
  try {
    if (GRANTING.has(type)) {
      const sessionId = sessionIdFromEvent(event);
      const stored = sessionId ? await deps.store.getOrder(sessionId) : null;
      if (sessionId && stored && stored.status === 'created') {
        const session = await getStripeCheckout(deps.stripe, sessionId);
        if (stripeSessionMatchesOrder(session, stored)) {
          await grantVerifiedCapture(deps, sessionId, session.paymentIntentId!);
        }
      }
    } else if (REVOKING.has(type)) {
      const paymentIntentId = paymentIntentIdFromEvent(event);
      if (paymentIntentId) await deps.store.markReversed(paymentIntentId);
    }
  } catch {
    /* Stripe retries a failed delivery; nothing was granted. */
    return res.status(502).json({ error: 'Try again.' });
  }
  return res.status(200).json({ received: true });
}
