
import {
  PREVIEW_BACKGROUNDS,
  isPreviewBackgroundId,
  type PreviewBackgroundId,
} from '@/lib/tools/previewBackground';

/** The four modes: the three fixed backdrops plus a user colour. */
export type PreviewBgMode = PreviewBackgroundId | 'custom';

export const PREVIEW_BG_MODES: readonly PreviewBgMode[] = [
  ...PREVIEW_BACKGROUNDS,
  'custom',
];

/* The grey the old two-state "Light background" produced, kept as the starting
   custom colour so the option that replaced it can still reach the same value. */
export const DEFAULT_PREVIEW_CUSTOM_COLOR = '#46464e';

const LABELS: Record<PreviewBgMode, string> = {
  checker: 'Transparent',
  dark: 'Dark',
  light: 'Light',
  custom: 'Custom',
};

/* The class each fixed backdrop carries on `.preview-surface`. Custom has none —
   its colour is applied inline — and "checker" keeps its historical class name. */
const SURFACE_CLASS: Record<PreviewBgMode, string> = {
  checker: 'checkered',
  dark: 'dark',
  light: 'light',
  custom: '',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** A six-digit hex colour, the only shape `<input type=color>` round-trips. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** The value that persists to a draft and drives the surface: a named id for the
 *  three fixed backdrops, or the hex string itself for Custom. Never a URL. */
export function effectivePreviewBackground(
  mode: PreviewBgMode,
  customColor: string,
): string {
  return mode === 'custom' ? customColor : mode;
}

/** The inverse, for restoring a draft. A valid id restores that mode; a hex
 *  restores Custom with that colour; anything else falls back to Transparent. */
export function previewBackgroundFromDraft(value: string): {
  mode: PreviewBgMode;
  customColor: string;
} {
  if (isPreviewBackgroundId(value)) {
    return { mode: value, customColor: DEFAULT_PREVIEW_CUSTOM_COLOR };
  }
  if (isHexColor(value)) return { mode: 'custom', customColor: value };
  return { mode: 'checker', customColor: DEFAULT_PREVIEW_CUSTOM_COLOR };
}

/** The `.preview-surface` modifier class for a mode ('' for Custom). */
export function previewSurfaceClass(mode: PreviewBgMode): string {
  return SURFACE_CLASS[mode];
}

const POGLY_WIDGET_URL: Record<string, string> = {
  chat: 'https://widget.pogly.gg/4105',
  counter: 'https://widget.pogly.gg/4106',
};

const POGLY_ICON_URL = '/images/pogly.png';

export default function ClassicPreviewBackgroundControl({
  idPrefix,
  legend,
  mode,
  customColor,
  onModeChange,
  onCustomColorChange,
}: {
  /** Unique per preview, so the two groups' radio ids and `name`s never couple. */
  idPrefix: string;
  legend: string;
  mode: PreviewBgMode;
  customColor: string;
  onModeChange: (next: PreviewBgMode) => void;
  onCustomColorChange: (next: string) => void;
}) {
  const name = `${idPrefix}-preview-bg`;
  const helpId = `${idPrefix}-preview-bg-help`;
  const colorId = `${idPrefix}-preview-bg-color`;
  return (
    <fieldset className="classic-seg preview-bg" aria-describedby={helpId}>
      <legend>{legend}</legend>
      <div className="classic-seg-row">
        {PREVIEW_BG_MODES.map((option) => {
          const id = `${idPrefix}-preview-bg-${option}`;
          return (
            <span className="classic-seg-item" key={option}>
              <input
                type="radio"
                id={id}
                name={name}
                value={option}
                checked={mode === option}
                onChange={() => onModeChange(option)}
              />
              <label
                htmlFor={id}
                className={`classic-seg-label${mode === option ? ' on' : ''}`}
              >
                {LABELS[option]}
              </label>
            </span>
          );
        })}
      </div>
      {mode === 'custom' && (
        <div className="preview-bg-custom">
          <label htmlFor={colorId}>Custom colour</label>
          <input
            type="color"
            id={colorId}
            value={isHexColor(customColor) ? customColor : DEFAULT_PREVIEW_CUSTOM_COLOR}
            onChange={(event) => onCustomColorChange(event.target.value)}
          />
        </div>
      )}
      <p className="sr-only" id={helpId}>
        Sets this preview&apos;s backdrop only. The overlay and its URL are unchanged.
      </p>
      {POGLY_WIDGET_URL[idPrefix] ? (
        <a
          className="pogly-widget-button"
          href={POGLY_WIDGET_URL[idPrefix]}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src={POGLY_ICON_URL}
            alt="Pogly"
            width={18}
            height={18}
            style={{ flex: '0 0 auto', objectFit: 'contain', marginRight: 7 }}
          />
          Pogly Widget
        </a>
      ) : null}
    </fieldset>
  );
}
