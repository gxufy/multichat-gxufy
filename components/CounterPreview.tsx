/* CounterPreview — landing-page live preview of the /counter overlay.
 * Mirrors counter.tsx styling exactly (pill, glass bg, icon boxes,
 * rolling number) but feeds fake per-platform counts that drift every
 * few seconds so the animation is visible. Order matches ORDER in
 * counter.tsx: twitch → youtube → kick → tiktok.
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

/* base fake counts per platform (drift ±3% every tick) */
const BASE: Record<Plat, number> = { twitch: 12483, youtube: 3921, kick: 8117, tiktok: 1354 };

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

export default function CounterPreview({ combined, font, icons, bg, textSize, textShadow, stroke }: {
  combined: boolean; font: string; icons: boolean; bg: boolean;
  textSize: string; textShadow: string; stroke: string;
}) {
  const [counts, setCounts] = useState<Record<Plat, number>>({ ...BASE });

  useEffect(() => {
    const iv = setInterval(() => {
      setCounts(prev => {
        const next = { ...prev };
        for (const p of ORDER) {
          const drift = Math.round(BASE[p] * (Math.random() * 0.06 - 0.03));
          next[p] = Math.max(0, prev[p] + drift);
        }
        return next;
      });
    }, 2500);
    return () => clearInterval(iv);
  }, []);

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

  const iconBox = (p: Plat) => (
    <span key={p} style={{ height: iconSize, width: iconSize, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {ICONS[p]}
    </span>
  );

  const total = ORDER.reduce((n, p) => n + counts[p], 0);

  return (
    <>
      <style>{`
        @font-face { font-family: 'Montserrat'; src: url('/fonts/Montserrat-SemiBold.ttf') format('truetype'); font-weight: 700; }
        @font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; }
      `}</style>
      <div style={{ display: 'flex', gap: Math.round(fontSize * 0.5), flexWrap: 'wrap' }}>
        {combined ? (
          <div style={pill}>
            {icons && ORDER.map(iconBox)}
            <RollingCount value={total} fontSize={fontSize} />
          </div>
        ) : (
          ORDER.map(p => (
            <div key={p} style={pill}>
              {icons && iconBox(p)}
              <RollingCount value={counts[p]} fontSize={fontSize} />
            </div>
          ))
        )}
      </div>
    </>
  );
}
