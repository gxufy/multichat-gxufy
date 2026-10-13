/* Private server-side helper for exchanging a Twitch refresh token for
 * a new access token and refresh token.
 *
 * All environment variables are read lazily inside the function so a
 * missing variable does not break static builds.  Errors never expose
 * credentials, tokens, or environment values.
 */

import type { TwitchTokenGrant } from './twitchOAuth';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REQUIRED_SCOPE = 'moderator:read:chat_messages';
const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERR = 'Twitch token refresh failed.';

/* ------------------------------------------------------------------ */
/* Lazy env cache                                                      */
/* ------------------------------------------------------------------ */

let cachedEnv: {
  clientId: string;
  clientSecret: string;
} | null = null;

/**
 * Lazily read and cache the two required environment variables.
 *
 * Throws a generic error when any variable is absent or empty.
 */
function getEnv(): { clientId: string; clientSecret: string } {
  if (cachedEnv) return cachedEnv;

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(GENERIC_ERR);
  }

  cachedEnv = { clientId, clientSecret };
  return cachedEnv;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Validate that the response contains every required field in the
 * shape Twitch returns, then return a camelCase token object.
 */
function parseTokenResponse(body: unknown): TwitchTokenGrant {
  if (
    !body ||
    typeof body !== 'object' ||
    !('access_token' in body) ||
    !('refresh_token' in body) ||
    !('expires_in' in body) ||
    !('scope' in body) ||
    !('token_type' in body)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = body as Record<string, unknown>;

  const accessToken = obj.access_token;
  const refreshToken = obj.refresh_token;
  const expiresIn = obj.expires_in;
  const scope = obj.scope;
  const tokenType = obj.token_type;

  /* access_token — non-empty string */
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* refresh_token — non-empty string */
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* expires_in — positive finite integer */
  if (
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn !== Math.floor(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error(GENERIC_ERR);
  }

  /* scope — array of strings */
  if (!Array.isArray(scope)) {
    throw new Error(GENERIC_ERR);
  }
  for (const item of scope) {
    if (typeof item !== 'string') {
      throw new Error(GENERIC_ERR);
    }
  }
  if (!scope.includes(REQUIRED_SCOPE)) {
    throw new Error(GENERIC_ERR);
  }

  /* token_type — 'bearer', case-insensitive */
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    throw new Error(GENERIC_ERR);
  }

  return {
    accessToken,
    refreshToken,
    expiresIn,
    scopes: scope,
    tokenType: 'bearer',
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Exchange a Twitch refresh token for a new access token and refresh token.
 *
 * Sends a POST request to Twitch's token endpoint with the client
 * credentials and the refresh token.
 */
export async function refreshTwitchAccessToken(
  refreshToken: string,
): Promise<TwitchTokenGrant> {
  /* Validate input */
  if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  const { clientId, clientSecret } = getEnv();

  /* Build the form-encoded request body */
  const formBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  /* AbortController for the 15-second timeout */
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
      signal: controller.signal,
    });

    /* Parse JSON defensively */
    let parsed: unknown;
    try {
      const rawText = await response.text();
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new Error(GENERIC_ERR);
    }

    if (!response.ok) {
      throw new Error(GENERIC_ERR);
    }

    return parseTokenResponse(parsed);
  } catch (err) {
    /* Mask all errors — network, timeout, parse, validation */
    if (err instanceof Error && err.message === GENERIC_ERR) {
      throw err;
    }
    throw new Error(GENERIC_ERR);
  } finally {
    clearTimeout(timeoutId);
  }
}
