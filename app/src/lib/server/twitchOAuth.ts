/* Private server-side helper for exchanging a Twitch OAuth authorization
 * code for an access token and refresh token.
 *
 * All environment variables are read lazily inside the function so a
 * missing variable does not break static builds.  Errors never expose
 * credentials, codes, or environment values.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REQUIRED_SCOPES = ['moderator:read:chat_messages', 'moderation:read', 'channel:read:vips', 'channel:read:subscriptions'] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERR = 'Twitch authorization failed.';

/* ------------------------------------------------------------------ */
/* Lazy env cache                                                      */
/* ------------------------------------------------------------------ */

let cachedEnv: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null = null;

/**
 * Lazily read and cache the three required environment variables.
 *
 * Throws a generic error when any variable is absent or empty.
 *
 * The return type is non-nullable — the early throws cover the null case
 * so callers never see null, but we keep | null on the cached variable
 * so a missing env var does not break static builds.
 */
function getEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (cachedEnv) return cachedEnv;

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(GENERIC_ERR);
  }

  cachedEnv = { clientId, clientSecret, redirectUri };
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
  if (!REQUIRED_SCOPES.every((required) => scope.includes(required))) {
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
 * Token data returned by {@link exchangeTwitchAuthorizationCode}.
 */
export type TwitchTokenGrant = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
  tokenType: 'bearer';
};

/**
 * Exchange a Twitch OAuth authorization code for an access token
 * and refresh token.
 *
 * Sends a POST request to Twitch's token endpoint with the client
 * credentials, the authorization code, and the grant type.
 */
export async function exchangeTwitchAuthorizationCode(
  code: string,
): Promise<TwitchTokenGrant> {
  /* Validate input */
  if (typeof code !== 'string' || code.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  const { clientId, clientSecret, redirectUri } = getEnv();

  /* Build the form-encoded request body */
  const formBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
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
