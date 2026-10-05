/** Server-only helper: revoke one stored Twitch connection.
 *
 * Marks the row revoked by setting `revoked_at`, which every reader and the
 * token updater already filter on (`revoked_at IS NULL`), so a revoked row
 * immediately becomes unusable for pin lookups, colour lookups, and token
 * refreshes.
 *
 * The row is never deleted — this is an UPDATE only, so no user data is
 * destroyed and reconnecting can reuse the same row.
 *
 * Errors never expose tokens, connection ids, logins, or database details.
 */

import { getSupabaseAdmin } from './supabaseAdmin';
import { decryptTwitchToken } from './twitchTokenCrypto';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Outcome of a revocation attempt.
 *
 * `alreadyInactive` is true when no active row matched — already revoked or
 * never existed. Both are reported identically so callers cannot use this to
 * probe whether a given id exists.
 */
export type RevokeTwitchConnectionResult = {
  alreadyInactive: boolean;
  /** Plaintext access token of the row just revoked, when recoverable. */
  accessToken: string | null;
};

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch disconnect failed.';
const TABLE = 'twitch_connections';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Mark the connection `connectionId` revoked.
 *
 * One atomic update sets `revoked_at` and `updated_at` on the row, filtered
 * to rows that are still active, and returns the encrypted access token in
 * the same round trip so no second read is needed.
 *
 * Returns `alreadyInactive: true` when no active row matched, which is an
 * idempotent success rather than an error. Throws a single opaque error only
 * when the database call itself fails.
 */
export async function revokeStoredTwitchConnection(
  connectionId: string,
): Promise<RevokeTwitchConnectionResult> {
  if (typeof connectionId !== 'string' || !UUID_RE.test(connectionId)) {
    throw new Error(GENERIC_ERR);
  }

  const now = new Date().toISOString();

  let rows: Array<{ id: string; access_token_encrypted: string | null }>;

  try {
    const supabase = getSupabaseAdmin();

    // .select() (not .single()) so zero matches is a normal empty result
    // rather than an error — that is the idempotent already-revoked path.
    const { data, error } = await supabase
      .from(TABLE)
      .update({ revoked_at: now, updated_at: now })
      .eq('id', connectionId)
      .is('revoked_at', null)
      .select('id, access_token_encrypted');

    if (error || !Array.isArray(data)) {
      throw new Error(GENERIC_ERR);
    }

    rows = data;
  } catch {
    throw new Error(GENERIC_ERR);
  }

  // No active row matched: already revoked, or never existed. Identical
  // result for both, so this cannot be used to enumerate ids.
  if (rows.length === 0) {
    return { alreadyInactive: true, accessToken: null };
  }

  // Exactly one row is expected — `id` is the primary key.
  if (rows.length !== 1 || rows[0].id !== connectionId) {
    throw new Error(GENERIC_ERR);
  }

  // Recover the plaintext token for the best-effort provider revoke. A
  // decryption failure is not fatal: the row is already revoked, which is
  // what actually stops the connection being used.
  let accessToken: string | null = null;
  const encrypted = rows[0].access_token_encrypted;

  if (typeof encrypted === 'string' && encrypted.length > 0) {
    try {
      accessToken = decryptTwitchToken(encrypted);
    } catch {
      accessToken = null;
    }
  }

  // Best-effort credential cleanup, deliberately a *separate* statement.
  //
  // The token columns' nullability cannot be confirmed from this codebase
  // (no migration files exist), and NULLing a NOT NULL column would abort
  // the whole statement. Isolating it means revocation above already stands
  // committed whatever happens here. No placeholder ciphertext is ever
  // written, so encryption validation is not weakened either way.
  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from(TABLE)
      .update({
        access_token_encrypted: null,
        refresh_token_encrypted: null,
      })
      .eq('id', connectionId)
      .not('revoked_at', 'is', null);
  } catch {
    // Ignored: the row is revoked, which is what gates every reader.
  }

  return { alreadyInactive: false, accessToken };
}
