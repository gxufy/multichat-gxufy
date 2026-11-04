/* Optional per-tool runtime state, and the one place an overlay URL is built.
 *
 * A tool's settings and channels are enough to build every overlay URL the
 * workspace produces today. This module exists for the case that is coming:
 * a tool whose panel contributes something to the URL that is not a query
 * parameter. Rather than teaching the preview, the URL field, Copy, and Open
 * about it separately — four chances to disagree — the shell derives one
 * string here and hands the same string to all four.
 *
 * Deliberately not tool-specific: no field names a particular tool, and
 * nothing here knows what a fragment is for. A tool that needs no context
 * supplies none, and the output is identical to plain concatenation.
 *
 * Browser-safe — no server-only imports, no secrets. A fragment is never
 * written to the workspace's own address bar; it only ever appears inside the
 * generated overlay URL.
 */

/**
 * Workspace-level state a tool's own panel can contribute.
 *
 * Every field is optional, so `undefined` is a complete valid context. Fields
 * are added here only when a built tool needs one.
 */
export type ToolContext = {
  /**
   * Text placed after the URL's `#`. Supplied without the `#`, though a
   * leading one is tolerated. Blank or whitespace-only means "no fragment".
   */
  fragment?: string;
};

/**
 * The fragment part of a URL, including its `#`, or `''` when there is none.
 *
 * Leading `#` characters are stripped before exactly one is added, so a caller
 * that passes `'a=1'` and one that passes `'#a=1'` produce the same result and
 * `##` is unrepresentable.
 */
export function overlayFragment(context?: ToolContext): string {
  const raw = context?.fragment?.trim() ?? '';
  const body = raw.replace(/^#+/, '');
  return body.length > 0 ? `#${body}` : '';
}

/**
 * The overlay URL every consumer in the workspace uses.
 *
 * Built from parts each time rather than by appending to a previous result, so
 * deriving twice cannot produce two fragments. The query string is passed in
 * already serialized by the tool — this function never encodes, reorders, or
 * inspects it, and the fragment is kept strictly after it.
 */
export function buildOverlayUrl({
  baseUrl,
  route,
  query,
  context,
}: {
  baseUrl: string;
  /** Overlay route, leading slash included. */
  route: string;
  /** Serialized query string, without `?`. */
  query: string;
  context?: ToolContext;
}): string {
  return `${baseUrl}${route}?${query}${overlayFragment(context)}`;
}
