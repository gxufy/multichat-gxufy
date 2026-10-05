/* GET /api/twitch/oauth/start — begin Twitch OAuth authorization.
 *
 * Generates a cryptographically random state, stores it in an HttpOnly cookie
 * alongside the validated return destination, and redirects the browser to
 * Twitch's OAuth authorization endpoint using the Authorization Code Grant Flow.
 *
 * The client secret is intentionally omitted from this route. It is used only
 * server-side during the authorization-code exchange in the callback route.
 *
 * `returnTo` selects which generator the browser comes back to. It is matched
 * against an exact allowlist here and again in the callback, and it travels in an
 * HttpOnly cookie rather than through Twitch, so neither a crafted start URL nor
 * a crafted callback URL can redirect anywhere but an internal page. An absent or
 * refused value falls back to the canonical generator; it is never echoed back to
 * the client, so nothing unvalidated is reflected.
 *
 * Configuration is checked through lib/server/oauthConfig, which owns the whole
 * contract. A deployment missing any required variable refuses here — before the
 * user leaves the site — with the stable code `oauth_not_configured`. The absent
 * key *names* go to the server log; no environment value is logged or returned.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  buildOAuthCookies,
  generateOAuthState,
} from '../../../../lib/server/oauthCookies';
import {
  OAUTH_NOT_CONFIGURED,
  readTwitchOAuthStartConfig,
  reportTwitchOAuthMisconfiguration,
} from '../../../../lib/server/oauthConfig';
import { resolveReturnDestination } from '../../../../lib/oauthReturn';

const TWITCH_SCOPE = 'moderator:read:chat_messages moderation:read channel:read:vips channel:read:subscriptions';
const TWITCH_AUTHORIZE = 'https://id.twitch.tv/oauth2/authorize';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  /* The whole configuration contract, not only the two values this route
     dereferences. A deployment missing the encryption key or the Supabase
     credentials could otherwise send the user to Twitch, take their consent, and
     fail on the way back with nothing to show for it. */
  const configured = readTwitchOAuthStartConfig();

  if (!configured.ok) {
    /* Names of the absent keys to the server log, for the operator. Never a
       value, and never anything derived from one. */
    reportTwitchOAuthMisconfiguration('start', configured.missing);
    res.setHeader('Cache-Control', 'no-store');
    /* A stable non-secret code and nothing else — no variable names, no values,
       no hint about which half of the contract is unsatisfied. */
    res.status(500).json({ error: OAUTH_NOT_CONFIGURED });
    return;
  }

  const { clientId, redirectUri } = configured.config;

  const state = generateOAuthState();
  /* Anything not exactly an allowlisted internal path becomes the default. A
     repeated ?returnTo= arrives as an array and is refused by the same rule. */
  const returnTo = resolveReturnDestination(req.query['returnTo']);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', buildOAuthCookies(state, returnTo));

  const authorizationUrl = new URL(TWITCH_AUTHORIZE);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', TWITCH_SCOPE);
  authorizationUrl.searchParams.set('state', state);

  res.redirect(302, authorizationUrl.toString());
}
