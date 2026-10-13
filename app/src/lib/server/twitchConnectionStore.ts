/* Server-side helper to encrypt Twitch OAuth tokens and upsert a
 * Twitch connection row in the public.twitch_connections table.
 */
import { encryptTwitchToken } from './twitchTokenCrypto';
import { getSupabaseAdmin } from './supabaseAdmin';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Input required to save / update a Twitch connection. */
export type SaveTwitchConnectionInput = {
  twitchUserId: string;
  twitchLogin: string;
  twitchDisplayName: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
};

/** Minimal result returned after a successful upsert. */
export type SavedTwitchConnection = {
  connectionId: string;
  tokenExpiresAt: string;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const REQUIRED_SCOPE = 'moderator:read:chat_messages';
const GENERIC_ERR = 'Twitch connection storage failed.';
const TABLE = 'twitch_connections';

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Validate every field in *input*.
 *
 * Throws on the first validation failure.
 */
function validateInput(input: unknown): asserts input is SaveTwitchConnectionInput {
  if (input === null || typeof input !== 'object') {
    throw new Error(GENERIC_ERR);
  }

  const obj = input as Record<string, unknown>;

  const stringFields = [
    'twitchUserId',
    'twitchLogin',
    'twitchDisplayName',
    'accessToken',
    'refreshToken',
  ] as const;

  for (const field of stringFields) {
    const value = obj[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }
  }

  const expiresIn = obj.expiresIn;
  if (
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn !== Math.floor(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error(GENERIC_ERR);
  }

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
 * Encrypt and persist (or update) a single Twitch OAuth connection.
 *
 * Upserts on twitch_user_id and returns the row's id plus the
 * computed token expiry timestamp.
 */
export async function saveTwitchConnection(
  input: SaveTwitchConnectionInput,
): Promise<SavedTwitchConnection> {
  try {
    // Validate before any encryption or database work.
    validateInput(input);

    // Calculate expiry — now + expiresIn seconds.
    const tokenExpiresAt = new Date(Date.now() + input.expiresIn * 1000);
    const now = new Date().toISOString();

    // Reject invalid or past timestamps.
    if (Number.isNaN(tokenExpiresAt.getTime()) || tokenExpiresAt <= new Date()) {
      throw new Error(GENERIC_ERR);
    }

    // Encrypt tokens (do not trim — only trim checked emptiness above).
    const accessTokenEncrypted = encryptTwitchToken(input.accessToken);
    const refreshTokenEncrypted = encryptTwitchToken(input.refreshToken);

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          twitch_user_id: input.twitchUserId,
          twitch_login: input.twitchLogin,
          twitch_display_name: input.twitchDisplayName,
          access_token_encrypted: accessTokenEncrypted,
          refresh_token_encrypted: refreshTokenEncrypted,
          token_expires_at: tokenExpiresAt.toISOString(),
          scopes: input.scopes,
          revoked_at: null,
          updated_at: now,
        },
        {
          onConflict: 'twitch_user_id',
        },
      )
      .select('id')
      .single();

    if (error) {
      throw new Error(GENERIC_ERR);
    }

    if (!data || typeof data !== 'object' || !data.id || typeof data.id !== 'string' || data.id.trim().length === 0) {
      throw new Error(GENERIC_ERR);
    }

    return {
      connectionId: data.id,
      tokenExpiresAt: tokenExpiresAt.toISOString(),
    };
  } catch {
    // Never expose internal errors — re-throw the generic message.
    throw new Error(GENERIC_ERR);
  }
}
