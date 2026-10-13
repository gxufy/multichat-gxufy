/** Server-only helper: ask Twitch to revoke one OAuth access token.
 *
 * POSTs to Twitch's /oauth2/revoke endpoint with the client id and token as
 * form-encoded fields. This is a best-effort courtesy call made *after* the
 * database revocation has already succeeded — the database is authoritative,
 * so a provider failure here never changes the outcome of a disconnect.
 *
 * The client id is read lazily so a missing variable does not break static
 * builds. Nothing is logged, and the Twitch response body is never read,
 * parsed, or exposed.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';

/** Disconnect must stay responsive; the call is best-effort anyway. */
const REQUEST_TIMEOUT_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Attempt to revoke `accessToken` at Twitch.
 *
 * Returns `true` only on HTTP 200. Twitch answers 400 for a token it does
 * not recognise, which is reported as `false` rather than treated as
 * success — the caller uses this purely as an advisory signal.
 *
 * Never throws and never rejects: every failure mode (missing client id,
 * invalid input, timeout, network error, non-200 status) resolves to
 * `false` so it cannot disturb an already-completed database revocation.
 */
export async function revokeTwitchAccessToken(
  accessToken: string,
): Promise<boolean> {
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    return false;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = new URLSearchParams();
    body.set('client_id', clientId);
    body.set('token', accessToken);

    const response = await fetch(TWITCH_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    // Only 200 counts. The body is deliberately never read.
    return response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
