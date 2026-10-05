/* GET /api/twitch/oauth/callback — finish Twitch OAuth authorization.
 *
 * Verifies the OAuth state parameter, exchanges the authorization code
 * for tokens, validates the access token against Twitch, retrieves the
 * user profile, cross-checks the profile against the validation result,
 * and persists the encrypted connection.
 *
 * All errors are generic — no tokens, codes, state, or Twitch responses
 * are ever logged or returned to the client.
 */

import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  STATE_COOKIE_NAME,
  buildClearOAuthCookies,
  readCookie,
  readReturnCookie,
} from '../../../../lib/server/oauthCookies';
import { resolveReturnDestination } from '../../../../lib/oauthReturn';
import {
  OAUTH_NOT_CONFIGURED,
  missingTwitchOAuthEnv,
  reportTwitchOAuthMisconfiguration,
} from '../../../../lib/server/oauthConfig';
import {
  exchangeTwitchAuthorizationCode,
} from '../../../../lib/server/twitchOAuth';
import {
  validateTwitchAccessToken,
} from '../../../../lib/server/twitchTokenValidation';
import {
  getTwitchUserProfile,
} from '../../../../lib/server/twitchUserProfile';
import {
  saveTwitchConnection,
} from '../../../../lib/server/twitchConnectionStore';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch connection failed.';
const AUTH_ERR = 'Twitch authorization was not completed.';

/* ------------------------------------------------------------------ */
/* Cookie helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Extract a single string value for a query parameter.
 *
 * Returns undefined when the key is absent, empty, or represented as
 * an array (repeated parameters are rejected as invalid).
 */
function extractQueryParam(
  req: NextApiRequest,
  key: string,
): string | undefined {
  const raw = req.query[key];
  if (Array.isArray(raw)) return undefined;
  if (typeof raw !== 'string') return undefined;
  if (raw.length === 0) return undefined;
  return raw;
}

/* ------------------------------------------------------------------ */
/* State validation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Validate the OAuth state cookie against the query `state` parameter
 * using constant-time comparison.
 *
 * Returns true only when both values are non-empty and match.
 */
function validateState(
  queryState: string,
  cookieState: string,
): boolean {
  const queryBuf = Buffer.from(queryState, 'utf-8');
  const cookieBuf = Buffer.from(cookieState, 'utf-8');

  if (queryBuf.length !== cookieBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(queryBuf, cookieBuf);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  /* --- Every response is uncacheable -------------------------------- */
  res.setHeader('Cache-Control', 'no-store');

  /* --- Method check ------------------------------------------------ */
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  /* --- Clear both temporary OAuth cookies --------------------------- */
  /* Set before any branch below, so every exit path clears them and a state
     value can never be replayed — including the refusal paths. */
  res.setHeader('Set-Cookie', buildClearOAuthCookies());

  /* --- Resolve the return destination -------------------------------- */
  /* From the HttpOnly cookie only, never from this request's query string, and
     revalidated against the allowlist in case the cookie was tampered with.
     Resolved here so the failure paths below cannot skip validation. */
  const returnTo = resolveReturnDestination(readReturnCookie(req.headers.cookie));

  /* --- Reject array-valued parameters before extracting query values */
  if (
    Array.isArray(req.query['code']) ||
    Array.isArray(req.query['state']) ||
    Array.isArray(req.query['error']) ||
    Array.isArray(req.query['error_description'])
  ) {
    res.status(400).json({ error: AUTH_ERR });
    return;
  }

  /* --- Read and validate query parameters --------------------------- */
  const code = extractQueryParam(req, 'code');
  const state = extractQueryParam(req, 'state');
  const queryError = extractQueryParam(req, 'error');
  /* error_description is accepted but NEVER returned, logged, or exposed */

  /* Twitch returned an error (key present), or code/state are
     missing/invalid/arrays ------------------------------------ */
  const hasErrorKey = Object.prototype.hasOwnProperty.call(req.query, 'error');

  if (
    hasErrorKey ||
    queryError !== undefined ||
    code === undefined ||
    state === undefined
  ) {
    res.status(400).json({ error: AUTH_ERR });
    return;
  }

  /* --- Require a non-empty state cookie ----------------------------- */
  const rawCookie = req.headers.cookie;
  if (!rawCookie || rawCookie.length === 0) {
    res.status(400).json({ error: AUTH_ERR });
    return;
  }

  /* Parse the cookie to extract the OAuth state value */
  const cookieState = readCookie(rawCookie, STATE_COOKIE_NAME);

  if (!cookieState || cookieState.length === 0) {
    res.status(400).json({ error: AUTH_ERR });
    return;
  }

  /* --- Constant-time state comparison -------------------------------- */
  if (!validateState(state, cookieState)) {
    res.status(400).json({ error: AUTH_ERR });
    return;
  }

  /* --- Configuration, diagnosed rather than discovered --------------- */
  /* Checked after the state proof, so an unauthenticated request cannot use this
     route to probe whether the deployment is configured, and before the exchange,
     so an operator reading the log sees the missing key names instead of an
     opaque helper failure. The client still learns only a stable code. */
  const missing = missingTwitchOAuthEnv();
  if (missing.length > 0) {
    reportTwitchOAuthMisconfiguration('callback', missing);
    res.status(500).json({ error: OAUTH_NOT_CONFIGURED });
    return;
  }

  /* --- Exchange code, validate, fetch profile, store ----------------- */
  try {
    const tokenGrant = await exchangeTwitchAuthorizationCode(code);
    const validation = await validateTwitchAccessToken(tokenGrant.accessToken);
    const profile = await getTwitchUserProfile(
      tokenGrant.accessToken,
      validation.userId,
    );

    /* Cross-check profile against validation result */
    if (profile.userId !== validation.userId) {
      throw new Error(GENERIC_ERR);
    }
    if (profile.login !== validation.login) {
      throw new Error(GENERIC_ERR);
    }

    const saved = await saveTwitchConnection({
      twitchUserId: validation.userId,
      twitchLogin: validation.login,
      twitchDisplayName: profile.displayName,
      accessToken: tokenGrant.accessToken,
      refreshToken: tokenGrant.refreshToken,
      expiresIn: validation.expiresIn,
      scopes: validation.scopes,
    });

    const fragment = new URLSearchParams({
      twitchConnectionId: saved.connectionId,
      twitch: validation.login,
    }).toString();

    /* Fragment, not query: the connection id must not reach a server log, a
       Referer header, or the address bar's shareable part. `returnTo` is an
       allowlisted path, so this is a same-origin relative redirect. */
    res.redirect(302, `${returnTo}#${fragment}`);
    return;
  } catch {
    /* All helper, configuration, encryption, and database errors */
    res.status(500).json({ error: GENERIC_ERR });
  }
}
