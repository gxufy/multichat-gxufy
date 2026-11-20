/* GET /api/twitch/oauth/callback?code=…&state=… (Twitch sends the visitor here).
 *
 * Checks the state cookie, swaps the code for the account (token revoked
 * straight after), signs the session cookie and returns to the page the
 * visitor came from. Any failure goes back with ?signin=failed.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { takeOAuthState, writeSession } from '@/lib/server/session';
import { callbackUrl, signInWithCode, twitchOAuthConfig } from '@/lib/server/twitchOAuth';

const callbackLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 20 });

export function __resetCallbackLimitForTests(): void {
  callbackLimit.reset();
}

function withFlag(path: string, flag: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}signin=${flag}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const config = twitchOAuthConfig();
  if (!config) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!callbackLimit.admit(resolveNodeClientKey(req))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
  }
  const checked = takeOAuthState(req, res, req.query.state);
  if (!checked) return res.redirect(302, withFlag('/badges', 'failed'));
  if (typeof req.query.error === 'string') return res.redirect(302, withFlag(checked.next, 'cancelled'));
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  try {
    const user = await signInWithCode(config, code, callbackUrl(req));
    if (!writeSession(res, user)) return res.redirect(302, withFlag(checked.next, 'failed'));
    return res.redirect(302, checked.next);
  } catch {
    return res.redirect(302, withFlag(checked.next, 'failed'));
  }
}
