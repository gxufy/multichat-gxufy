/* POST /api/support/capture { orderId } -> { status, recipient }
 *
 * Called when PayPal sends the buyer back. Captures the order and only grants
 * the badge when PayPal itself says: completed, exactly the amount we set
 * for this order (never under $5), USD, and the same order/recipient we created. Safe to call twice (same capture id).
 * The owner's Discord purchase notice goes out once per order, in the
 * background, so a slow Discord never delays the buyer.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { PAYPAL_ORDER_ID_RE, PayPalError, captureSupportOrder } from '@/lib/server/paypal';
import { captureMatchesOrder, checkoutDeps, grantVerifiedCapture } from '@/lib/server/supportCheckout';

const FAILED = { error: 'We could not confirm this payment.' };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const deps = checkoutDeps();
  if (!deps) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  if (!PAYPAL_ORDER_ID_RE.test(orderId)) return res.status(400).json(FAILED);

  const stored = await deps.store.getOrder(orderId);
  /* Only orders this server created can ever grant anything. */
  if (!stored) return res.status(404).json(FAILED);
  const recipient = stored.recipient
    ? { login: stored.recipient.login, displayName: stored.recipient.displayName }
    : null;
  if (stored.status === 'completed') return res.status(200).json({ status: 'completed', recipient });
  if (stored.status === 'reversed') return res.status(409).json(FAILED);

  try {
    const result = await captureSupportOrder(deps.paypal, orderId);
    if (result.captureStatus === 'PENDING') {
      return res.status(202).json({ status: 'pending', recipient });
    }
    if (!captureMatchesOrder(result, stored)) return res.status(409).json(FAILED);
    const completed = await grantVerifiedCapture(deps, orderId, result.captureId!);
    if (!completed) return res.status(409).json(FAILED);
    return res.status(200).json({ status: 'completed', recipient });
  } catch (error) {
    return res.status(502).json({ ...FAILED, ...devDetail(error) });
  }
}

/** Under `npm run dev` only: which step failed (PayPal status/issue code, never keys). */
function devDetail(error: unknown): { detail?: string } {
  if (process.env.NODE_ENV !== 'development') return {};
  if (error instanceof PayPalError) return { detail: `${error.message} (${error.status}${error.issue ? ` ${error.issue}` : ''})` };
  return { detail: error instanceof Error ? error.message.slice(0, 200) : 'unknown error' };
}
