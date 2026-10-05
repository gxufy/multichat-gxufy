/* Private server-side helper for validating a Twitch user access token
 * and identifying the Twitch account that authorized it.
 *
 * Sends the token to Twitch's /oauth2/validate endpoint, checks that
 * the returned client_id matches the configured client, and verifies
 * that the token holds the required scope.
 *
 * All environment variables are read lazily inside the function so a
 * missing variable does not break static builds.  Errors never expose
 * credentials, tokens, or environment values.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Validated Twitch user access token information.
 */
export type TwitchTokenValidation = {
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
  expiresIn: number;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REQUIRED_SCOPE = 'moderator:read:chat_messages';
const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERR = 'Twitch token validation failed.';

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse and strictly validate the JSON body returned by
 * {@link TWITCH_VALIDATE_URL}.
 *
 * Returns a camel-case object derived from Twitch's snake-case fields.
 * Throws on any missing, empty, or malformed field.
 */
function parseValidateResponse(
  body: unknown,
  expectedClientId: string,
): TwitchTokenValidation {
  if (
    !body ||
    typeof body !== 'object' ||
    !('client_id' in body) ||
    !('user_id' in body) ||
    !('login' in body) ||
    !('scopes' in body) ||
    !('expires_in' in body)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = body as Record<string, unknown>;

  const clientId = obj.client_id;
  const userId = obj.user_id;
  const login = obj.login;
  const scopes = obj.scopes;
  const expiresIn = obj.expires_in;

  /* client_id — non-empty string, must match configured value */
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new Error(GENERIC_ERR);
  }
  if (clientId !== expectedClientId) {
    throw new Error(GENERIC_ERR);
  }

  /* user_id — non-empty string */
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* login — non-empty string */
  if (typeof login !== 'string' || login.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* scopes — array containing only strings */
  if (!Array.isArray(scopes)) {
    throw new Error(GENERIC_ERR);
  }
  for (const item of scopes) {
    if (typeof item !== 'string') {
      throw new Error(GENERIC_ERR);
    }
  }
  if (!scopes.includes(REQUIRED_SCOPE)) {
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

  return {
    clientId,
    userId,
    login,
    scopes,
    expiresIn,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validate a Twitch user access token and return the account details.
 *
 * Sends a GET request to Twitch's /oauth2/validate endpoint.  The token
 * is passed only in the Authorization header — never in the URL, body,
 * logs, or errors.
 *
 * Requires the token to carry the scope `moderator:read:chat_messages`.
 * Throws a generic error on any failure (missing config, network,
 * timeout, wrong client ID, missing scope, malformed response).
 */
export async function validateTwitchAccessToken(
  accessToken: string,
): Promise<TwitchTokenValidation> {
  /* Reject non-string, empty, or whitespace-only tokens */
  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length === 0
  ) {
    throw new Error(GENERIC_ERR);
  }

  /* Lazily read client ID */
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId || clientId.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* AbortController for the 15-second timeout */
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TWITCH_VALIDATE_URL, {
      method: 'GET',
      headers: {
        Authorization: `OAuth ${accessToken}`,
      },
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

    return parseValidateResponse(parsed, clientId);
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
