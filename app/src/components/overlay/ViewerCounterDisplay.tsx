/* ViewerCounterDisplay — the single viewer-counter renderer.
 *
 * Used by both the standalone /counter overlay and the generator preview,
 * so the two cannot drift apart. It is presentation-only: it receives
 * per-platform statuses and a style config and renders them. It never
 * fetches, polls, or knows where the numbers came from.
 *
 * Layout is intrinsic (inline-flex pills, no fixed width) so it adapts to
 * any OBS browser-source size. It sets no page background or margin —
 * transparency is the host page's concern.
 */
import { useEffect, useRef, useState } from 'react';
import {
  LOCAL_OVERLAY_FONT_CSS,
  OVERLAY_FONT_FAMILIES,
  googleFontValue,
  normalizeGoogleFontFamily,
  overlayFontRequestCss,
} from '../../lib/overlayFonts';
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
} from '../../lib/viewerCounterConfig';
import { TWITCH_PLATFORM_ICON_SRC } from '../../lib/platformAssets';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Shown when a platform is live but its count is not determinable. */
const UNAVAILABLE_MARK = '—';

/** Duration of the rolling-number animation. */
const ROLL_DURATION_MS = 600;

/**
 * Default font and entrance-animation rules, emitted by the shared renderer so
 * the standalone overlay and the generator preview always get the same baseline.
 * A validated custom Google family is imported ahead of this block at render
 * time and applied to the pill inline, keeping legacy/default URLs network-free.
 */
const FONT_CSS = `
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; font-display: swap; }
@keyframes vcIn { from { opacity: 0; transform: translateX(-8px) scale(0.85); } to { opacity: 1; transform: none; } }
`;

const ICONS: Record<ViewerPlatform, JSX.Element> = {
  // Kick's blocky K reads denser than the other marks — render it slightly
  // smaller inside its box so all icons appear the same size.
  kick: (
    <svg viewBox="0 0 24 24" fill="#53FC19" style={{ height: '78%', width: 'auto', margin: 'auto' }}>
      <path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z" />
    </svg>
  ),
  twitch: <img src={TWITCH_PLATFORM_ICON_SRC} alt="" draggable={false} style={{ height: '100%', width: 'auto' }} />,
  /* Keep YouTube in an external asset instead of an inline SVG. The overlay has
     global SVG/path rules for chat badges and emotes; an <img> is isolated from
     those rules, so the red lozenge cannot collapse into only the white play
     triangle in the viewer counter. */
  youtube: <img src="/platform-youtube.svg" alt="" draggable={false} style={{ height: '100%', width: 'auto' }} />,
  tiktok: <img src="/platform-tiktok.png" alt="" draggable={false} style={{ height: '100%', width: 'auto' }} />,
};

/* ------------------------------------------------------------------ */
/* Rolling number                                                      */
/* ------------------------------------------------------------------ */

/**
 * Eases from the previous value to the next over {@link ROLL_DURATION_MS}.
 *
 * The effect depends only on `value`, so restyling (shadow, stroke,
 * alignment, font) never restarts an animation.
 */
function RollingCount({ value, fontSize }: { value: number; fontSize: number }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / ROLL_DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return (
    <span style={{ fontSize, fontVariantNumeric: 'tabular-nums' }}>
      {shown.toLocaleString()}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type ViewerCounterDisplayProps = {
  statuses: PlatformStatuses;
  style: ViewerCounterStyle;
};

export default function ViewerCounterDisplay({
  statuses,
  style,
}: ViewerCounterDisplayProps) {
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

  const strokeCss = ({
    thin: '1px black',
    medium: '2px black',
    thick: '3px black',
    thicker: '4px black',
  } as Record<string, string>)[safe.stroke] ?? '';

  /* Defense in depth: style normally arrives through the shared normalizer, but
     the renderer validates again so a direct caller can never inject CSS. */
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
  const rendererCss = [requestCss, localPresetCss, FONT_CSS].filter(Boolean).join('\n');

  const pill: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: gapInner,
    ...(safe.bg
      ? {
          background: 'rgba(20,20,24,0.45)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderRadius: 999,
          padding: `${padY}px ${padX}px`,
        }
      : {}),
    fontFamily,
    fontWeight: safe.fontWeight,
    fontStyle: safe.fontItalic ? 'italic' : undefined,
    textTransform: safe.textTransform === 'none' ? undefined : safe.textTransform,
    color: safe.fontColor,
    ...(shadow ? { filter: shadow } : {}),
    ...(strokeCss ? { WebkitTextStroke: strokeCss } : {}),
    transition: 'all 400ms ease',
  };

  const iconBox = (platform: ViewerPlatform) => (
    <span
      key={`icon-${platform}`}
      style={{
        height: iconSize,
        width: iconSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'vcIn 400ms ease',
      }}
    >
      {ICONS[platform]}
    </span>
  );

  const unavailableNode = (
    <span style={{ fontSize, fontVariantNumeric: 'tabular-nums' }}>
      {UNAVAILABLE_MARK}
    </span>
  );

  const justify =
    safe.align === 'center' ? 'center' : safe.align === 'right' ? 'flex-end' : 'flex-start';

  const visible = visiblePlatforms(statuses);
  const summary = summarize(statuses);

  /* Nothing configured yet, or every platform confirmed offline: render
     nothing at all rather than a fabricated zero. */
  const showCombined = safe.combined && summary.hasPresence;

  return (
    <>
      {/* A style element is raw text in HTML. React's server serializer escapes
          apostrophes in a normal text child, which browsers preserve literally
          inside <style>, while the client renders the original CSS. Emitting
          the same validated CSS bytes on both sides keeps hydration exact. */}
      <style dangerouslySetInnerHTML={{ __html: rendererCss }} />
    <div
      style={{
        display: 'flex',
        gap: gapOuter,
        flexWrap: 'wrap',
        justifyContent: justify,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {safe.combined
        ? showCombined && (
            <div style={pill}>
              {safe.icons && visible.map(iconBox)}
              {summary.hasMeasured ? (
                <RollingCount value={summary.total} fontSize={fontSize} />
              ) : (
                unavailableNode
              )}
            </div>
          )
        : PLATFORM_ORDER.filter((platform) => {
            const status = statuses[platform];
            return status?.state === 'live' || status?.state === 'live-unknown';
          }).map((platform) => {
            const status = statuses[platform]!;
            return (
              <div key={platform} style={pill}>
                {safe.icons && iconBox(platform)}
                {status.state === 'live' ? (
                  <RollingCount value={status.viewers} fontSize={fontSize} />
                ) : (
                  unavailableNode
                )}
              </div>
            );
          })}
    </div>
    </>
  );
}
