/* Shared checks for the supporter checkout routes ($5 or more). */
import type { NextApiRequest } from 'next';
import { CANONICAL_ORIGIN } from '@/lib/domains.mjs';
import { SUPPORT_MIN_CENTS, supportPageEnabled } from '@/lib/supportPage';
import { paypalConfig, type CaptureResult, type PayPalConfig } from './paypal';
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

/**
 * Where PayPal sends the buyer back. Production: the fixed canonical origin.
 * `npm run dev`: the local host the request came in on (localhost only), so
 * sandbox testing works on any port. Never taken from other request headers.
 */
export function supportReturnOrigin(req: NextApiRequest, nodeEnv = process.env.NODE_ENV): string {
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
 * exactly the amount this server set for that order (never under $5), in USD,
 * for the same order reference and recipient we created.
 */
export function captureMatchesOrder(result: CaptureResult, stored: SupportOrderRecord): boolean {
  return result.orderStatus === 'COMPLETED'
    && result.captureStatus === 'COMPLETED'
    && Boolean(result.captureId)
    && Number.isInteger(stored.amountCents)
    && stored.amountCents >= SUPPORT_MIN_CENTS
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
  deps: CheckoutDeps,
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
