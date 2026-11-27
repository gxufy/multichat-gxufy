/* POST /api/support/paypal-webhook
 *
 * PayPal's notices about a payment after the fact. Every event is checked with
 * PayPal (verify-webhook-signature, needs PAYPAL_WEBHOOK_ID) before anything
 * happens. A refunded, reversed or denied capture takes the badge back. A
 * completed capture grants it — for payments that were PENDING when the buyer
 * came back (e.g. bank-funded or under review) and clear later. The order is
 * then re-read from PayPal and checked exactly like the return page does.
 *
 * Nothing depends on these notices arriving: the server also asks PayPal
 * itself how its payments stand (lib/server/paypalRecheck).
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { PAYPAL_ORDER_ID_RE, getSupportOrder, verifyPayPalWebhook } from '@/lib/server/paypal';
import { captureMatchesOrder, checkoutDeps, grantVerifiedCapture } from '@/lib/server/supportCheckout';

const REVOKING = new Set(['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED', 'PAYMENT.CAPTURE.DENIED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The order a PAYMENT.CAPTURE.COMPLETED event belongs to. */
export function orderIdFromCaptureEvent(event: unknown): string | null {
  if (!isRecord(event) || !isRecord(event.resource)) return null;
  const supplementary = isRecord(event.resource.supplementary_data) ? event.resource.supplementary_data : {};
  const related = isRecord(supplementary.related_ids) ? supplementary.related_ids : {};
  return typeof related.order_id === 'string' && PAYPAL_ORDER_ID_RE.test(related.order_id) ? related.order_id : null;
}

/** The capture an event is about (refund events point "up" to their capture). */
export function captureIdFromEvent(event: unknown): string | null {
  if (!isRecord(event) || !isRecord(event.resource)) return null;
  const resource = event.resource;
  if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    const links = Array.isArray(resource.links) ? resource.links : [];
    for (const link of links) {
      if (!isRecord(link) || link.rel !== 'up' || typeof link.href !== 'string') continue;
      const match = /\/v2\/payments\/captures\/([A-Z0-9]{10,40})$/.exec(link.href);
      if (match) return match[1]!;
    }
    return null;
  }
  return typeof resource.id === 'string' && /^[A-Z0-9]{10,40}$/.test(resource.id) ? resource.id : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const deps = checkoutDeps();
  if (!deps || !deps.paypal.webhookId) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const event = req.body;
  try {
    if (!await verifyPayPalWebhook(deps.paypal, req.headers, event)) {
      return res.status(400).json({ error: 'Invalid webhook.' });
    }
  } catch {
    return res.status(502).json({ error: 'Could not verify webhook.' });
  }
  if (isRecord(event) && typeof event.event_type === 'string' && REVOKING.has(event.event_type)) {
    const captureId = captureIdFromEvent(event);
    if (captureId) await deps.store.markReversed(captureId);
  }
  if (isRecord(event) && event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const captureId = captureIdFromEvent(event);
    const orderId = orderIdFromCaptureEvent(event);
    const stored = orderId ? await deps.store.getOrder(orderId) : null;
    /* Only orders this server created and has not settled yet. */
    if (captureId && orderId && stored?.status === 'created') {
      try {
        const result = await getSupportOrder(deps.paypal, orderId);
        if (result.captureId === captureId && captureMatchesOrder(result, stored)) {
          await grantVerifiedCapture(deps, orderId, captureId);
        }
      } catch {
        /* PayPal retries the webhook when it doesn't get a 2xx. */
        return res.status(502).json({ error: 'Could not confirm the payment.' });
      }
    }
  }
  return res.status(200).json({ ok: true });
}
