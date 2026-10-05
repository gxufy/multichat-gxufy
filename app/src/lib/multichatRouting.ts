/* What a visit to /multichat should actually do.
 *
 * `/multichat` carries two jobs, and this module is the one rule that decides
 * which one a given visit is:
 *
 *   - A query naming any channel is the overlay OBS loads. Those URLs sit in
 *     scene collections nobody will edit, so serving the overlay for them is a
 *     permanent commitment, not a migration step. Checked first, so nothing added
 *     later can preempt it.
 *   - Anything else — no channel at all — is a generator visit, and the generator
 *     is the revamped original Classic page rendered by this same route. Nothing
 *     redirects: the canonical generator address *is* `/multichat`.
 *
 * The page code-splits that generator branch, so this routing rule also keeps its
 * large editing UI out of an OBS browser source's startup bundle.
 *
 * The previous split (generator at /tools/multichat, original at
 * /classic/multichat) is gone. Both of those paths now redirect here.
 *
 * Deciding it here, as a pure function of the query, keeps the page from
 * expressing it as a chain of conditions that a later edit could reorder.
 */
import type { ParsedUrlQuery } from 'querystring';

/** Every parameter that names a channel. `channel` is the legacy Kick alias. */
export const MULTICHAT_CHANNEL_PARAMS = [
  'channel',
  'kick',
  'twitch',
  'youtube',
  'tiktok',
] as const;

/** The canonical generator address. A bare visit renders, never forwards. */
export const CANONICAL_MULTICHAT_ROUTE = '/multichat';

/**
 * The embedded Viewer Counter's anchor id.
 *
 * The counter is a panel inside the one generator rather than a route of its
 * own, so "go to the counter" is a fragment, not a path. Exported because three
 * places need to agree on it: the panel's `id`, the link that targets it, and
 * the redirect that retires `/tools/counter`.
 */
export const COUNTER_SECTION_ID = 'viewer-counter';

/** Where a request for the Counter generator lands. */
export const CANONICAL_COUNTER_ROUTE = `${CANONICAL_MULTICHAT_ROUTE}#${COUNTER_SECTION_ID}`;

/** Serve the overlay, or serve the generator. There is no third answer. */
export type MultichatRoute =
  | { readonly kind: 'overlay' }
  | { readonly kind: 'generator' };

/**
 * Whether a query value names a channel.
 *
 * An empty value does not: `?kick=` is what an unfilled form submits, and
 * treating it as a channel would serve an overlay that can never connect to
 * anything. Repeated parameters arrive as an array and count if any entry is
 * non-empty, so `?kick=&kick=name` is still an overlay request.
 */
function namesChannel(value: string | string[] | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((entry) => entry.trim().length > 0);
  return false;
}

/** True when this query configures at least one channel. */
export function hasChannelParam(query: ParsedUrlQuery): boolean {
  return MULTICHAT_CHANNEL_PARAMS.some((param) => namesChannel(query[param]));
}

/**
 * What a `/multichat` visit resolves to.
 *
 * Channel parameters win outright: an overlay URL that happens to carry
 * `tab=counter`, an OAuth fragment, or any other generator-shaped input still
 * renders chat, so no scene that works today can be redirected or re-rendered
 * out from under itself.
 *
 * A pure function of the query, with no hash argument, because the generator now
 * lives at this address: a fragment no longer has to survive a forward, it is
 * simply read by the page that renders here.
 */
export function resolveMultichatRoute(query: ParsedUrlQuery): MultichatRoute {
  return hasChannelParam(query) ? { kind: 'overlay' } : { kind: 'generator' };
}

/**
 * Whether this visit asked for the Viewer Counter panel specifically.
 *
 * Two spellings, because two different eras of link exist: `?tab=counter` is
 * what the original generator's counter tab used and what old bookmarks carry,
 * and `#viewer-counter` is the current anchor. Both mean "start me at the
 * counter", and both are honoured on a generator visit only.
 *
 * A repeated `tab` is not honoured: it is ambiguous, and the safe reading of an
 * ambiguous request is the top of the generator.
 */
export function wantsCounterSection(query: ParsedUrlQuery, hash = ''): boolean {
  if (query['tab'] === 'counter') return true;
  return hash.replace(/^#/, '') === COUNTER_SECTION_ID;
}
