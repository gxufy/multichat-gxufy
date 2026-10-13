/** Server-only helper: resolve one Twitch channel login to its canonical
 * Twitch user information using an existing access token.
 *
 * Sends a GET request to Twitch's /helix/users endpoint and returns the
 * matching user (or null when none is found).
 *
 * All environment variables are read lazily inside the function so a
 * missing variable does not break static builds.  Errors never expose
 * credentials, tokens, or environment values.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Canonical Twitch user information resolved from a channel login.
 */
export type TwitchUserLookup = {
  userId: string;
  login: string;
  displayName: string;
};

/**
 * Result of looking up a Twitch user by login.
 */
export type TwitchUserLookupResult =
  | {
      status: 'ok';
      user: TwitchUserLookup | null;
    }
  | {
      status: 'unauthorized';
    };

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_HELIX_USERS_URL = 'https://api.twitch.tv/helix/users';
const REQUEST_TIMEOUT_MS = 15_000;
const GENERIC_ERR = 'Twitch user lookup failed.';

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse and strictly validate the JSON body returned by
 * {@link TWITCH_HELIX_USERS_URL}.
 *
 * Requires a non-null object with a data array, then accepts only:
 *   - an empty array (user is null)
 *   - a data array containing exactly one non-null, non-array object
 *     with non-empty string fields id, login, and display_name, where
 *     id is digits-only and the lowercase login matches the requested login.
 */
function parseUserLookup(
  body: unknown,
  normalizedLogin: string,
): TwitchUserLookupResult {
  /* Must be a non-null object with a data array */
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    !('data' in body)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = body as Record<string, unknown>;
  const data = obj.data;

  if (!Array.isArray(data)) {
    throw new Error(GENERIC_ERR);
  }

  /* Empty array — no user found */
  if (data.length === 0) {
    return { status: 'ok', user: null };
  }

  /* Must contain exactly one item */
  if (data.length !== 1) {
    throw new Error(GENERIC_ERR);
  }

  const item = data[0];

  /* Must be a non-null, non-array object */
  if (
    item === null ||
    typeof item !== 'object' ||
    Array.isArray(item)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const raw = item as Record<string, unknown>;

  /* id — non-empty string of decimal digits only, no whitespace */
  const id = raw.id;
  if (typeof id !== 'string' || id.trim().length === 0 || !/^\d+$/.test(id)) {
    throw new Error(GENERIC_ERR);
  }

  /* login — non-empty string, lowercase must match requested login */
  const login = raw.login;
  if (typeof login !== 'string' || login.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }
  if (login.toLowerCase() !== normalizedLogin) {
    throw new Error(GENERIC_ERR);
  }

  /* display_name — non-empty string, no whitespace-only */
  const displayName = raw.display_name;
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  return {
    status: 'ok',
    user: {
      userId: id,
      login: login,
      displayName: displayName,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve one Twitch channel login to its canonical Twitch user
 * information using an existing access token.
 *
 * Sends a GET request to Twitch's /helix/users endpoint.  The access
 * token is passed only in the Authorization header — never in the URL,
 * body, logs, or errors.
 *
 * Returns a result with status `'ok'` and the resolved user (or `null`
 * when not found), or status `'unauthorized'` when Twitch rejects
 * the access token (HTTP 401).
 *
 * Throws a generic error on any other failure (bad input, missing
 * configuration, network, timeout, wrong HTTP status, malformed
 * response, or invalid response data).
 */
export async function fetchTwitchUserByLogin(
  accessToken: string,
  login: string,
): Promise<TwitchUserLookupResult> {
  /* --- Input validation --- */

  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length === 0
  ) {
    throw new Error(GENERIC_ERR);
  }

  if (typeof login !== 'string' || login.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* --- Normalize login (trim + lowercase) --- */

  const normalizedLogin = login.trim().toLowerCase();

  /* login must be lowercase ASCII letters, decimal digits, or underscores, max 100 */
  if (normalizedLogin.length > 100 || !/^[a-z0-9_]+$/.test(normalizedLogin)) {
    throw new Error(GENERIC_ERR);
  }

  /* --- Lazily read client ID --- */

  const clientId = process.env.TWITCH_CLIENT_ID;
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* --- Build URL with searchParams --- */

  const url = new URL(TWITCH_HELIX_USERS_URL);
  url.searchParams.set('login', normalizedLogin);

  /* --- Request with timeout --- */

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId,
      },
      signal: controller.signal,
    });

    /* Handle HTTP 401 before parsing the body */
    if (response.status === 401) {
      return { status: 'unauthorized' };
    }

    if (!response.ok) {
      throw new Error(GENERIC_ERR);
    }

    /* Parse JSON defensively */
    const body: unknown = await response.json();

    return parseUserLookup(body, normalizedLogin);
  } catch {
    throw new Error(GENERIC_ERR);
  } finally {
    clearTimeout(timeoutId);
  }
}
