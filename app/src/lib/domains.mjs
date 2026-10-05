/* The one place every domain string lives.
 *
 * The site answers on two production domains at once: gxufy.com is the primary,
 * and multichat-gxufy.com stays live as a compatibility domain because OBS scene
 * collections point browser sources at it and nobody will re-edit them. Every
 * origin, callback URL, and known-host decision is derived from the handful of
 * constants here, so a future domain move is one edit rather than a grep across
 * the tree.
 *
 * Plain JavaScript ESM on purpose, and carrying no credentials, so the same
 * module can be imported by three kinds of caller that cannot share a
 * TypeScript-only file:
 *
 *   - browser code (the generator, the sunset banner), where a server-only import
 *     would pull server code into the client bundle;
 *   - the OAuth contract lib/server/oauthConfigContract.mjs, which is itself .mjs
 *     so the verify scripts can read it;
 *   - the standalone scripts/verify-oauth-*.mjs commands that bare Node runs with
 *     no TypeScript loader.
 *
 * Nothing here reads the environment or the network. These are compile-time
 * constants about where the site lives, not configuration.
 */

/* ------------------------------------------------------------------ */
/* Origins                                                             */
/* ------------------------------------------------------------------ */

/** The canonical primary origin. Public links and generated URLs prefer this. */
export const CANONICAL_ORIGIN = 'https://gxufy.com';

/** The `www` form of the primary origin. The edge redirects it to the apex. */
export const CANONICAL_WWW_ORIGIN = 'https://www.gxufy.com';

/**
 * The legacy compatibility origin. Still fully served — every OBS URL already in
 * a scene collection points here and must keep rendering — but no longer the
 * address new links are built with.
 */
export const LEGACY_ORIGIN = 'https://multichat-gxufy.com';

/** The `www` form of the legacy origin, also served for the same reason. */
export const LEGACY_WWW_ORIGIN = 'https://www.multichat-gxufy.com';

/** The development origin `npm run dev` serves. */
export const LOCAL_ORIGIN = 'http://localhost:3000';

/* ------------------------------------------------------------------ */
/* OAuth callback                                                      */
/* ------------------------------------------------------------------ */

/**
 * The path Twitch redirects back to. One constant, because it must agree with the
 * file layout (pages/api/twitch/oauth/callback.ts), TWITCH_REDIRECT_URI, and the
 * entry registered in the Twitch developer console, which Twitch compares byte
 * for byte.
 */
export const OAUTH_CALLBACK_PATH = '/api/twitch/oauth/callback';

/** The callback URL for an origin, with any trailing slash removed. */
export function oauthCallbackUrl(origin) {
  return `${origin.replace(/\/+$/, '')}${OAUTH_CALLBACK_PATH}`;
}

/**
 * The primary callback — what TWITCH_REDIRECT_URI must be in production once the
 * cutover completes, and what the Twitch console must have registered for the
 * live site.
 */
export const CANONICAL_OAUTH_CALLBACK = oauthCallbackUrl(CANONICAL_ORIGIN);

/**
 * The legacy callback, retained through the migration. Registering it alongside
 * the primary one keeps a rollback to multichat-gxufy.com a one-line env change
 * rather than a Twitch-console round trip. A later cleanup pass removes it.
 */
export const LEGACY_OAUTH_CALLBACK = oauthCallbackUrl(LEGACY_ORIGIN);

/** The same, for local development. All three may be registered on one app. */
export const LOCAL_OAUTH_CALLBACK = oauthCallbackUrl(LOCAL_ORIGIN);

/* ------------------------------------------------------------------ */
/* Host safety                                                         */
/* ------------------------------------------------------------------ */

/** The bare host of the canonical origin, for Host-header comparisons. */
export const CANONICAL_HOST = 'gxufy.com';

/** The bare host of the `www` canonical origin. */
export const CANONICAL_WWW_HOST = 'www.gxufy.com';

/**
 * The legacy hosts that still serve the site. A request whose Host is one of
 * these is where selective canonicalization applies; anywhere else, a request is
 * left exactly where it is.
 */
export const LEGACY_HOSTS = ['multichat-gxufy.com', 'www.multichat-gxufy.com'];

/**
 * Every host this application knowingly answers on. Used to decide whether a
 * request is on a recognised domain at all; an unknown Host is never reflected
 * back into a redirect target — the fixed CANONICAL_ORIGIN constant is used
 * instead — so a forged Host header cannot open a redirect off-site.
 *
 * Vercel preview hosts are not enumerable here (they are per-deployment); the
 * canonicalization logic treats anything not on this list as pass-through, which
 * is the safe default for a preview or an unrecognised host alike.
 */
export const KNOWN_HOSTS = [
  CANONICAL_HOST,
  CANONICAL_WWW_HOST,
  ...LEGACY_HOSTS,
  'localhost',
  '127.0.0.1',
];

/** Whether a Host value (which may carry a port) is a legacy compatibility host. */
export function isLegacyHost(host) {
  return LEGACY_HOSTS.includes(stripPort(host));
}

/** Whether a Host value is the canonical primary host, in either apex or www form. */
export function isCanonicalHost(host) {
  const bare = stripPort(host);
  return bare === CANONICAL_HOST || bare === CANONICAL_WWW_HOST;
}

/** A Host header without its port, lowercased. `undefined`/empty become `''`. */
export function stripPort(host) {
  if (typeof host !== 'string') return '';
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}
