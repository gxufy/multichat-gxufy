/* POST /api/twitch/oauth/disconnect — disconnect a stored Twitch connection.
 *
 * Marks the connection revoked in the database (authoritative), then makes a
 * best-effort call asking Twitch to revoke the access token.
 *
 * Idempotent: disconnecting an already-revoked or nonexistent connection
 * succeeds with the same response as a first-time disconnect, so the route
 * cannot be used to discover whether a connection id exists.
 *
 * All errors are generic — no connection id, login, token, provider response,
 * or database detail is ever returned or logged.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { revokeStoredTwitchConnection } from '../../../../lib/server/twitchConnectionRevoker';
import { revokeTwitchAccessToken } from '../../../../lib/server/twitchTokenRevocation';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const GENERIC_ERR = 'Twitch disconnect failed.';

/** Canonical UUID shape used across the Twitch server helpers. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract a valid connection id from an already-parsed JSON body.
 *
 * Returns null when the body is not a plain object or `connectionId` is
 * missing, non-string, or not a canonical UUID.
 */
function readConnectionId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const value = (body as Record<string, unknown>).connectionId;

  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    return null;
  }

  return value;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  /* --- Method check ------------------------------------------------- */
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  /* --- JSON only ---------------------------------------------------- */
  const contentType = req.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    !contentType.toLowerCase().includes('application/json')
  ) {
    res.status(415).json({ error: GENERIC_ERR });
    return;
  }

  /* --- Validate body ------------------------------------------------ */
  const connectionId = readConnectionId(req.body);
  if (connectionId === null) {
    res.status(400).json({ error: GENERIC_ERR });
    return;
  }

  /* --- Revoke in the database (authoritative) ----------------------- */
  let accessToken: string | null = null;

  try {
    const result = await revokeStoredTwitchConnection(connectionId);
    accessToken = result.accessToken;
  } catch {
    res.status(500).json({ error: GENERIC_ERR });
    return;
  }

  /* --- Best-effort provider revocation ------------------------------ */
  //
  // Runs only when a row was actually revoked just now and its token was
  // recoverable. The outcome is deliberately ignored: the database revocation
  // above already stands, and reporting provider status here would leak
  // whether the id existed.
  if (accessToken !== null) {
    try {
      await revokeTwitchAccessToken(accessToken);
    } catch {
      // Unreachable — the helper never rejects — but belt and braces.
    }
  }

  /* --- Identical response for revoked, already-revoked, unknown ----- */
  res.status(200).json({ ok: true });
}
