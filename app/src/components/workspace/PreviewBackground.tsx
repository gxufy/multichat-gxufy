/* Preview background selector and surface.
 *
 * Workspace-only state. The chosen background is applied to the container that
 * *wraps* the iframe — never injected into the overlay document, never added to
 * the generated URL. It exists so transparency can be eyeballed against light
 * and dark scenes; it cannot affect what OBS renders.
 */
import type { ReactNode } from 'react';

/* The ids and their guard live in lib/tools/previewBackground so that
   lib/tools/registry can type a demo panel's `background` prop as this union
   rather than as `string`. Re-exported here so every existing import site keeps
   working and there is still one definition. */
export {
  PREVIEW_BACKGROUNDS,
  isPreviewBackgroundId,
  type PreviewBackgroundId,
} from '@/lib/tools/previewBackground';

/* Imported as well as re-exported: a re-export does not bind the name in this
   module's own scope, and the picker below iterates the list. */
import {
  PREVIEW_BACKGROUNDS,
  type PreviewBackgroundId,
} from '@/lib/tools/previewBackground';

const LABELS: Record<PreviewBackgroundId, string> = {
  checker: 'Transparent',
  dark: 'Dark',
  light: 'Light',
};

/* Checkerboard drawn with two conic gradients so no image asset is needed. */
const CHECKER_STYLE = {
  backgroundColor: '#2a2a2a',
  backgroundImage:
    'conic-gradient(from 90deg at 1px 1px, #0000 25%, #3a3a3a 0) ,' +
    'conic-gradient(#3a3a3a 25%, #242424 0 50%, #3a3a3a 0 75%, #242424 0)',
  backgroundSize: '16px 16px',
} as const;

/**
 * Radio group choosing the preview backdrop.
 *
 * Native `input type="radio"` in a real fieldset, styled to look like the button
 * row it replaces. This was previously three `role="radio"` buttons, which is the
 * ARIA pattern without the behaviour it promises: a radiogroup is expected to be
 * one tab stop with arrow keys moving between options, and separate buttons are
 * three tab stops with no arrow handling. Native inputs get roving focus, arrow
 * keys, and group semantics from the platform, so there is nothing to keep in
 * sync — the same reason MultiSelect uses native checkboxes.
 *
 * The visible control is the label; the input itself is `sr-only` and remains the
 * focus target, so `peer-focus-visible` draws the ring on the label.
 */
export function PreviewBackgroundPicker({
  value,
  onChange,
}: {
  value: PreviewBackgroundId;
  onChange: (next: PreviewBackgroundId) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ws-muted">
        Preview background
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {PREVIEW_BACKGROUNDS.map((id) => {
          const active = id === value;
          return (
            <div key={id} className="flex">
              <input
                id={`preview-background-${id}`}
                type="radio"
                name="preview-background"
                value={id}
                checked={active}
                onChange={() => onChange(id)}
                className="peer sr-only"
              />
              <label
                htmlFor={`preview-background-${id}`}
                className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ws-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ws-surface motion-reduce:transition-none ${
                  active
                    ? 'border-ws-accent bg-ws-accent/20 text-ws-text'
                    : 'border-ws-border bg-ws-control text-ws-muted hover:bg-ws-control-hover'
                }`}
              >
                {LABELS[id]}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The backdrop container. Styling stops at this element. */
export default function PreviewBackground({
  background,
  children,
}: {
  background: PreviewBackgroundId;
  children: ReactNode;
}) {
  const style =
    background === 'checker'
      ? CHECKER_STYLE
      : background === 'light'
        ? { backgroundColor: '#f4f4f5' }
        : { backgroundColor: '#141414' };

  return (
    <div
      style={style}
      className="overflow-hidden rounded-lg border border-ws-border"
    >
      {children}
    </div>
  );
}
