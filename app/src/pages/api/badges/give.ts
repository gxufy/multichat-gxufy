/* Owner tools: give the FlossChat badge for free, for tests and giveaways.
 *
 * GET  /api/badges/give                       -> { given }      the badges given so far
 * POST /api/badges/give { login }             -> { given }      give it to a Twitch name
 * POST /api/badges/give { takeBack: twitchId } -> { takenBack }  take a given badge back
 *
 * Owner only; changes only from our own pages. The Twitch name is resolved
 * here to the account's immutable ID, exactly as a paid gift is, so the badge
 * lands on the account that really owns the name. Badges bought through
 * PayPal are never touched here: those go back only through a refund.
 * Overlays and /api/v1/badges pick the change up as they do a purchase.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { FixedProviderAdmissionError, fixedProviderClientKey } from '@/lib/server/fixedProviderProxy';
import { isOwner } from '@/lib/server/owner';
import { isSameOriginRequest, readSession } from '@/lib/server/session';
import { openSupporterStore } from '@/lib/server/supporterStore';
import { signInReady } from '@/lib/server/twitchOAuth';
import { normalizeSupportTwitchLogin } from '@/lib/supportPage';
import { resolveSupportTwitchUser } from '@/pages/api/twitch/support-user';

const giveLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 30 });

export function __resetGiveBadgeLimitForTests(): void {
  giveLimit.reset();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const store = openSupporterStore();
  if (!signInReady() || !store) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const user = readSession(req);
  if (!user || !isOwner(user.id)) return res.status(403).json({ error: 'Forbidden.' });

  if (req.method === 'GET') {
    try {
      return res.status(200).json({ given: await store.givenBadges() });
    } catch {
      return res.status(503).json({ error: 'Not available right now.' });
    }
  }

  if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Forbidden.' });
  if (!giveLimit.admit(resolveNodeClientKey(req))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many changes. Try again in a few minutes.' });
  }
  const body = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};

  if ('takeBack' in body) {
    const id = typeof body.takeBack === 'string' ? body.takeBack.trim() : '';
    if (!/^\d{1,20}$/.test(id)) return res.status(400).json({ error: 'Unknown account.' });
    try {
      return res.status(200).json({ takenBack: await store.takeBackGivenBadge(id) });
    } catch {
      return res.status(503).json({ error: 'Could not save. Try again.' });
    }
  }

  const login = normalizeSupportTwitchLogin(typeof body.login === 'string' ? body.login : '');
  if (!login) return res.status(400).json({ error: 'That is not a valid Twitch username.' });
  try {
    const account = await resolveSupportTwitchUser(login, fixedProviderClientKey(req));
    if (!account) return res.status(404).json({ error: 'No Twitch account found.' });
    const given = await store.giveBadge({ id: account.id, login: account.login, displayName: account.displayName });
    return res.status(200).json({ given });
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({ error: 'Twitch lookup is busy. Try again shortly.' });
    }
    return res.status(503).json({ error: 'Could not reach Twitch. Try again.' });
  }
}
