/* Private server-side helper that refreshes one stored Twitch connection,
 * validates the new access token, and saves the rotated tokens back into
 * the same Supabase row.
 *
 * All failures surface as a single opaque Error so tokens, connection IDs,
 * database details, and environment values are never leaked.
 */

import { getTwitchConnection } from './twitchConnectionReader';
import { refreshTwitchAccessToken } from './twitchTokenRefresh';
import {
  validateTwitchAccessToken,
  type TwitchTokenValidation,
} from './twitchTokenValidation';
import { updateTwitchConnectionTokens } from './twitchConnectionTokenUpdater';
import type { StoredTwitchConnection } from './twitchConnectionReader';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/**
 * A Twitch connection after a successful refresh cycle.
 *
 * Tokens are the fresh values returned by the refresh endpoint.
 */
export type RefreshedTwitchConnection = {
  connectionId: string;
  twitchUserId: string;
  twitchLogin: string;
  twitchDisplayName: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  scopes: string[];
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch connection refresh failed.';

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Validate identity between the stored connection and the token validation
 * result.
 *
 * Requires `userId` and `login` to match, a non-empty `clientId`, and the
 * required scope to be present.
 *
 * Throws on any failure.
 */
function validateIdentity(
  stored: StoredTwitchConnection,
  validation: TwitchTokenValidation,
): void {
  if (validation.userId !== stored.twitchUserId) {
    throw new Error(GENERIC_ERR);
  }
  if (validation.login !== stored.twitchLogin) {
    throw new Error(GENERIC_ERR);
  }
  if (typeof validation.clientId !== 'string' || validation.clientId.length === 0) {
    throw new Error(GENERIC_ERR);
  }
  if (!validation.scopes.includes('moderator:read:chat_messages')) {
    throw new Error(GENERIC_ERR);
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Refresh a stored Twitch connection: rotate its tokens, validate the new
 * access token against Twitch, and persist the rotated tokens back to the
 * same Supabase row.
 *
 * Returns the refreshed connection with updated token values.
 *
 * Every failure path — invalid input, lookup failure, refresh failure,
 * validation failure, identity mismatch, database failure, or malformed
 * helper results — throws a single opaque error.
 */
export async function refreshStoredTwitchConnection(
  connectionId: string,
): Promise<RefreshedTwitchConnection> {
  try {
    // 1. Load the stored connection (decrypted tokens).
    const stored = await getTwitchConnection(connectionId);

    // 2. Exchange the stored refresh token for new tokens.
    const tokenGrant = await refreshTwitchAccessToken(stored.refreshToken);

    // 3. Validate the new access token with Twitch.
    const validation = await validateTwitchAccessToken(tokenGrant.accessToken);

    // 4. Validate identity before touching the database.
    validateIdentity(stored, validation);

    // 5. Persist the rotated tokens back to the same row.
    const updated = await updateTwitchConnectionTokens({
      connectionId: stored.connectionId,
      accessToken: tokenGrant.accessToken,
      refreshToken: tokenGrant.refreshToken,
      expiresIn: validation.expiresIn,
      scopes: validation.scopes,
    });

    // 6. Require the updater returned the same connection ID.
    if (updated.connectionId !== stored.connectionId) {
      throw new Error(GENERIC_ERR);
    }

    // 7. Assemble and return the refreshed connection.
    return {
      connectionId: stored.connectionId,
      twitchUserId: stored.twitchUserId,
      twitchLogin: stored.twitchLogin,
      twitchDisplayName: stored.twitchDisplayName,
      accessToken: tokenGrant.accessToken,
      refreshToken: tokenGrant.refreshToken,
      tokenExpiresAt: updated.tokenExpiresAt,
      scopes: validation.scopes,
    };
  } catch {
    // Never expose internal errors — re-throw the generic message.
    throw new Error(GENERIC_ERR);
  }
}
