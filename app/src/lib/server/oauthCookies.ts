/* The two temporary OAuth cookies, written and read in one place.
 *
 * Two separate cookies rather than one structured value: the state cookie's
 * format, name, path, and comparison are unchanged from before this module
 * existed, so an authorization already in flight during a deploy still completes.
 * Encoding the destination into the state would have changed the value the
 * callback compares, breaking exactly those requests.
 *
 * Both are HttpOnly, SameSite=Lax (the callback is a cross-site top-level GET
 * redirect, which Lax permits and Strict would drop), Secure in production, and
 * scoped to /api/twitch/oauth so they are never sent to page routes.
 */
import crypto from 'node:crypto';

const STATE_BYTES = 32;

export const STATE_COOKIE_NAME = 'twitch_oauth_state';
export const RETURN_COOKIE_NAME = 'twitch_oauth_return';
export const OAUTH_COOKIE_PATH = '/api/twitch/oauth';
export const OAUTH_COOKIE_MAX_AGE = 600;

/** A fresh cryptographically random state value. */
export function generateOAuthState(): string {
  return crypto.randomBytes(STATE_BYTES).toString('hex');
}

function cookie(name: string, value: string, maxAge: number): string {
  const parts = [
    `${name}=${value}`,
    `Path=${OAUTH_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
    'HttpOnly',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** Set-Cookie values for a new authorization attempt. */
export function buildOAuthCookies(state: string, returnTo: string): string[] {
  return [
    cookie(STATE_COOKIE_NAME, state, OAUTH_COOKIE_MAX_AGE),
    /* The destination is already allowlist-validated, so it contains no
       character needing encoding — but encode anyway, so a future allowlist
       entry cannot silently produce a malformed header. */
    cookie(RETURN_COOKIE_NAME, encodeURIComponent(returnTo), OAUTH_COOKIE_MAX_AGE),
  ];
}

/**
 * Set-Cookie values that clear both cookies.
 *
 * Always sent by the callback, on every path out of it — success, refusal, and
 * failure alike — so a state value is never replayable.
 */
export function buildClearOAuthCookies(): string[] {
  return [cookie(STATE_COOKIE_NAME, '', 0), cookie(RETURN_COOKIE_NAME, '', 0)];
}

/**
 * Read one cookie value from a raw Cookie header.
 *
 * Splits on ';' and takes the first exact name match. Values are rejoined on '='
 * so a value containing '=' survives.
 */
export function readCookie(
  rawCookie: string | undefined,
  name: string,
): string | undefined {
  if (!rawCookie) return undefined;
  for (const part of rawCookie.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) {
      const value = rest.join('=');
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/** The return cookie's decoded value, or undefined if absent or malformed. */
export function readReturnCookie(rawCookie: string | undefined): string | undefined {
  const raw = readCookie(rawCookie, RETURN_COOKIE_NAME);
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    /* Malformed percent-encoding: treat as absent, so the caller falls back to
       the default destination rather than propagating a broken string. */
    return undefined;
  }
}
