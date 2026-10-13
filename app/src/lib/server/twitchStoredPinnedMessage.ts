/** Server-only helper: load a stored Twitch connection, request its
 * current pinned message, and refresh OAuth tokens once when Twitch
 * returns 401.
 *
 * All failures surface as a single opaque Error so tokens, connection
 * IDs, broadcaster / moderator IDs, and internal details are never
 * leaked to calling code or logs.
 */

import {
  fetchTwitchPinnedMessage,
  type TwitchPinnedMessage,
  type TwitchPinnedMessageResult,
} from './twitchPinnedMessage';
import { getTwitchConnection } from './twitchConnectionReader';
import { refreshStoredTwitchConnection } from './twitchConnectionRefresher';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch pinned connection lookup failed.';

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Validate that `value` is a non-empty string of decimal digits. */
function isDigits(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && /^\d+$/.test(value);
}

/**
 * Validate a `TwitchPinnedMessageResult` at runtime and return its pin.
 *
 * Requires the result to be a non-null object (not an array) that contains
 * a `status` property.  When status is `'ok'` the result must also contain
 * a `pin` property whose value is either `null` or a non-null, non-array
 * object — the pin is then returned.  For any other status the function
 * throws, letting the caller decide whether a refresh is warranted.
 */
function validatePinResult(
  result: unknown,
): TwitchPinnedMessageResult {
  if (
    typeof result !== 'object' ||
    result === null ||
    Array.isArray(result) ||
    !('status' in result)
  ) {
    throw new Error(GENERIC_ERR);
  }

  const status = (result as { status: string }).status;

  if (status === 'ok') {
    if (!('pin' in result)) {
      throw new Error(GENERIC_ERR);
    }

    const pin = (result as { pin: unknown }).pin;

    if (pin !== null && (typeof pin !== 'object' || Array.isArray(pin))) {
      throw new Error(GENERIC_ERR);
    }

    return {
      status: 'ok',
      pin: pin as TwitchPinnedMessage | null,
    };
  }

  if (status === 'unauthorized') {
    return { status: 'unauthorized' };
  }

  throw new Error(GENERIC_ERR);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Load a stored Twitch connection, request its current pinned message,
 * and refresh OAuth tokens once when Twitch returns HTTP 401.
 *
 * Returns the pinned message (which may be `null` when nothing is pinned),
 * or `null` when the API reports no active pin.
 *
 * Every failure path — invalid input, connection lookup failure, malformed
 * helper results, Twitch API failure, token refresh failure, identity
 * mismatch, or a second unauthorized response — throws a single opaque
 * error with no sensitive details exposed.
 */
export async function getStoredTwitchPinnedMessage(
  connectionId: string,
  broadcasterId: string,
): Promise<TwitchPinnedMessage | null> {
  try {
    // --- Input validation ---

    if (
      typeof connectionId !== 'string' ||
      connectionId.trim().length === 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        connectionId,
      )
    ) {
      throw new Error(GENERIC_ERR);
    }

    if (typeof broadcasterId !== 'string' || broadcasterId.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }

    if (!isDigits(broadcasterId)) {
      throw new Error(GENERIC_ERR);
    }

    // --- Load stored connection ---

    const conn = await getTwitchConnection(connectionId);

    // --- Validate stored connection ---

    if (conn.connectionId !== connectionId) {
      throw new Error(GENERIC_ERR);
    }

    if (!isDigits(conn.twitchUserId)) {
      throw new Error(GENERIC_ERR);
    }

    if (
      typeof conn.accessToken !== 'string' ||
      conn.accessToken.trim().length === 0
    ) {
      throw new Error(GENERIC_ERR);
    }

    if (
      typeof conn.refreshToken !== 'string' ||
      conn.refreshToken.trim().length === 0
    ) {
      throw new Error(GENERIC_ERR);
    }

    // --- First request (stored tokens) ---

    const firstResult = validatePinResult(
      await fetchTwitchPinnedMessage(
        conn.accessToken,
        broadcasterId,
        conn.twitchUserId,
      ),
    );

    if (firstResult.status === 'ok') {
      return firstResult.pin;
    }

    if (firstResult.status !== 'unauthorized') {
      throw new Error(GENERIC_ERR);
    }

    // --- Refresh (only after first 'unauthorized') ---

    const refreshedFull = await refreshStoredTwitchConnection(connectionId);

    if (
      typeof refreshedFull !== 'object' ||
      refreshedFull === null ||
      Array.isArray(refreshedFull)
    ) {
      throw new Error(GENERIC_ERR);
    }

    if (refreshedFull.connectionId !== conn.connectionId) {
      throw new Error(GENERIC_ERR);
    }

    if (refreshedFull.twitchUserId !== conn.twitchUserId) {
      throw new Error(GENERIC_ERR);
    }

    if (refreshedFull.twitchLogin !== conn.twitchLogin) {
      throw new Error(GENERIC_ERR);
    }

    if (
      typeof refreshedFull.accessToken !== 'string' ||
      refreshedFull.accessToken.trim().length === 0
    ) {
      throw new Error(GENERIC_ERR);
    }

    // --- Second request (refreshed tokens) ---

    const secondResult = validatePinResult(
      await fetchTwitchPinnedMessage(
        refreshedFull.accessToken,
        broadcasterId,
        refreshedFull.twitchUserId,
      ),
    );

    if (secondResult.status === 'ok') {
      return secondResult.pin;
    }

    // Second request was not 'ok' — throw the generic error.
    throw new Error(GENERIC_ERR);
  } catch {
    throw new Error(GENERIC_ERR);
  }
}
