/*
 * "Sign in with Twitch" (OAuth authorization code flow, no scopes).
 *
 * With no scopes Twitch only tells us which account signed in. The access
 * token is used once to read that account and is then revoked; nothing from
 * Twitch is stored except the account id/login/name/avatar in the session.
 *
 * Needs TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET (already used for app access
 * tokens) and the redirect URL registered on the Twitch app:
 *   https://flosschat.app/api/twitch/oauth/callback      (production)
 *   http://localhost:3000/api/twitch/oauth/callback      (npm run dev)
 */
import type { NextApiRequest } from 'next';
import { supportPageEnabled } from '@/lib/supportPage';
import { supportReturnOrigin } from './supportCheckout';
import { sessionSecret, type SessionUser } from './session';

export const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
export const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';
/* Already registered on the Twitch app (kept from the earlier Twitch connection). */
export const CALLBACK_PATH = '/api/twitch/oauth/callback';
const REQUEST_TIMEOUT_MS = 8_000;

export type TwitchOAuthConfig = { clientId: string; clientSecret: string };

export class TwitchOAuthError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = 'TwitchOAuthError';
  }
}

/** Sign-in is on with the support page, the Twitch app keys and a session key. */
export function twitchOAuthConfig(env: NodeJS.ProcessEnv = process.env): TwitchOAuthConfig | null {
  if (!supportPageEnabled(env.GXUFY_SUPPORT_PAGE_ENABLED, env.NODE_ENV)) return null;
  const clientId = env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = env.TWITCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !sessionSecret(env)) return null;
  return { clientId, clientSecret };
}

export function signInReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return twitchOAuthConfig(env) !== null;
}

/** Same origin rules as the PayPal return URL: canonical, or localhost in dev. */
export function callbackUrl(req: NextApiRequest, nodeEnv = process.env.NODE_ENV): string {
  return `${supportReturnOrigin(req, nodeEnv)}${CALLBACK_PATH}`;
}

export function authorizeUrl(config: TwitchOAuthConfig, redirectUri: string, state: string): string {
  const url = new URL(TWITCH_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', '');
  url.searchParams.set('state', state);
  return url.toString();
}

async function request(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  return fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** Code -> account. The token never leaves this function. */
export async function signInWithCode(
  config: TwitchOAuthConfig,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<SessionUser> {
  if (!/^[A-Za-z0-9]{10,100}$/.test(code)) throw new TwitchOAuthError('bad code');
  const tokenResponse = await request(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  }, fetcher);
  if (!tokenResponse.ok) throw new TwitchOAuthError('token exchange failed', tokenResponse.status);
  const tokenBody = await tokenResponse.json().catch(() => null) as { access_token?: unknown } | null;
  const token = typeof tokenBody?.access_token === 'string' ? tokenBody.access_token : '';
  if (!token) throw new TwitchOAuthError('no access token');

  try {
    const userResponse = await request(TWITCH_USERS_URL, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': config.clientId },
    }, fetcher);
    if (!userResponse.ok) throw new TwitchOAuthError('user lookup failed', userResponse.status);
    const body = await userResponse.json().catch(() => null) as { data?: unknown } | null;
    const user = Array.isArray(body?.data) ? body.data[0] as Record<string, unknown> | undefined : undefined;
    const id = typeof user?.id === 'string' && /^\d{1,20}$/.test(user.id) ? user.id : '';
    const login = typeof user?.login === 'string' && /^[a-z0-9_]{1,25}$/.test(user.login) ? user.login : '';
    if (!id || !login) throw new TwitchOAuthError('unexpected user response');
    const displayName = typeof user?.display_name === 'string' && user.display_name.trim()
      ? user.display_name.trim().slice(0, 64)
      : login;
    const avatar = typeof user?.profile_image_url === 'string' ? user.profile_image_url : '';
    return {
      id,
      login,
      displayName,
      ...(/^https:\/\/static-cdn\.jtvnw\.net\//.test(avatar) ? { avatarUrl: avatar } : {}),
    };
  } finally {
    /* Best effort: we never need this token again. */
    void request(TWITCH_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, token }).toString(),
    }, fetcher).catch(() => undefined);
  }
}
