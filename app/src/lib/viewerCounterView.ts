/*
 * What the viewer counter draws, worked out once: the counter
 * (web/src/lib/overlay/counter, for /counter, /audience and the generator
 * preview) only turns this into elements.
 *
 * Style values carry their units as strings ("13px"); font weight stays a
 * number, which is unitless.
 */
import {
  LOCAL_OVERLAY_FONT_CSS,
  OVERLAY_FONT_FAMILIES,
  googleFontValue,
  normalizeGoogleFontFamily,
  overlayFontRequestCss,
} from './overlayFonts';
import {
  COUNTER_FONT_FAMILY,
  COUNTER_FONT_SIZE_PX_BY_PRESET,
  PLATFORM_ORDER,
  normalizeCounterStyle,
  summarize,
  visiblePlatforms,
  type PlatformStatuses,
  type ViewerCounterStyle,
  type ViewerPlatform,
} from './viewerCounterConfig';
import { TWITCH_PLATFORM_ICON_SRC } from './platformAssets';

/** Shown when a platform is live but its count is not determinable. */
export const COUNTER_UNAVAILABLE_MARK = '—';

/** Duration of the rolling-number animation. */
export const COUNTER_ROLL_DURATION_MS = 600;

/**
 * Default font and entrance-animation rules, emitted by the renderer so the
 * standalone overlay and the generator preview always get the same baseline.
 * A validated custom Google family is imported ahead of this block and applied
 * to the pill inline, keeping legacy/default URLs network-free.
 */
export const COUNTER_BASE_CSS = `
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }
@keyframes vcIn { from { opacity: 0; transform: translateX(-8px) scale(0.85); } to { opacity: 1; transform: none; } }
`;

/**
 * The counter page's own rules: a transparent, unscrolled page for the OBS
 * browser source, and block SVGs. The counter pages put this in the head.
 */
export const COUNTER_PAGE_CSS =
  'html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }\nsvg { display: block; }';

/** The page's wrapper around the counter: an 8px inset across the source. */
export const COUNTER_INSET_STYLE = { padding: '8px', boxSizing: 'border-box', width: '100%' } as const;

/*
 * Platform marks. Kick's blocky K reads denser than the other marks, so it is
 * drawn slightly smaller inside its box so all icons appear the same size.
 * YouTube stays an external image rather than an inline SVG: the chat overlay
 * has global SVG/path rules for badges and emotes, and an <img> is isolated
 * from them, so the red lozenge cannot collapse into only the white triangle.
 */
export const COUNTER_KICK_ICON = {
  viewBox: '0 0 24 24',
  fill: '#53FC19',
  path: 'M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z',
  style: { height: '78%', width: 'auto', margin: 'auto' },
} as const;

export const COUNTER_ICON_IMAGES: Readonly<Record<Exclude<ViewerPlatform, 'kick'>, string>> = {
  twitch: TWITCH_PLATFORM_ICON_SRC,
  youtube: '/platform-youtube.svg',
  tiktok: '/platform-tiktok.png',
};

export const COUNTER_ICON_IMAGE_STYLE = { height: '100%', width: 'auto' } as const;

/** A style declaration in React's object shape (camelCase, values as written). */
export type CounterStyleDeclaration = Readonly<Record<string, string | number>>;

/** One pill: its platform icons, then a count (null shows the unavailable mark). */
export type CounterPill = {
  key: string;
  icons: ViewerPlatform[];
  count: number | null;
};

export type ViewerCounterView = {
  /** Font requests plus COUNTER_BASE_CSS, for one <style> before the row. */
  css: string;
  row: CounterStyleDeclaration;
  pill: CounterStyleDeclaration;
  iconBox: CounterStyleDeclaration;
  number: CounterStyleDeclaration;
  pills: CounterPill[];
};

const STROKES: Readonly<Record<string, string>> = {
  thin: '1px black',
  medium: '2px black',
  thick: '3px black',
  thicker: '4px black',
};

const px = (value: number) => `${value}px`;

export function viewerCounterView(statuses: PlatformStatuses, style: ViewerCounterStyle): ViewerCounterView {
  /* Direct callers may still pass the pre-Typography style shape. Normalize at
     the renderer boundary so those calls receive the exact legacy defaults. */
  const safe = normalizeCounterStyle(style);
  const fontSize = COUNTER_FONT_SIZE_PX_BY_PRESET[safe.textSize!];
  const iconSize = Math.round(fontSize * 0.9);
  const gapInner = Math.round(fontSize * 0.28);
  const gapOuter = Math.round(fontSize * 0.5);
  const padY = Math.round(fontSize * 0.22);
  const padX = Math.round(fontSize * 0.5);

  /* Shadow and stroke come only from the counter's own style config, never
     from MultiChat's state, so restyling chat cannot change an already
     generated counter URL. */
  const shadow =
    safe.textShadow === 'small' ? 'drop-shadow(2px 2px 0.2rem black)' :
    safe.textShadow === 'medium' ? 'drop-shadow(2px 2px 0.35rem black)' :
    safe.textShadow === 'large' ? 'drop-shadow(2px 2px 0.5rem black)' : '';
  const stroke = STROKES[safe.stroke] ?? '';

  /* Defense in depth: style normally arrives through the shared normalizer, but
     this validates again so a direct caller can never inject CSS. */
  const googleFamily = normalizeGoogleFontFamily(safe.googleFont);
  const googleValue = googleFontValue(googleFamily);
  const presetFont = safe.font === 'dejavu' ? undefined : safe.font;
  const selectedFont = googleValue ?? presetFont;
  const requestCss = overlayFontRequestCss(selectedFont, {
    fontWeight: safe.fontWeight,
    fontItalic: safe.fontItalic,
  });
  const fontFamily = googleFamily
    ? `'${googleFamily}', ${COUNTER_FONT_FAMILY}`
    : presetFont
      ? OVERLAY_FONT_FAMILIES[presetFont] ?? COUNTER_FONT_FAMILY
      : COUNTER_FONT_FAMILY;
  const localPresetCss = presetFont === 'geist'
    ? LOCAL_OVERLAY_FONT_CSS
    : presetFont === 'alsina'
      ? "@font-face { font-family: Alsina; src: url('/fonts/Alsina_Ultrajada.ttf'); font-display: swap; }"
      : '';
  const css = [requestCss, localPresetCss, COUNTER_BASE_CSS].filter(Boolean).join('\n');

  const pill: Record<string, string | number> = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: px(gapInner),
    ...(safe.bg
      ? {
          background: 'rgba(20,20,24,0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderRadius: px(999),
          padding: `${padY}px ${padX}px`,
        }
      : {}),
    fontFamily,
    fontWeight: safe.fontWeight,
    ...(safe.fontItalic ? { fontStyle: 'italic' } : {}),
    ...(safe.textTransform === 'none' ? {} : { textTransform: safe.textTransform }),
    color: safe.fontColor,
    ...(shadow ? { filter: shadow } : {}),
    ...(stroke ? { WebkitTextStroke: stroke } : {}),
    transition: 'all 400ms ease',
  };

  const justify =
    safe.align === 'center' ? 'center' : safe.align === 'right' ? 'flex-end' : 'flex-start';

  const row = {
    display: 'flex',
    gap: px(gapOuter),
    flexWrap: 'wrap',
    justifyContent: justify,
    width: '100%',
    boxSizing: 'border-box',
  };

  const iconBox = {
    height: px(iconSize),
    width: px(iconSize),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'vcIn 400ms ease',
  };

  const number = { fontSize: px(fontSize), fontVariantNumeric: 'tabular-nums' };

  const summary = summarize(statuses);
  let pills: CounterPill[];
  if (safe.combined) {
    /* Nothing configured yet, or every platform confirmed offline: no pill at
       all rather than a fabricated zero. */
    pills = summary.hasPresence
      ? [{
          key: 'combined',
          icons: safe.icons ? visiblePlatforms(statuses) : [],
          count: summary.hasMeasured ? summary.total : null,
        }]
      : [];
  } else {
    pills = PLATFORM_ORDER.flatMap((platform): CounterPill[] => {
      const status = statuses[platform];
      if (status?.state !== 'live' && status?.state !== 'live-unknown') return [];
      return [{
        key: platform,
        icons: safe.icons ? [platform] : [],
        count: status.state === 'live' ? status.viewers : null,
      }];
    });
  }

  return { css, row, pill, iconBox, number, pills };
}

/** The rolling number at progress t (0..1) from `from` to `to`: ease-out cubic, rounded. */
export function rollingCountAt(from: number, to: number, t: number): number {
  const eased = 1 - Math.pow(1 - Math.min(t, 1), 3);
  return Math.round(from + (to - from) * eased);
}
