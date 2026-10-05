/** Server-only helper: resolve a stored Twitch connection to a channel's
 * canonical user information and that channel's current pinned message.
 *
 * Combines the stored user-lookup and stored pinned-message helpers,
 * validating every intermediate result so tokens, connection IDs, user
 * IDs, and internal details are never leaked.
 */

import type { TwitchUserLookup } from './twitchUserLookup';
import type { TwitchPinnedMessage } from './twitchPinnedMessage';
import { getStoredTwitchUserByLogin } from './twitchStoredUserLookup';
import { getStoredTwitchPinnedMessage } from './twitchStoredPinnedMessage';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolved broadcaster information and that channel's current pinned
 * message (which may be `null` when nothing is pinned).
 */
export type TwitchStoredChannelPin = {
  broadcaster: TwitchUserLookup;
  pin: TwitchPinnedMessage | null;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch stored channel pin lookup failed.';

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Validate that `value` is a non-empty string of decimal digits. */
function isDigits(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && /^\d+$/.test(value);
}

/** Validate that `value` is a valid timestamp string. */
function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve a stored Twitch connection to a channel's canonical user
 * information and that channel's current pinned message.
 *
 * Validates both inputs, calls the stored user-lookup, and — only when
 * the user is found — calls the stored pinned-message helper.
 *
 * Returns the broadcaster plus pin (or `null` when nothing is pinned),
 * or `null` when the user lookup finds no matching user.
 *
 * Every failure path — invalid input, malformed helper results, or
 * lookup failure — throws a single opaque error with no sensitive
 * details exposed.
 */
export async function getStoredTwitchChannelPin(
  connectionId: string,
  login: string,
): Promise<TwitchStoredChannelPin | null> {
  try {
    // --- Validate connectionId ---

    if (
      typeof connectionId !== 'string' ||
      connectionId.trim().length === 0
    ) {
      throw new Error(GENERIC_ERR);
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        connectionId,
      )
    ) {
      throw new Error(GENERIC_ERR);
    }

    // --- Validate and normalize login ---

    if (typeof login !== 'string' || login.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }

    const normalizedLogin = login.trim().toLowerCase();

    if (normalizedLogin.length > 100 || !/^[a-z0-9_]+$/.test(normalizedLogin)) {
      throw new Error(GENERIC_ERR);
    }

    // --- Look up the stored user ---

    const broadcaster = await getStoredTwitchUserByLogin(
      connectionId,
      normalizedLogin,
    );

    if (broadcaster === null) {
      return null;
    }

    // --- Validate broadcaster object ---

    if (
      typeof broadcaster !== 'object' ||
      broadcaster === null ||
      Array.isArray(broadcaster)
    ) {
      throw new Error(GENERIC_ERR);
    }

    const userId = (broadcaster as Record<string, unknown>).userId;
    if (typeof userId !== 'string' || !isDigits(userId)) {
      throw new Error(GENERIC_ERR);
    }

    const bLogin = (broadcaster as Record<string, unknown>).login;
    if (typeof bLogin !== 'string' || bLogin.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }

    const bLoginMatch = bLogin.toLowerCase();
    if (bLoginMatch !== normalizedLogin) {
      throw new Error(GENERIC_ERR);
    }

    const displayName = (broadcaster as Record<string, unknown>).displayName;
    if (typeof displayName !== 'string' || displayName.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }

    // --- Look up the stored pinned message ---

    const pin = await getStoredTwitchPinnedMessage(connectionId, userId);

    // --- Validate pin result ---

    if (pin !== null) {
      if (typeof pin !== 'object' || Array.isArray(pin)) {
        throw new Error(GENERIC_ERR);
      }

      const raw = pin as Record<string, unknown>;

      if (
        typeof raw.messageId !== 'string' ||
        raw.messageId.trim().length === 0
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.broadcasterId !== 'string' ||
        raw.broadcasterId !== userId
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.senderUserId !== 'string' ||
        !isDigits(raw.senderUserId)
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.senderUserLogin !== 'string' ||
        raw.senderUserLogin.trim().length === 0
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.senderUserName !== 'string' ||
        raw.senderUserName.trim().length === 0
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.pinnedByUserId !== 'string' ||
        !isDigits(raw.pinnedByUserId)
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.pinnedByUserLogin !== 'string' ||
        raw.pinnedByUserLogin.trim().length === 0
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (
        typeof raw.pinnedByUserName !== 'string' ||
        raw.pinnedByUserName.trim().length === 0
      ) {
        throw new Error(GENERIC_ERR);
      }

      if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
        throw new Error(GENERIC_ERR);
      }

      if (!isValidTimestamp(raw.startsAt)) {
        throw new Error(GENERIC_ERR);
      }

      if (!isValidTimestamp(raw.updatedAt)) {
        throw new Error(GENERIC_ERR);
      }

      if (raw.endsAt !== null && !isValidTimestamp(raw.endsAt)) {
        throw new Error(GENERIC_ERR);
      }
    }

    // --- Construct return value ---

    return {
      broadcaster: {
        userId: userId,
        login: bLogin,
        displayName: displayName,
      },
      pin: pin,
    };
  } catch {
    throw new Error(GENERIC_ERR);
  }
}
