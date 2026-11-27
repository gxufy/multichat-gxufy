/* Where the retired generator addresses send visitors, shared by both apps'
 * pages (/tools/multichat, /tools/counter and /classic/multichat).
 *
 * These hosted earlier generators. The revamped original Classic generator at
 * /multichat is now the only generator, and it embeds the Viewer Counter as a
 * companion panel rather than giving it a page of its own:
 *
 *   /tools/multichat   → /multichat
 *   /tools/counter     → /multichat#viewer-counter
 *   /classic/multichat → /multichat
 *
 * The paths stay as redirects because they were linked from the homepage and
 * are in the OAuth return allowlist: an authorization begun before the deploy
 * that retired them comes back to whatever `returnTo` it recorded. The callback
 * delivers the connection id in the URL fragment, and a fragment exists only in
 * `window.location.hash` (it is never sent to the server), so the redirect runs
 * in the browser and carries it across. A forward that dropped it would
 * silently discard the connection the user just authorized.
 *
 * The fragment is never parsed, logged, or turned into a query parameter here
 * beyond being passed along.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import { CANONICAL_COUNTER_ROUTE, CANONICAL_MULTICHAT_ROUTE } from './multichatRouting';

/**
 * Where each retired tool page now sends visitors, keyed by its route
 * segment. A segment with no entry is a genuine 404 rather than a redirect, so
 * /tools/unknown does not quietly become the generator.
 */
export const RETIRED_TOOL_DESTINATIONS: Readonly<Record<string, string>> = {
  multichat: CANONICAL_MULTICHAT_ROUTE,
  counter: CANONICAL_COUNTER_ROUTE,
};

/** The destination for /tools/<id>, or null when that page never existed. */
export function retiredToolDestination(id: string | undefined): string | null {
  if (typeof id !== 'string' || !Object.hasOwn(RETIRED_TOOL_DESTINATIONS, id)) return null;
  return RETIRED_TOOL_DESTINATIONS[id];
}

/**
 * Whether a fragment is an OAuth connection payload rather than an anchor.
 *
 * Detected by shape — a payload is `key=value` pairs — rather than by matching
 * the parameter name, so nothing here needs to know what the fields are called.
 */
export function isConnectionFragment(hash: string): boolean {
  return hash.replace(/^#/, '').includes('=');
}

/**
 * Where a retired tool page forwards, given the fragment it was opened with.
 * A payload fragment replaces the destination's own anchor and is carried to
 * the generator; a plain anchor is not, since the destination already names
 * the section it wants.
 */
export function retiredToolTarget(destination: string, hash: string): string {
  return isConnectionFragment(hash) ? `${CANONICAL_MULTICHAT_ROUTE}${hash}` : destination;
}

/** Where /classic/multichat forwards: the generator, fragment and all. */
export function classicGeneratorTarget(hash: string): string {
  return `${CANONICAL_MULTICHAT_ROUTE}${hash}`;
}
