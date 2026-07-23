/* / — personal hub (slaiqe.com structure: hero → skill tags → product
 * cards → CTA → socials footer). The overlay generator lives at
 * /multichat; old bookmarked /?kick=... overlay URLs still work because
 * this page forwards any channel-param URL straight to /multichat.
 */
import Head from 'next/head';
import { useEffect } from 'react';
import { useRouter } from 'next/router';

const SOCIALS = [
  { label: 'X / Twitter', href: 'https://x.com/Gxufy_', icon: '𝕏' },
  { label: 'GitHub', href: 'https://github.com/gxufy', icon: '⌥' },
  { label: 'Discord', href: 'https://discord.com/users/882428313644179486', icon: '💬' },
];

const TAGS = ['multi-platform chat', 'viewer counters', 'OBS overlays', '7TV · BTTV · FFZ', 'no OAuth', 'real-time'];

export default function Hub() {
  const router = useRouter();

  // legacy overlay URLs (/?kick=...&twitch=...) → /multichat with same params
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (q.channel || q.kick || q.twitch || q.youtube || q.tiktok) {
      router.replace({ pathname: '/multichat', query: q });
    }
  }, [router.isReady]);

  return (
    <>
      <Head>
        <title>Gxufy ヤ</title>
        <meta name="description" content="I build tools that make streams smoother — multi-platform chat overlays and stream widgets that just work." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        :root {
          --bg: #141418; --card: #1d1d23; --card-2: #24242c; --line: #2c2c35;
          --text: #e2e2e8; --muted: #9a9aa5; --dim: #62626e;
          --accent: #4a84fa; --accent-2: #6d9dff;
          --shadow: 0 4px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.5);
        }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: 'Montserrat', system-ui, sans-serif; }
        body { background-image: radial-gradient(ellipse 900px 420px at 50% -80px, rgba(74,132,250,0.10), transparent); }
        a { color: var(--accent); text-decoration: none; transition: opacity .2s; } a:hover { opacity: .8; }
        .wrap { max-width: 880px; margin: 0 auto; padding: 0 20px 60px; }

        .hero { display: flex; align-items: center; gap: 28px; padding: 72px 0 40px; flex-wrap: wrap; }
        .hero-avatar { width: 128px; height: 128px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent); box-shadow: 0 8px 32px rgba(74,132,250,.3); }
        .hero-text h1 { font-size: 2.6rem; font-weight: 800; margin: 0 0 6px; letter-spacing: -.04em; color: #fff; }
        .hero-text h1 span { color: var(--accent); }
        .hero-kicker { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--accent); margin: 0 0 10px; }
        .hero-text p { font-size: 1.02rem; color: var(--muted); line-height: 1.6; margin: 0; max-width: 520px; }

        .tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 44px; }
        .tag { font-size: 0.74rem; font-weight: 600; color: var(--muted); background: rgba(255,255,255,.035); border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px; }

        .cards { display: grid; grid-template-columns: 1fr; gap: 18px; margin-bottom: 44px; }
        .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 26px; box-shadow: var(--shadow); transition: transform .15s, border-color .15s; display: block; }
        .card:hover { transform: translateY(-3px); border-color: rgba(74,132,250,.5); opacity: 1; }
        .card-kicker { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: var(--accent); margin: 0 0 8px; }
        .card h2 { font-size: 1.35rem; font-weight: 800; color: #fff; margin: 0 0 8px; letter-spacing: -.02em; }
        .card p { font-size: 0.9rem; color: var(--muted); line-height: 1.6; margin: 0 0 14px; }
        .card-cta { font-size: 0.86rem; font-weight: 700; color: var(--accent); }
        .card-badges { display: flex; gap: 6px; margin-bottom: 12px; }
        .cb { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; padding: 2px 10px; border-radius: 999px; }
        .cb-kick { color: #53fc18; border: 1px solid rgba(83,252,24,.5); }
        .cb-tw { color: #a970ff; border: 1px solid rgba(145,70,255,.5); }
        .cb-yt { color: #ff5b5b; border: 1px solid rgba(255,68,68,.5); }
        .cb-tt { color: #25F4EE; border: 1px solid rgba(37,244,238,.5); }

        .banner { background: linear-gradient(120deg, rgba(74,132,250,.14), rgba(74,132,250,.04)); border: 1px solid rgba(74,132,250,.35); border-radius: 14px; padding: 24px 26px; margin-bottom: 44px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .banner p { margin: 0; color: var(--muted); font-size: 0.92rem; line-height: 1.5; }
        .banner strong { color: #fff; }
        .banner a { background: var(--accent); color: #fff; font-weight: 800; font-size: 0.88rem; padding: 11px 22px; border-radius: 10px; box-shadow: 0 4px 16px rgba(74,132,250,.35); white-space: nowrap; }
        .banner a:hover { background: var(--accent-2); opacity: 1; }

        /* socials — guns.lol style: centered icon row, hover lift */
        .socials { text-align: center; padding-top: 6px; }
        .socials-title { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .13em; color: var(--dim); margin-bottom: 16px; }
        .social-row { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
        .social { width: 54px; height: 54px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; font-size: 1.35rem; color: var(--text); transition: transform .15s, border-color .15s, box-shadow .15s; }
        .social:hover { transform: translateY(-4px); border-color: var(--accent); box-shadow: 0 8px 24px rgba(74,132,250,.25); opacity: 1; }

        footer { border-top: 1px solid var(--line); margin-top: 48px; padding: 20px 0 0; text-align: center; font-size: 0.76rem; color: var(--dim); }

        @media (max-width: 620px) {
          .hero { padding-top: 48px; justify-content: center; text-align: center; }
          .hero-text p { max-width: none; }
          .tags { justify-content: center; }
        }
      `}</style>

      <div className="wrap">
        <div className="hero">
          <img className="hero-avatar" src="/gxufy-avatar.jpg" alt="Gxufy" />
          <div className="hero-text">
            <p className="hero-kicker">overlays &amp; stream tools</p>
            <h1>wtw, I&rsquo;m <span>Gxufy</span> 🕊️</h1>
            <p>I build tools that make streams smoother — multi-platform chat overlays and widgets that just work. No logins, no OAuth, no setup pain.</p>
          </div>
        </div>

        <div className="tags">
          {TAGS.map(t => <span key={t} className="tag">{t}</span>)}
        </div>

        <div className="cards">
          <a className="card" href="/multichat">
            <p className="card-kicker">Free tool</p>
            <div className="card-badges">
              <span className="cb cb-kick">Kick</span>
              <span className="cb cb-tw">Twitch</span>
              <span className="cb cb-yt">YouTube</span>
              <span className="cb cb-tt">TikTok</span>
            </div>
            <h2>multichat — one overlay for every chat</h2>
            <p>
              Combine Kick, Twitch, YouTube &amp; TikTok chat into a single OBS browser source.
              7TV / BTTV / FFZ emotes, name paints, real platform badges, pinned messages,
              gifts &amp; Super Chats, plus a real-time viewer counter. Works with just a channel name.
            </p>
            <span className="card-cta">Open the generator →</span>
          </a>
        </div>

        <div className="banner">
          <p><strong>More tools are on the way.</strong> multichat is the first — follow me to catch what&rsquo;s next.</p>
          <a href="https://guns.lol/gxufy" target="_blank" rel="noreferrer">Follow @Gxufy_</a>
        </div>

        <div className="socials">
          <p className="socials-title">Socials &amp; contact</p>
          <div className="social-row">
            {SOCIALS.map(s => (
              <a key={s.label} className="social" href={s.href} target="_blank" rel="noreferrer" title={s.label}>
                {s.icon}
              </a>
            ))}
          </div>
        </div>

        <footer>
          <p>© {new Date().getFullYear()} Gxufy ヤ — multichat lives at <a href="/multichat">/multichat</a></p>
        </footer>
      </div>
    </>
  );
}
