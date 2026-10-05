/* Preview background ids — the type only.
 *
 * Split out of components/workspace/PreviewBackground so that both the component
 * and lib/tools/registry can name the same union. The registry describes a tool's
 * optional demo panel, which receives the chosen background; typing that as a
 * bare `string` there would have let a panel accept a value the picker can never
 * produce, and having lib import a type from components would invert the
 * dependency direction the rest of lib/tools follows.
 *
 * The component re-exports these, so existing import sites are unchanged.
 *
 * Browser-safe — no server-only imports, no secrets.
 */

/** The three backdrops the preview offers. Workspace-only; never in a URL. */
export const PREVIEW_BACKGROUNDS = ['checker', 'dark', 'light'] as const;

export type PreviewBackgroundId = (typeof PREVIEW_BACKGROUNDS)[number];

/** Narrow an arbitrary string (e.g. from a restored draft) to a valid id. */
export function isPreviewBackgroundId(value: string): value is PreviewBackgroundId {
  return (PREVIEW_BACKGROUNDS as readonly string[]).includes(value);
}
