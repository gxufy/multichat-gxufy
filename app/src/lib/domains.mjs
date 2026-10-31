/* The one place every public site domain string lives.
 *
 * gxufy.com is canonical and multichat-gxufy.com remains a
 * compatibility origin for existing OBS browser-source URLs.
 *
 * Plain JavaScript ESM keeps these public constants usable from browser
 * and server code without pulling server-only configuration into clients.
 * Nothing here reads the environment or the network.
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
