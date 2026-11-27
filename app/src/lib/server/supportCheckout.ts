/* Shared checks for the supporter checkout routes. */
import type { ApiRequest } from './apiTypes';
import { CANONICAL_ORIGIN } from '@/lib/domains.mjs';
import { supportPageEnabled } from '@/lib/supportPage';
import { MIN_TIER_STEP_CENTS } from '@/lib/supporterTiers';
import { paypalConfig, type CaptureResult, type PayPalConfig } from './paypal';
import { stripeConfig, type StripeCheckoutResult, type StripeConfig } from './stripe';
import { sendPurchaseNotice } from './supporterDiscord';
import { openSupporterStore, type SupportOrderRecord, type SupporterStore } from './supporterStore';

/** PayPal's amount string for whole cents: 500 -> "5.00". */
export function paypalAmountValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type CheckoutDeps = { paypal: PayPalConfig; store: SupporterStore };

/** Everything needed to take a payment, or null (checkout stays off). */
export function checkoutDeps(env: NodeJS.ProcessEnv = process.env): CheckoutDeps | null {
  if (!supportPageEnabled(env.GXUFY_SUPPORT_PAGE_ENABLED, env.NODE_ENV)) return null;
  const paypal = paypalConfig(env);
  const store = openSupporterStore(env);
  return paypal && store ? { paypal, store } : null;
}

export type StripeDeps = { stripe: StripeConfig; store: SupporterStore };

/** Stripe Checkout next to PayPal, or null (the Stripe button stays hidden). */
export function stripeDeps(env: NodeJS.ProcessEnv = process.env): StripeDeps | null {
  if (!supportPageEnabled(env.GXUFY_SUPPORT_PAGE_ENABLED, env.NODE_ENV)) return null;
  const stripe = stripeConfig(env);
  if (!stripe) return null;
  const store = openSupporterStore(env);
  return store ? { stripe, store } : null;
}

/**
 * Only what Stripe itself reports can grant: a finished, paid Checkout
 * Session that this server created (same id and reference), for exactly the
 * amount set here, paid in full with any tax included (a tier step can be
 * under $5, never under $1), in USD, for the same recipient. Adaptive Pricing
 * shows buyers their own currency, but the session's amounts stay in USD.
 */
export function stripeSessionMatchesOrder(session: StripeCheckoutResult, stored: SupportOrderRecord): boolean {
  return session.id === stored.orderId
    && session.status === 'complete'
    && session.paymentStatus === 'paid'
    && Boolean(session.paymentIntentId)
    && Number.isInteger(stored.amountCents)
    && stored.amountCents >= MIN_TIER_STEP_CENTS
    && session.amountSubtotal === stored.amountCents
    && session.amountTotal === stored.amountCents
    && session.currency === 'usd'
    && session.clientReferenceId === stored.reference
    && session.metadata.reference === stored.reference
    && session.metadata.recipient_id === (stored.recipient?.id ?? '');
}

/**
 * Where PayPal sends the buyer back. Production: the fixed canonical origin.
 * `npm run dev`: the local host the request came in on (localhost only), so
 * sandbox testing works on any port. Never taken from other request headers.
 */
export function supportReturnOrigin(req: ApiRequest, nodeEnv = process.env.NODE_ENV): string {
  if (nodeEnv === 'development') {
    const host = typeof req.headers.host === 'string' ? req.headers.host : '';
    if (/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host)) return `http://${host}`;
  }
  return CANONICAL_ORIGIN;
}

export function recipientCustomId(recipientId: string | null): string {
  return recipientId ? `twitch:${recipientId}` : 'none';
}

/**
 * Only what PayPal itself reports can grant: a completed order and capture of
 * exactly the amount this server set for that order (never under $1), in USD,
 * for the same order reference and recipient we created.
 */
export function captureMatchesOrder(result: CaptureResult, stored: SupportOrderRecord): boolean {
  return result.orderStatus === 'COMPLETED'
    && result.captureStatus === 'COMPLETED'
    && Boolean(result.captureId)
    && Number.isInteger(stored.amountCents)
    && stored.amountCents >= MIN_TIER_STEP_CENTS
    && result.amountValue === paypalAmountValue(stored.amountCents)
    && result.currency === 'USD'
    && result.customId === recipientCustomId(stored.recipient?.id ?? null)
    && result.referenceId === stored.reference;
}

/**
 * Record a verified capture (idempotent) and send the owner's Discord notice
 * once per order, in the background. Shared by the return page and the
 * PAYMENT.CAPTURE.COMPLETED webhook, so whichever arrives first grants.
 */
export async function grantVerifiedCapture(
  deps: { store: SupporterStore },
  orderId: string,
  captureId: string,
  notify: (order: SupportOrderRecord) => Promise<unknown> = sendPurchaseNotice,
): Promise<SupportOrderRecord | null> {
  const completed = await deps.store.markCompleted(orderId, captureId);
  if (completed?.status === 'completed' && await deps.store.claimPurchaseNotice(orderId)) {
    void notify(completed).catch(() => undefined);
  }
  return completed;
}
