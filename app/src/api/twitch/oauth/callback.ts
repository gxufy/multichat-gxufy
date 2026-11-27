/* GET /api/twitch/oauth/callback?code=…&state=… (Twitch sends the visitor here).
 *
 * Checks the state cookie, swaps the code for the account (token revoked
 * straight after), signs the session cookie and returns to the page the
 * visitor came from. Any failure goes back with ?signin=failed, and one
 * line in the server log says which step failed (never the code or a key).
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { takeOAuthState, writeSession } from '@/lib/server/session';
import { callbackUrl, describeSignInError, signInWithCode, twitchOAuthConfig } from '@/lib/server/twitchOAuth';

const callbackLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 20 });

export function __resetCallbackLimitForTests(): void {
  callbackLimit.reset();
}

function logSignIn(outcome: string): void {
  console.warn(`[twitch sign-in] ${outcome}`);
}

function withFlag(path: string, flag: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}signin=${flag}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  const config = twitchOAuthConfig();
  if (!config) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!callbackLimit.admit(resolveNodeClientKey(req))) {
    res.setHeader('Retry-After', '600');
    res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
    return;
  }
  const checked = takeOAuthState(req, res, req.query.state);
  if (!checked) {
    logSignIn('failed: the sign-in state did not match (link expired or used twice, another browser, or the server restarted)');
    res.redirect(302, withFlag('/badges', 'failed'));
    return;
  }
  if (typeof req.query.error === 'string') {
    logSignIn(`cancelled on Twitch (${req.query.error.replace(/[^a-z_]/gi, '').slice(0, 40) || 'no reason given'})`);
    res.redirect(302, withFlag(checked.next, 'cancelled'));
    return;
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  let user: Awaited<ReturnType<typeof signInWithCode>>;
  try {
    user = await signInWithCode(config, code, callbackUrl(req));
  } catch (error) {
    logSignIn(`failed: ${describeSignInError(error)}`);
    res.redirect(302, withFlag(checked.next, 'failed'));
    return;
  }
  if (!writeSession(res, user)) {
    logSignIn('failed: could not save the session');
    res.redirect(302, withFlag(checked.next, 'failed'));
    return;
  }
  res.redirect(302, checked.next);
}
