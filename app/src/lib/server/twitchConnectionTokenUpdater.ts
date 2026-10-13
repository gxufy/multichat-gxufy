/* Private server-side helper for encrypting newly refreshed Twitch tokens
 * and updating an existing active Twitch connection in Supabase.
 *
 * All environment variables are read lazily inside their respective helpers
 * so missing variables do not break static builds.  Errors never expose
 * credentials, tokens, connection IDs, or database details.
 */

import { encryptTwitchToken } from './twitchTokenCrypto';
import { getSupabaseAdmin } from './supabaseAdmin';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Input required to update tokens on an existing Twitch connection. */
export type UpdateTwitchConnectionTokensInput = {
  connectionId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
};

/** Minimal result returned after a successful update. */
export type UpdatedTwitchConnectionTokens = {
  connectionId: string;
  tokenExpiresAt: string;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const REQUIRED_SCOPE = 'moderator:read:chat_messages';
const GENERIC_ERR = 'Twitch token update failed.';
const TABLE = 'twitch_connections';

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Validate every field in *input*.
 *
 * Throws on the first validation failure.
 */
function validateInput(
  input: unknown,
): asserts input is UpdateTwitchConnectionTokensInput {
  if (input === null || typeof input !== 'object') {
    throw new Error(GENERIC_ERR);
  }

  const obj = input as Record<string, unknown>;

  /* connectionId — non-empty valid UUID string */
  const connectionId = obj.connectionId;
  if (
    typeof connectionId !== 'string' ||
    connectionId.trim().length === 0 ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      connectionId,
    )
  ) {
    throw new Error(GENERIC_ERR);
  }

  /* accessToken — non-empty string after trimming */
  const accessToken = obj.accessToken;
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    throw new Error(GENERIC_ERR);
  }

  /* refreshToken — non-empty string after trimming */
  const refreshToken = obj.refreshToken;
  if (
    typeof refreshToken !== 'string' ||
    refreshToken.trim().length === 0
  ) {
    throw new Error(GENERIC_ERR);
  }

  /* expiresIn — positive finite integer */
  const expiresIn = obj.expiresIn;
  if (
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn !== Math.floor(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error(GENERIC_ERR);
  }

  /* scopes — array of non-empty strings, must include required scope */
  const scopes = obj.scopes;
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    !scopes.every((s: unknown) => typeof s === 'string' && s.trim().length > 0)
  ) {
    throw new Error(GENERIC_ERR);
  }

  if (!scopes.includes(REQUIRED_SCOPE)) {
    throw new Error(GENERIC_ERR);
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Encrypt newly refreshed Twitch tokens and update an existing active
 * connection in Supabase.
 *
 * Requires the connection to exist, be unrevoked, and match connectionId
 * exactly.  Returns the row id and the computed token expiry timestamp.
 */
export async function updateTwitchConnectionTokens(
  input: UpdateTwitchConnectionTokensInput,
): Promise<UpdatedTwitchConnectionTokens> {
  try {
    // Validate before any encryption or database work.
    validateInput(input);

    // Capture current time once.
    const now = new Date();

    // Calculate token expiry from now + expiresIn seconds.
    const tokenExpiresAt = new Date(now.getTime() + input.expiresIn * 1000);

    // Reject invalid timestamps, overflow, or expiry not later than now.
    if (
      Number.isNaN(tokenExpiresAt.getTime()) ||
      tokenExpiresAt.getTime() <= now.getTime()
    ) {
      throw new Error(GENERIC_ERR);
    }

    const tokenExpiresAtIso = tokenExpiresAt.toISOString();
    const nowIso = now.toISOString();

    // Encrypt both tokens (do not trim — only trim checked emptiness above).
    const accessTokenEncrypted = encryptTwitchToken(input.accessToken);
    const refreshTokenEncrypted = encryptTwitchToken(input.refreshToken);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from(TABLE)
      .update({
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        token_expires_at: tokenExpiresAtIso,
        scopes: input.scopes,
        updated_at: nowIso,
      })
      .eq('id', input.connectionId)
      .is('revoked_at', null)
      .select('id')
      .single();

    if (error) {
      throw new Error(GENERIC_ERR);
    }

    // Require exactly one returned row with a non-empty string id.
    if (!data || typeof data !== 'object' || !data.id || typeof data.id !== 'string' || data.id.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }

    // Require the returned id to exactly equal connectionId.
    if (data.id !== input.connectionId) {
      throw new Error(GENERIC_ERR);
    }

    return {
      connectionId: data.id,
      tokenExpiresAt: tokenExpiresAtIso,
    };
  } catch {
    // Never expose internal errors — re-throw the generic message.
    throw new Error(GENERIC_ERR);
  }
}
