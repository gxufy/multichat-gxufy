/* Private server-only helper: load a stored Twitch connection, look up one
 * channel login, and refresh tokens once when Twitch returns HTTP 401.
 *
 * All failures surface as a single opaque Error so tokens, connection IDs,
 * environment values, and internal details are never leaked.
 */

import { getTwitchConnection } from './twitchConnectionReader';
import { refreshStoredTwitchConnection } from './twitchConnectionRefresher';
import { fetchTwitchUserByLogin } from './twitchUserLookup';
import type {
  TwitchUserLookup,
  TwitchUserLookupResult,
} from './twitchUserLookup';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch stored user lookup failed.';

/** Strict UUID regex — matches the standard 8-4-4-4-12 format. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Validate that `connectionId` is a non-empty valid UUID string.
 *
 * Does not trim the value.
 */
function validateConnectionId(connectionId: string): void {
  if (typeof connectionId !== 'string' || connectionId.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }
  if (!UUID_RE.test(connectionId)) {
    throw new Error(GENERIC_ERR);
  }
}

/**
 * Validate that `login` is a non-empty valid Twitch login string.
 *
 * After trimming and lowercasing, must contain only ASCII lowercase letters,
 * decimal digits, or underscores and be no longer than 100 characters.
 *
 * Returns the normalized login.
 */
function validateLogin(login: string): string {
  if (typeof login !== 'string' || login.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }
  const normalizedLogin = login.trim().toLowerCase();
  if (normalizedLogin.length > 100 || !/^[a-z0-9_]+$/.test(normalizedLogin)) {
    throw new Error(GENERIC_ERR);
  }
  return normalizedLogin;
}

/**
 * Validate the stored connection returned by getTwitchConnection.
 *
 * Requires a non-null object (not an array) with all required fields
 * present, non-empty, and matching the expected values.
 */
function validateStoredConnection(
  conn: unknown,
  expectedId: string,
): {
  connectionId: string;
  twitchUserId: string;
  twitchLogin: string;
  accessToken: string;
  refreshToken: string;
} {
  if (
    typeof conn !== 'object' ||
    conn === null ||
    Array.isArray(conn)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = conn as Record<string, unknown>;

  // connectionId must exactly match the requested ID.
  if (
    typeof obj.connectionId !== 'string' ||
    obj.connectionId !== expectedId
  ) {
    throw new Error(GENERIC_ERR);
  }

  // twitchUserId must contain only decimal digits.
  const twitchUserId = obj.twitchUserId;
  if (typeof twitchUserId !== 'string' || !/^\d+$/.test(twitchUserId)) {
    throw new Error(GENERIC_ERR);
  }

  // twitchLogin must be a non-empty, non-whitespace-only string.
  const twitchLogin = obj.twitchLogin;
  if (typeof twitchLogin !== 'string' || twitchLogin.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  // accessToken must be a non-empty, non-whitespace-only string.
  const accessToken = obj.accessToken;
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  // refreshToken must be a non-empty, non-whitespace-only string.
  const refreshToken = obj.refreshToken;
  if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  return {
    connectionId: obj.connectionId,
    twitchUserId,
    twitchLogin,
    accessToken,
    refreshToken,
  };
}

/**
 * Validate a TwitchUserLookupResult at runtime before reading its status.
 *
 * Accepts exactly:
 *   { status: 'ok', user: null }
 *   { status: 'ok', user: <non-null non-array object> }
 *   { status: 'unauthorized' }
 *
 * Rejects malformed objects, missing properties, arrays, null values,
 * unknown statuses, and any other shape.
 */
function validateLookupResult(
  result: unknown,
): TwitchUserLookupResult {
  // Must be a non-null object, not an array.
  if (
    typeof result !== 'object' ||
    result === null ||
    Array.isArray(result)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = result as Record<string, unknown>;

  // status must exist and be a string.
  const status = obj.status;
  if (typeof status !== 'string') {
    throw new Error(GENERIC_ERR);
  }

  // Handle 'ok' — user must exist.
  if (status === 'ok') {
    const user = obj.user;
    // user must be either null or a non-null, non-array object.
    if (user === null) {
      return { status: 'ok', user: null };
    }
    if (typeof user !== 'object' || Array.isArray(user)) {
      throw new Error(GENERIC_ERR);
    }
    return { status: 'ok', user: user as TwitchUserLookup };
  }

  // Handle 'unauthorized' — no user field expected.
  if (status === 'unauthorized') {
    if ('user' in obj) {
      throw new Error(GENERIC_ERR);
    }
    return { status: 'unauthorized' };
  }

  // Unknown status.
  throw new Error(GENERIC_ERR);
}

/**
 * Validate the refreshed connection returned by refreshStoredTwitchConnection.
 *
 * Requires a non-null object (not an array) with identity matching the
 * stored connection and a non-empty trimmed accessToken.
 */
function validateRefreshedConnection(
  conn: unknown,
  storedId: string,
  storedUserId: string,
  storedLogin: string,
): void {
  if (
    typeof conn !== 'object' ||
    conn === null ||
    Array.isArray(conn)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const obj = conn as Record<string, unknown>;

  // connectionId must exactly match.
  if (
    typeof obj.connectionId !== 'string' ||
    obj.connectionId !== storedId
  ) {
    throw new Error(GENERIC_ERR);
  }

  // twitchUserId must exactly match.
  if (
    typeof obj.twitchUserId !== 'string' ||
    obj.twitchUserId !== storedUserId
  ) {
    throw new Error(GENERIC_ERR);
  }

  // twitchLogin must exactly match.
  if (
    typeof obj.twitchLogin !== 'string' ||
    obj.twitchLogin !== storedLogin
  ) {
    throw new Error(GENERIC_ERR);
  }

  // accessToken must be a non-empty string after trimming.
  const accessToken = obj.accessToken;
  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length === 0
  ) {
    throw new Error(GENERIC_ERR);
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Load a stored Twitch connection, look up one channel login, and refresh
 * stored OAuth tokens once when Twitch returns HTTP 401.
 *
 * Returns the resolved Twitch user information, or `null` when no user
 * is found.  Throws on any failure — invalid input, lookup failure,
 * Twitch API error, token refresh failure, identity mismatch, or
 * malformed helper results.
 */
export async function getStoredTwitchUserByLogin(
  connectionId: string,
  login: string,
): Promise<TwitchUserLookup | null> {
  try {
    // 1. Validate inputs.
    validateConnectionId(connectionId);
    const normalizedLogin = validateLogin(login);

    // 2. Load the stored connection.
    const conn = await getTwitchConnection(connectionId);

    // 3. Validate the loaded connection at runtime.
    const stored = validateStoredConnection(conn, connectionId);

    // 4. First lookup request.
    let result = await fetchTwitchUserByLogin(
      stored.accessToken,
      normalizedLogin,
    );

    // 5. Validate the first lookup result.
    result = validateLookupResult(result);

    // 6. If 'ok', return immediately (user may be null).
    if (result.status === 'ok') {
      return result.user;
    }

    // 7. First result was 'unauthorized' — refresh tokens.
    const refreshed = await refreshStoredTwitchConnection(connectionId);

    // 8. Validate the refreshed connection at runtime.
    validateRefreshedConnection(
      refreshed,
      stored.connectionId,
      stored.twitchUserId,
      stored.twitchLogin,
    );

    // 9. Retry the lookup exactly once with the fresh token.
    result = await fetchTwitchUserByLogin(
      refreshed.accessToken,
      normalizedLogin,
    );

    // 10. Validate the second lookup result.
    result = validateLookupResult(result);

    // 11. If second result is 'unauthorized', throw the generic error.
    if (result.status === 'unauthorized') {
      throw new Error(GENERIC_ERR);
    }

    // 12. Second result is 'ok' — return its user.
    return result.user;
  } catch {
    // Never expose internal errors — re-throw the generic message.
    throw new Error(GENERIC_ERR);
  }
}
