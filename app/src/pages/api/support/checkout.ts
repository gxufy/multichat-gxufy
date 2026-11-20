/* POST /api/support/checkout { amountCents?, login?: string } | { amountCents?, forSelf: true } -> { approveUrl }
 *
 * Starts a one-time PayPal order of $5 or more (amountCents, whole cents,
 * $5–$500; $5 when left out). The amount is checked here and stored with the
 * order, and capture grants only that exact amount. The buyer must be
 * signed in with Twitch (owner rule: every payment tied to a known account).
 * The badge goes to:
 *  - forSelf: the signed-in Twitch account (read from the signed session
 *    cookie, never from the request body);
 *  - login: a gift, the Twitch name resolved here to its account ID;
 *  - neither: no badge, just support.
 * The browser is then sent to PayPal to approve.
 */
import { randomUUID } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FixedProviderAdmissionError,
  fixedProviderClientKey,
} from '@/lib/server/fixedProviderProxy';
import { queueAbuseRateLimit } from '@/lib/server/abuseDiscord';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { PayPalError, createSupportOrder } from '@/lib/server/paypal';
import { checkoutDeps, recipientCustomId, supportReturnOrigin } from '@/lib/server/supportCheckout';
import {
  SUPPORT_MIN_CENTS,
  normalizeSupportAmountCents,
  normalizeSupportTwitchLogin,
} from '@/lib/supportPage';
import { readSession } from '@/lib/server/session';
import { resolveSupportTwitchUser } from '@/pages/api/twitch/support-user';

const UNAVAILABLE = { error: 'Checkout is not available right now.' };

/* A real supporter starts a checkout a handful of times at most. */
const checkoutLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 8 });

export function __resetSupportCheckoutLimitForTests(): void {
  checkoutLimit.reset();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};
  const buyer = readSession(req);
  if (!buyer) return res.status(401).json({ error: 'Sign in with Twitch to support.' });
  const amountCents = body.amountCents === undefined ? SUPPORT_MIN_CENTS : normalizeSupportAmountCents(body.amountCents);
  if (amountCents === null) return res.status(400).json({ error: 'Choose an amount of $5 or more (up to $500).' });
  const rawLogin = typeof body.login === 'string' ? body.login.trim() : '';
  let recipient: { id: string; login: string; displayName: string } | null = null;
  let kind: 'self' | 'gift' | 'none' = 'none';
  try {
    if (body.forSelf === true) {
      kind = 'self';
      recipient = { id: buyer.id, login: buyer.login, displayName: buyer.displayName };
    } else if (rawLogin) {
      const login = normalizeSupportTwitchLogin(rawLogin);
      if (!login) return res.status(400).json({ error: 'That is not a valid Twitch username.' });
      const user = await resolveSupportTwitchUser(login, fixedProviderClientKey(req));
      if (!user) return res.status(404).json({ error: 'No Twitch account found.' });
      recipient = { id: user.id, login: user.login, displayName: user.displayName };
      kind = 'gift';
    }
    const reference = randomUUID();
    const origin = supportReturnOrigin(req);
    const order = await createSupportOrder(deps.paypal, {
      reference,
      amountCents,
      customId: recipientCustomId(recipient?.id ?? null),
      description: recipient ? `FlossChat badge for ${recipient.login}` : 'Support Gxufy',
      returnUrl: `${origin}/support?paypal=return`,
      cancelUrl: `${origin}/support?paypal=cancel`,
    });
    await deps.store.recordCreated({
      orderId: order.id,
      reference,
      recipient,
      kind,
      amountCents,
    });
    return res.status(200).json({ approveUrl: order.approveUrl });
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
