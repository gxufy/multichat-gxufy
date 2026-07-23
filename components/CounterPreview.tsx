/* CounterPreview — purely presentational viewer counter preview.
 *
 * Accepts pre-fetched viewer data from a parent hook (useViewerCounts)
 * and renders it in the StreamNook counter-pill style.
 *
 * Modes:
 *   - combined: single pill with all icons + total count
 *   - per-platform: one pill per live platform
 *
 * States rendered:
 *   - loading (null data): icon + placeholder "—"
 *   - offline: icon + "0"
 *   - error: icon + small "err" text
 *   - live: icon + rolling count
 */
import { useEffect, useRef, useState } from 'react';

type Plat = 'twitch' | 'youtube' | 'kick' | 'tiktok';
const ORDER: Plat[] = ['twitch', 'youtube', 'kick', 'tiktok'];

const SIZES = { small: 22, medium: 34, large: 48 } as const;

const ICONS: Record<Plat, JSX.Element> = {
  kick: <svg viewBox="0 0 24 24" fill="#53FC19" style={{ height: '78%', width: 'auto', margin: 'auto' }}><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>,
  twitch: <img src="/platform-twitch.png" alt="Twitch" style={{ height: '100%', width: 'auto' }} />,
  youtube: (
    <svg viewBox="0 0 24 24" style={{ height: '100%', width: 'auto' }}>
      <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
      <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12z"/>
    </svg>
  ),
  tiktok: <img src="/platform-tiktok.png" alt="TikTok" style={{ height: '100%', width: 'auto' }} />,
};

export interface ViewerResult {
  viewers: number;
  live: boolean;
  error?: string;
}

interface Props {
  combined: boolean;
  font: string;
  icons: boolean;
  bg: boolean;
  textSize: string;
  textShadow: string;
  stroke: string;
  /* Pre-fetched viewer data — null means still loading. */
  counts: Record<Plat, ViewerResult | null>;
  loading: boolean;
  hasError: boolean;
  combinedValue: number;
}

/* ── RollingCount ──────────────────────────────────────────────────────── */

function RollingCount({ value, fontSize }: { value: number; fontSize: number }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>();
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const dur = 600;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);
  return <span style={{ fontSize, fontVariantNumeric: 'tabular-nums' }}>{shown.toLocaleString()}</span>;
}

/* ── Loading placeholder ───────────────────────────────────────────────── */

function LoadingPlaceholder({ fontSize }: { fontSize: number }) {
  return (
    <span style={{
      fontSize, fontVariantNumeric: 'tabular-nums', opacity: 0.5,
      display: 'inline-block', width: `${fontSize * 3}px`, textAlign: 'center',
    }}>
      —
    </span>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function CounterPreview({
  combined, font, icons, bg, textSize, textShadow, stroke,
  counts, loading, hasError, combinedValue,
}: Props) {
  const fontFamily = font === 'montserrat' ? "'Montserrat', sans-serif" : "'DejaVu Sans', sans-serif";
  const fontSize = SIZES[(textSize as keyof typeof SIZES)] ?? SIZES.medium;
  const iconSize = Math.round(fontSize * 0.9);

  const shadow =
    textShadow === 'small' ? 'drop-shadow(2px 2px 0.2rem black)' :
    textShadow === 'medium' ? 'drop-shadow(2px 2px 0.35rem black)' :
    textShadow === 'large' ? 'drop-shadow(2px 2px 0.5rem black)' : '';
  const strokeCss = ({ thin: '1px black', medium: '2px black', thick: '3px black', thicker: '4px black' } as Record<string, string>)[stroke] ?? '';

  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: Math.round(fontSize * 0.28),
    ...(bg ? { background: 'rgba(20,20,24,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', borderRadius: 999, padding: `${Math.round(fontSize * 0.22)}px ${Math.round(fontSize * 0.5)}px` } : {}),
    fontFamily, fontWeight: 700, color: '#fff',
    ...(shadow ? { filter: shadow } : {}),
    ...(strokeCss ? { WebkitTextStroke: strokeCss } : {}),
  };

  /* Platforms with non-null data (loaded or error). */
  const activePlats = ORDER.filter(p => counts[p] !== null);
  const hasData = activePlats.length > 0;

  const iconBox = (p: Plat) => (
    <span key={p} style={{ height: iconSize, width: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {ICONS[p]}
    </span>
  );

  const platformCount = (p: Plat) => {
    const r = counts[p];
    if (r === null) return <LoadingPlaceholder fontSize={fontSize} />;
    if (r.error) return <span style={{ fontSize: fontSize * 0.7, color: '#ff6b6b' }}>err</span>;
    if (!r.live || r.viewers === 0) return <RollingCount value={0} fontSize={fontSize} />;
    return <RollingCount value={r.viewers} fontSize={fontSize} />;
  };

  return (
    <>
      <style>{`
        @font-face { font-family: 'Montserrat'; src: url('/fonts/Montserrat-SemiBold.ttf') format('truetype'); font-weight: 700; }
        @font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; }
      `}</style>

      {!hasData ? (
        <div style={{
          fontSize: Math.round(fontSize * 0.8), color: '#888',
          textAlign: 'center', padding: '8px 0', fontStyle: 'italic',
        }}>
          Enter a channel to preview viewer counts
        </div>
      ) : combined ? (
        <div style={pill}>
          {icons && activePlats.map(iconBox)}
          {loading ? (
            <LoadingPlaceholder fontSize={fontSize} />
          ) : (
            <RollingCount value={combinedValue} fontSize={fontSize} />
          )}
          {hasError && (
            <span style={{ fontSize: fontSize * 0.55, color: '#ff6b6b', marginLeft: 4 }}>!</span>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: Math.round(fontSize * 0.5), flexWrap: 'wrap' }}>
          {activePlats.map(p => (
            <div key={p} style={pill}>
              {icons && iconBox(p)}
              {platformCount(p)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
