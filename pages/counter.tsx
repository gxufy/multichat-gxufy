/* /counter — real-time combined viewer count overlay (OBS browser source).
 *
 * ?kick=x&twitch=y&youtube=z&tiktok=w
 *  &metric=live|avg|peak   displayed number (default live)
 *  &combined=true|false    one combined pill vs per-platform counts (default true)
 *  &font=montserrat|dejavu textSize/textShadow/stroke like the chat overlay
 *  &icons=true|false
 *
 * Look: StreamNook counter pill — platform icons + bold count on a dark
 * rounded pill. Platforms slide out when they go offline and the pill
 * re-flows; slide back in when live again. Count rolls smoothly on change.
 * Poll: /api/viewers (twitch/youtube/tiktok, server-cached) + Kick direct
 * from the browser (its API allows browsers, blocks server IPs). 10s.
 */
import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { z } from 'zod';

type Plat = 'kick' | 'twitch' | 'youtube' | 'tiktok';
const ORDER: Plat[] = ['kick', 'twitch', 'youtube', 'tiktok'];

const Query = z.object({
  kick: z.string().optional(),
  twitch: z.string().optional(),
  youtube: z.string().optional(),
  tiktok: z.string().optional(),
  metric: z.string().optional().transform(v => (['live','avg','peak'].includes(v ?? '') ? v! : 'live') as 'live'|'avg'|'peak'),
  combined: z.string().optional().transform(v => v !== 'false'),
  icons: z.string().optional().transform(v => v !== 'false'),
  font: z.string().optional().transform(v => (v === 'dejavu' ? 'dejavu' : 'montserrat')),
  textSize: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'small','2':'medium','3':'large'};
    return map[v??''] ?? (['small','medium','large'].includes(v??'') ? v! : 'medium');
  }),
  textShadow: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'none','2':'small','3':'medium','4':'large'};
    return map[v??''] ?? (['none','small','medium','large'].includes(v??'') ? v! : 'small');
  }),
  stroke: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'none','2':'thin','3':'medium','4':'thick','5':'thicker'};
    return map[v??''] ?? (['none','thin','medium','thick','thicker'].includes(v??'') ? v! : 'none');
  }),
  bg: z.string().optional().transform(v => v !== 'false'), // pill background
});

const SIZES = { small: 22, medium: 34, large: 48 } as const;

const ICONS: Record<Plat, JSX.Element> = {
  kick: <svg viewBox="0 0 24 24" fill="#53FC19"><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>,
  twitch: <img src="/platform-twitch.png" alt="Twitch" style={{ height: '100%', width: 'auto' }} />,
  youtube: (
    <svg viewBox="0 0 24 24">
      <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
      <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12z"/>
    </svg>
  ),
  tiktok: <img src="/platform-tiktok.png" alt="TikTok" style={{ height: '100%', width: 'auto' }} />,
};

interface Stats { live: boolean; viewers: number; peak: number; sum: number; samples: number }

/* Rolling number — animates between values (ease-out over 600ms) */
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

export default function Counter() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const cfgRef = useRef<z.infer<typeof Query> | null>(null);
  const [stats, setStats] = useState<Partial<Record<Plat, Stats>>>({});

  useEffect(() => {
    if (!router.isReady) return;
    const parsed = Query.safeParse(router.query);
    if (!parsed.success) return;
    const cfg = parsed.data;
    cfgRef.current = cfg;
    setReady(true);

    const channels: Partial<Record<Plat, string>> = {};
    if (cfg.kick) channels.kick = cfg.kick;
    if (cfg.twitch) channels.twitch = cfg.twitch;
    if (cfg.youtube) channels.youtube = cfg.youtube;
    if (cfg.tiktok) channels.tiktok = cfg.tiktok;
    if (!Object.keys(channels).length) return;

    const acc: Partial<Record<Plat, Stats>> = {};
    function fold(p: Plat, live: boolean, viewers: number) {
      const prev = acc[p] ?? { live: false, viewers: 0, peak: 0, sum: 0, samples: 0 };
      acc[p] = live ? {
        live, viewers,
        peak: Math.max(prev.peak, viewers),
        sum: prev.sum + viewers,
        samples: prev.samples + 1,
      } : { ...prev, live: false, viewers: 0 };
    }

    let stopped = false;
    async function poll() {
      const jobs: Promise<void>[] = [];
      // twitch/youtube/tiktok via server (shared cache)
      const serverParams = new URLSearchParams();
      (['twitch','youtube','tiktok'] as Plat[]).forEach(p => { if (channels[p]) serverParams.set(p, channels[p]!); });
      if ([...serverParams].length) {
        jobs.push(fetch(`/api/viewers?${serverParams}`)
          .then(r => r.json())
          .then(d => {
            (['twitch','youtube','tiktok'] as Plat[]).forEach(p => {
              if (d[p]) fold(p, d[p].live, d[p].viewers);
            });
          })
          .catch(() => { /* keep last values */ }));
      }
      // kick direct from the browser
      if (channels.kick) {
        jobs.push(fetch(`https://kick.com/api/v2/channels/${channels.kick}`, { headers: { Accept: 'application/json' } })
          .then(r => r.ok ? r.json() : null)
          .then(j => { if (j) fold('kick', !!j.livestream, j.livestream?.viewer_count ?? 0); })
          .catch(() => { /* keep last values */ }));
      }
      await Promise.all(jobs);
      if (!stopped) setStats({ ...acc });
    }

    poll();
    const iv = setInterval(poll, 10_000);
    return () => { stopped = true; clearInterval(iv); };
  }, [router.isReady]);

  if (!ready || !cfgRef.current) return null;
  const cfg = cfgRef.current;

  const fontFamily = cfg.font === 'dejavu' ? "'DejaVu Sans', sans-serif" : "'Montserrat', sans-serif";
  const fontSize = SIZES[cfg.textSize as keyof typeof SIZES];
  const iconSize = Math.round(fontSize * 0.9);
  const shadow =
    cfg.textShadow === 'small' ? 'drop-shadow(2px 2px 0.2rem black)' :
    cfg.textShadow === 'medium' ? 'drop-shadow(2px 2px 0.35rem black)' :
    cfg.textShadow === 'large' ? 'drop-shadow(2px 2px 0.5rem black)' : '';
  const strokeCss = ({ thin: '1px black', medium: '2px black', thick: '3px black', thicker: '4px black' } as Record<string,string>)[cfg.stroke] ?? '';

  const metricOf = (s: Stats) =>
    cfg.metric === 'peak' ? s.peak :
    cfg.metric === 'avg' ? (s.samples ? Math.round(s.sum / s.samples) : 0) :
    s.viewers;

  const liveList = ORDER.filter(p => stats[p]?.live);
  const combinedValue = liveList.reduce((n, p) => n + metricOf(stats[p]!), 0);

  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: Math.round(fontSize * 0.28),
    ...(cfg.bg ? { background: 'rgba(24,24,28,0.92)', borderRadius: 999, padding: `${Math.round(fontSize*0.22)}px ${Math.round(fontSize*0.5)}px` } : {}),
    fontFamily, fontWeight: 700, color: '#fff',
    ...(shadow ? { filter: shadow } : {}),
    ...(strokeCss ? { WebkitTextStroke: strokeCss } : {}),
    transition: 'all 400ms ease',
  };

  const iconBox = (p: Plat) => (
    <span key={p} style={{
      height: iconSize, width: 'auto', display: 'inline-flex', alignItems: 'center',
      animation: 'vcIn 400ms ease',
    }}>
      <span style={{ height: iconSize, width: iconSize, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {ICONS[p]}
      </span>
    </span>
  );

  return (
    <>
      <Head>
        <title>Viewer Counter</title>
        <style>{`
          @font-face { font-family: 'Montserrat'; src: url('/fonts/Montserrat-SemiBold.ttf') format('truetype'); font-weight: 700; }
          @font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; }
          html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
          @keyframes vcIn { from { opacity: 0; transform: translateX(-8px) scale(0.85); max-width: 0; } to { opacity: 1; transform: none; max-width: 200px; } }
          svg { height: 100%; width: auto; display: block; }
        `}</style>
      </Head>
      <div style={{ display: 'flex', gap: Math.round(fontSize * 0.5), padding: 8, flexWrap: 'wrap' }}>
        {cfg.combined ? (
          liveList.length > 0 && (
            <div style={pill}>
              {cfg.icons && liveList.map(iconBox)}
              <RollingCount value={combinedValue} fontSize={fontSize} />
            </div>
          )
        ) : (
          liveList.map(p => (
            <div key={p} style={pill}>
              {cfg.icons && iconBox(p)}
              <RollingCount value={metricOf(stats[p]!)} fontSize={fontSize} />
            </div>
          ))
        )}
      </div>
    </>
  );
}
