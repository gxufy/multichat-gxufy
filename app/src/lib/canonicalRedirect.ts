/* The one rule that decides whether a request is forwarded to another domain.
 *
 * Three production domains serve the same app:
 *
 *   - flosschat.app is the canonical home of the tools. Its bare root IS the
 *     generator (served from /multichat by the rewrite in next.config.js); a
 *     bare /multichat there forwards to the root.
 *     Overlay URLs keep their /multichat?… form everywhere.
 *   - gxufy.com keeps the Gxufy homepage at `/`. Its tool pages forward to
 *     flosschat.app.
 *   - multichat-gxufy.com is the older compatibility domain. Its landing page
 *     forwards to the gxufy.com homepage and its tool pages to flosschat.app.
 *
 * The decision is deliberately conservative:
 *
 *   - It never touches an overlay. Any /api route, the /counter and /audience
 *     overlays, and a channel-carrying /multichat or / are served in place on
 *     every domain — those are the URLs sitting in OBS scene collections, and
 *     moving one blacks out a live stream. The channel test is the single routing
 *     authority (hasChannelParam), not a second copy of the rule.
 *   - It forwards only the website's own pages, and only to fixed origins. The
 *     Host header is classified but never concatenated into the target, so a
 *     forged Host cannot open a redirect off-site. An unrecognised Host, and
 *     localhost, are left alone.
 *   - No target ever redirects again: a forwarded tool page lands on
 *     flosschat.app, where only a bare /multichat moves (to the root, which is
 *     rewritten, not redirected), and the gxufy.com homepage never moves.
 *
 * A pure function of (host, pathname, query), with the query string carried across
 * verbatim. Fragments are not visible server-side, but a browser reapplies the
 * original fragment to a redirect Location that has none, so an OAuth fragment on
 * a retired stub still survives the hop.
 */
import type { ParsedUrlQuery } from 'querystring';
import {
  CANONICAL_ORIGIN,
  HOME_ORIGIN,
  isCanonicalHost,
  isHomeHost,
  isLegacyHost,
} from '@/lib/domains.mjs';
import { hasChannelParam } from '@/lib/multichatRouting';

/**
 * The website's tool pages — forwarded to flosschat.app from gxufy.com and the
 * legacy domain. Everything else (an unknown path, an overlay, an API route) is
 * left where it is, so a 404 stays a 404 and no scene URL moves.
 *
 * `/tools/multichat`, `/tools/counter`, and `/classic/multichat` are retired
 * redirect stubs rather than overlays, so forwarding them is safe regardless of
 * any query they carry; each stub then does its own client-side forward to
 * /multichat, OAuth fragment and all.
 */
const TOOL_PATHS = new Set([
  '/tools/multichat',
  '/tools/counter',
  '/classic/multichat',
  '/badges',
  '/support',
]);

/** Paths that are only ever overlays or data endpoints, on every domain. */
function isOverlayOrApi(pathname: string): boolean {
  return pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/counter'
    || pathname === '/audience';
}

/**
 * The absolute URL a request should be redirected to, or null when it must be
 * served in place.
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
  const canonical = isCanonicalHost(host);
  const home = isHomeHost(host);
  const legacy = isLegacyHost(host);
  /* localhost and any unrecognised Host fall through to null — the safe default. */
  if (!canonical && !home && !legacy) return null;

  /* Overlays and data endpoints are served in place on every domain. */
  if (isOverlayOrApi(pathname)) return null;

  /* A channel parameter makes /multichat or / a configured overlay. Checked
     through the one routing authority so this can never disagree with what the
     page itself decides to render. */
  if ((pathname === '/multichat' || pathname === '/') && hasChannelParam(query)) {
    return null;
  }

  /* The generator's address is the flosschat.app root, from every domain. */
  if (pathname === '/multichat') return `${CANONICAL_ORIGIN}/${search}`;

  if (canonical) return null;

  if (pathname === '/') {
    /* gxufy.com's root is the homepage; the legacy domain's root forwards to it. */
    return legacy ? `${HOME_ORIGIN}/${search}` : null;
  }

  if (!TOOL_PATHS.has(pathname)) return null;

  /* The fixed canonical origin, never a value derived from the request. */
  return `${CANONICAL_ORIGIN}${pathname}${search}`;
}
