/* GET /api/auth/twitch/login?next=/badges -> 302 to Twitch's sign-in page.
 *
 * Sets a short-lived signed state cookie (CSRF protection for the callback).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { CANONICAL_ORIGIN } from '@/lib/domains.mjs';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { safeNextPath, writeOAuthState } from '@/lib/server/session';
import { authorizeUrl, callbackUrl, twitchOAuthConfig } from '@/lib/server/twitchOAuth';

const loginLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 20 });

export function __resetSignInLimitForTests(): void {
  loginLimit.reset();
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  const config = twitchOAuthConfig();
  if (!config) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!loginLimit.admit(resolveNodeClientKey(req))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
  }
  const next = safeNextPath(req.query.next);
  /* Twitch always returns to the canonical origin, and cookies are per host,
     so sign-in must start there too (e.g. from the legacy domain). */
  const canonicalHost = new URL(CANONICAL_ORIGIN).host;
  if (process.env.NODE_ENV !== 'development' && req.headers.host !== canonicalHost) {
    return res.redirect(302, `${CANONICAL_ORIGIN}/api/auth/twitch/login?next=${encodeURIComponent(next)}`);
  }
  const state = writeOAuthState(res, next);
  if (!state) return res.status(404).json({ error: 'Not found.' });
  res.redirect(302, authorizeUrl(config, callbackUrl(req), state));
}
