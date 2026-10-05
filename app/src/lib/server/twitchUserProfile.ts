/* Private server-side helper for retrieving the Twitch profile associated
 * with a validated user access token.
 *
 * Sends the token to Twitch's /helix/users endpoint, verifies the
 * returned user ID matches the expected account, and returns a trimmed
 * profile object.
 *
 * All environment variables are read lazily inside the function so a
 * missing variable does not break static builds.  Errors never expose
 * credentials, tokens, or environment values.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Trimmed Twitch user profile returned by {@link getTwitchUserProfile}.
 */
export type TwitchUserProfile = {
  userId: string;
  login: string;
  displayName: string;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_HELIX_USERS_URL = 'https://api.twitch.tv/helix/users';
const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERR = 'Twitch profile lookup failed.';

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse and strictly validate the JSON body returned by
 * {@link TWITCH_HELIX_USERS_URL}.
 *
 * Requires exactly one user object whose id matches expectedUserId,
 * then returns a camel-case profile object.
 */
function parseUserProfile(
  body: unknown,
  expectedUserId: string,
): TwitchUserProfile {
  /* Must be an object with a data array */
  if (
    !body ||
    typeof body !== 'object' ||
    !('data' in body)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = body as Record<string, unknown>;
  const data = obj.data;

  /* data must be an array of exactly one element */
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(GENERIC_ERR);
  }

  const user = data[0];

  /* user must be a non-null object */
  if (!user || typeof user !== 'object') {
    throw new Error(GENERIC_ERR);
  }

  /* id — non-empty string, must match expectedUserId */
  const id = (user as Record<string, unknown>).id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(GENERIC_ERR);
  }
  if (id !== expectedUserId) {
    throw new Error(GENERIC_ERR);
  }

  /* login — non-empty string */
  const login = (user as Record<string, unknown>).login;
  if (typeof login !== 'string' || login.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* display_name — non-empty string */
  const displayName = (user as Record<string, unknown>).display_name;
  if (typeof displayName !== 'string' || displayName.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  return { userId: id, login, displayName };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Retrieve the Twitch profile for the account identified by
 * {@link accessToken}.
 *
 * Sends a GET request to Twitch's /helix/users endpoint.  The access
 * token is passed only in the Authorization header — never in the URL,
 * body, logs, or errors.
 *
 * Requires the returned user id to exactly match {@link expectedUserId}.
 * Throws a generic error on any failure (bad input, missing config,
 * network, timeout, wrong user id, malformed response).
 */
export async function getTwitchUserProfile(
  accessToken: string,
  expectedUserId: string,
): Promise<TwitchUserProfile> {
  /* Reject non-string, empty, or whitespace-only inputs */
  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length === 0
  ) {
    throw new Error(GENERIC_ERR);
  }

  if (
    typeof expectedUserId !== 'string' ||
    expectedUserId.trim().length === 0
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
    const response = await fetch(TWITCH_HELIX_USERS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId,
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

    return parseUserProfile(parsed, expectedUserId);
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
