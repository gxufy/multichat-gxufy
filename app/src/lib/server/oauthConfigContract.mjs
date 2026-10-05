/* The authoritative Twitch OAuth configuration contract (runtime data + checks).
 *
 * Plain JavaScript ESM on purpose: this is the single list of required variables
 * and the inspection helpers, and it must be importable both by the TypeScript
 * OAuth routes (through oauthConfig.ts, which re-exports every name here) and by
 * the standalone scripts/verify-oauth-*.mjs maintenance commands that bare Node
 * runs with no TypeScript loader. One .mjs definition is what stops the operator
 * check and the routes from ever drifting apart.
 *
 * SAFETY. Every read is lazy, inside a function, so importing this does nothing.
 * Nothing here returns a value out of the environment — not truncated, not a
 * length, not a prefix — only variable names and a present/absent verdict. The
 * callback URLs are public constants the operator registers on Twitch.
 */

/**
 * Every variable the Twitch OAuth flow requires, Twitch application first, then
 * the token store. A readonly tuple so oauthConfig.ts can derive the
 * TwitchOAuthEnvKey union from it.
 *
 * @type {readonly ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_REDIRECT_URI', 'TWITCH_TOKEN_ENCRYPTION_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']}
 */
export const REQUIRED_TWITCH_OAUTH_ENV = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'TWITCH_REDIRECT_URI',
  'TWITCH_TOKEN_ENCRYPTION_KEY',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
];

/**
 * The path Twitch redirects back to. A constant rather than a literal in three
 * places, because it must agree with the file layout, TWITCH_REDIRECT_URI, and
 * the entry registered in the Twitch developer console. Twitch compares byte for
 * byte.
 *
 * The origins and the callback builder come from the shared domain contract in
 * src/lib/domains.mjs, so the callback URLs registered on Twitch and the origins
 * the site canonicalizes to can never disagree. A server module importing that
 * browser-safe file is fine; the boundary only forbids the reverse.
 */
import {
  CANONICAL_ORIGIN,
  LEGACY_ORIGIN,
  LOCAL_ORIGIN,
  OAUTH_CALLBACK_PATH,
  oauthCallbackUrl,
} from '../domains.mjs';

export const TWITCH_OAUTH_CALLBACK_PATH = OAUTH_CALLBACK_PATH;

/**
 * The primary production origin, now gxufy.com. TWITCH_REDIRECT_URI on the live
 * site must be this origin's callback, and it is the one the operator registers
 * first on the Twitch application.
 */
export const TWITCH_OAUTH_PRODUCTION_ORIGIN = CANONICAL_ORIGIN;

/**
 * The legacy production origin, multichat-gxufy.com. Kept registered on the
 * Twitch application during the cutover so a rollback to it needs no console
 * change; it is not removed until a later cleanup pass.
 */
export const TWITCH_OAUTH_LEGACY_ORIGIN = LEGACY_ORIGIN;

/** The development origin `npm run dev` serves. */
export const TWITCH_OAUTH_LOCAL_ORIGIN = LOCAL_ORIGIN;

/** The callback URL for an origin, with any trailing slash removed. */
export function twitchOAuthCallbackUrl(origin) {
  return oauthCallbackUrl(origin);
}

/**
 * What TWITCH_REDIRECT_URI must be in production, and what has to be registered
 * in the Twitch developer console for the live site.
 */
export const TWITCH_OAUTH_PRODUCTION_CALLBACK = twitchOAuthCallbackUrl(
  TWITCH_OAUTH_PRODUCTION_ORIGIN,
);

/**
 * The legacy callback, kept registered alongside the primary one so an OBS-free
 * rollback to multichat-gxufy.com does not require touching the Twitch console.
 */
export const TWITCH_OAUTH_LEGACY_CALLBACK = twitchOAuthCallbackUrl(
  TWITCH_OAUTH_LEGACY_ORIGIN,
);

/** The same, for local development. Both may be registered on one application. */
export const TWITCH_OAUTH_LOCAL_CALLBACK = twitchOAuthCallbackUrl(
  TWITCH_OAUTH_LOCAL_ORIGIN,
);

/**
 * Whether a variable is set to something usable. An empty or whitespace-only
 * value counts as absent: a hosting panel holding the key with a blank value is
 * misconfigured in exactly the way a missing key is.
 */
function isPresent(key) {
  const raw = process.env[key];
  return typeof raw === 'string' && raw.trim().length > 0;
}

/**
 * The names of every required variable that is absent or empty. Names only —
 * never a value from the environment, so the result is safe to log. An empty
 * array means the contract is satisfied.
 */
export function missingTwitchOAuthEnv() {
  return REQUIRED_TWITCH_OAUTH_ENV.filter((key) => !isPresent(key));
}

/**
 * True when TWITCH_REDIRECT_URI is set but does not end in the callback path
 * this application actually serves. The value is never returned or logged; only
 * the boolean verdict.
 */
export function twitchRedirectUriPathLooksWrong() {
  const raw = process.env.TWITCH_REDIRECT_URI;
  if (typeof raw !== 'string' || raw.trim().length === 0) return false;
  return !raw.trim().endsWith(TWITCH_OAUTH_CALLBACK_PATH);
}
