/* The one rule that decides whether a legacy-host request is canonicalized.
 *
 * The site serves two production domains at once. gxufy.com is primary;
 * multichat-gxufy.com stays live because OBS scene collections point browser
 * sources at it and nobody re-edits them. This module decides, for a single
 * request, whether it is a page that should be nudged to the primary domain or a
 * configured overlay that must be served exactly where it was asked for.
 *
 * The decision is deliberately one-directional and conservative:
 *
 *   - It only ever acts on a legacy compatibility host. A request already on
 *     gxufy.com, on localhost, or on a Vercel preview is left alone, so there is
 *     no redirect loop and no dependence on an unrecognised Host header.
 *   - It never touches an overlay. Any /api route, the /counter overlay, and a
 *     channel-carrying /multichat or / are served in place — those are the URLs
 *     sitting in scene collections, and moving one blacks out a live stream. The
 *     channel test is the single routing authority (hasChannelParam), not a second
 *     copy of the rule.
 *   - It redirects only the website's own non-overlay pages, and only to the fixed
 *     canonical origin. The Host header is classified but never concatenated into
 *     the target, so a forged Host cannot open a redirect off-site.
 *
 * A pure function of (host, pathname, query), with the query string carried across
 * verbatim. Fragments are not visible server-side, but a browser reapplies the
 * original fragment to a redirect Location that has none, so an OAuth fragment on
 * a retired stub still survives the hop.
 */
import type { ParsedUrlQuery } from 'querystring';
import { CANONICAL_ORIGIN, isLegacyHost } from '@/lib/domains.mjs';
import { hasChannelParam } from '@/lib/multichatRouting';

/**
 * The website's own non-overlay pages — the only paths a legacy-host visit is
 * ever forwarded from. Everything else (an unknown path, an overlay, an API
 * route) is left where it is, so a 404 stays a 404 and no scene URL moves.
 *
 * `/tools/multichat`, `/tools/counter`, and `/classic/multichat` are retired
 * redirect stubs rather than overlays, so forwarding them to the primary domain
 * is safe regardless of any query they carry; each stub then does its own
 * client-side forward to /multichat, OAuth fragment and all.
 */
const CANONICALIZABLE_PATHS = new Set([
  '/',
  '/multichat',
  '/tools/multichat',
  '/tools/counter',
  '/classic/multichat',
]);

/**
 * The absolute URL a legacy-host request should be redirected to, or null when it
 * must be served in place.
 *
 * @param host     the request Host header (may carry a port; may be undefined)
 * @param pathname the request path, without query or fragment
 * @param query    the parsed query, for the channel-overlay test
 * @param search   the raw query string including its leading `?`, carried across
 */
export function canonicalRedirectTarget(
  host: string | undefined,
  pathname: string,
  query: ParsedUrlQuery,
  search = '',
): string | null {
  /* Only the legacy compatibility hosts canonicalize. gxufy.com, localhost, a
     Vercel preview, and any unrecognised Host all fall through to null — the safe
     default, and what makes a redirect loop impossible. */
  if (!isLegacyHost(host)) return null;

  /* API routes are data endpoints the overlays and the browser call directly;
     forwarding one would break a request that expects a body, not a 3xx. */
  if (pathname === '/api' || pathname.startsWith('/api/')) return null;

  /* The counter overlay is permanent in exactly the way /multichat's overlay is,
     and it is only ever an overlay, so it is never forwarded. */
  if (pathname === '/counter') return null;

  /* A channel parameter makes /multichat or / a configured overlay. Checked
     through the one routing authority so this can never disagree with what the
     page itself decides to render. */
  if (
    (pathname === '/multichat' || pathname === '/') &&
    hasChannelParam(query)
  ) {
    return null;
  }

  /* Anything that is not one of the website's own pages — an unknown path, a
     deep link, a missing route — is left untouched, so its status is unchanged. */
  if (!CANONICALIZABLE_PATHS.has(pathname)) return null;

  /* The fixed canonical origin, never a value derived from the request. */
  return `${CANONICAL_ORIGIN}${pathname}${search}`;
}
