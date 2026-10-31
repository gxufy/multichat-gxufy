import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import SiteSeo from '@/components/site/SiteSeo';
import { UI_FONT_SPECS, googleFontsImportCss } from '@/lib/overlayFonts';
import {
  CANONICAL_COUNTER_ROUTE,
  CANONICAL_MULTICHAT_ROUTE,
} from '@/lib/multichatRouting';
import {
  supportPageEnabled,
} from '@/lib/supportPage';

const FOLLOW_HREF = 'https://guns.lol/gxufy';
const FOLLOW_LABEL = 'Follow @gxufy';

const TAGS = [
  'multi-platform chat',
  'viewer counters',
  'OBS overlays',
  '7TV · BTTV · FFZ',
  'no OAuth',
  'real-time',
];

const SITE_LINKS = [
  ['/multichat', 'MultiChat'],
] as const;

type HubProps = {
  supportEnabled?: boolean;
};

export const getServerSideProps:
GetServerSideProps<HubProps> = async () => ({
  props: {
    supportEnabled:
      supportPageEnabled(),
  },
});

export default function Hub({
  supportEnabled = false,
}: HubProps) {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    if (q.channel || q.kick || q.twitch || q.youtube || q.tiktok) {
      router.replace({ pathname: '/multichat', query: q });
    }
  }, [router.isReady]);

  const description =
    'Gxufy builds multi-platform stream tools for OBS, including MultiChat and a live viewer counter for Kick, Twitch, YouTube, and TikTok.';

  return (
    <>
      <SiteSeo
        home
        title="Gxufy 🕊️"
        description={description}
        path="/"
      />
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <style dangerouslySetInnerHTML={{
          __html: googleFontsImportCss([UI_FONT_SPECS.montserrat]),
        }} />
      </Head>

      <style dangerouslySetInnerHTML={{ __html: `
        *, *::before, *::after { box-sizing: border-box; }
        :root {
          --bg: #141418; --card: #1d1d23; --card-2: #24242c; --line: #2c2c35;
          --text: #e2e2e8; --muted: #9a9aa5; --dim: #62626e;
          --accent: #4a84fa; --accent-2: #6d9dff;
          --shadow: 0 4px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.5);
        }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: 'Montserrat', system-ui, sans-serif; }
        body { background-image: radial-gradient(ellipse 900px 420px at 50% -80px, rgba(74,132,250,0.10), transparent); }
        a { color: var(--accent); text-decoration: none; transition: opacity .2s; }
        a:hover { opacity: .8; }
        .wrap { max-width: 880px; margin: 0 auto; padding: 0 20px 60px; }

        .site-nav {
          display: flex; flex-wrap: wrap; justify-content: center; gap: 9px 18px;
          padding: 22px 0 0;
        }
        .site-nav a {
          color: var(--muted); font-size: .76rem; font-weight: 700;
        }
        .site-nav a:hover { color: #fff; opacity: 1; }

        .hero { display: flex; align-items: center; gap: 28px; padding: 58px 0 40px; flex-wrap: wrap; }
        .hero-avatar { width: 128px; height: 128px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent); box-shadow: 0 8px 32px rgba(74,132,250,.3); }
        .hero-text h1 { font-size: 2.6rem; font-weight: 800; margin: 0 0 6px; letter-spacing: -.04em; color: #fff; }
        .hero-text h1 span { color: var(--accent); }
        .hero-kicker { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--accent); margin: 0 0 10px; }
        .hero-text p { font-size: 1.02rem; color: var(--muted); line-height: 1.6; margin: 0; max-width: 520px; }

        .tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 44px; }
        .tag { font-size: 0.74rem; font-weight: 600; color: var(--muted); background: rgba(255,255,255,.035); border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px; }

        .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 36px; }
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

        .support-cta {
          display: grid;
          grid-template-columns: 52px minmax(0, 1fr) auto;
          align-items: center;
          gap: 15px;
          width: 100%;
          margin: 0 0 14px;
          padding: 18px 20px;
          color: var(--text);
          background:
            linear-gradient(
              135deg,
              rgba(74,132,250,.16),
              rgba(109,157,255,.055)
            );
          border: 1px solid rgba(74,132,250,.42);
          border-radius: 14px;
          box-shadow: 0 4px 20px rgba(0,0,0,.28);
          transition:
            transform .15s,
            border-color .15s,
            background .15s,
            box-shadow .15s;
        }
        .support-cta:hover {
          opacity: 1;
          color: var(--text);
          transform: translateY(-2px);
          border-color: rgba(109,157,255,.72);
          background:
            linear-gradient(
              135deg,
              rgba(74,132,250,.22),
              rgba(109,157,255,.085)
            );
          box-shadow: 0 8px 26px rgba(0,0,0,.34);
        }
        .support-cta:focus-visible {
          outline: 3px solid #fff;
          outline-offset: 3px;
        }
        .support-cta-badge {
          width: 52px;
          height: 52px;
          object-fit: contain;
          filter:
            drop-shadow(
              0 4px 10px
              rgba(74,132,250,.28)
            );
        }
        .support-cta-copy {
          min-width: 0;
        }
        .support-cta-title {
          display: block;
          margin: 0 0 4px;
          color: #fff;
          font-size: .98rem;
          font-weight: 800;
          letter-spacing: -.01em;
        }
        .support-cta-text {
          display: block;
          color: var(--muted);
          font-size: .82rem;
          font-weight: 500;
          line-height: 1.5;
        }
        .support-cta-action {
          white-space: nowrap;
          padding: 10px 14px;
          color: #fff;
          background: var(--accent);
          border-radius: 10px;
          font-size: .78rem;
          font-weight: 800;
        }

        .follow-cta {
          display: block; width: 100%; box-sizing: border-box;
          background: var(--accent); color: #fff; text-align: center;
          font-size: 1.12rem; font-weight: 800; letter-spacing: -.01em;
          padding: 22px 28px; border-radius: 14px;
          box-shadow: 0 6px 24px rgba(74,132,250,.35);
          transition: background .15s, transform .15s, box-shadow .15s;
        }
        .follow-cta:hover { background: var(--accent-2); color: #fff; opacity: 1; transform: translateY(-2px); box-shadow: 0 10px 30px rgba(74,132,250,.45); }
        .follow-cta:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }

        footer { border-top: 1px solid var(--line); margin-top: 40px; padding: 20px 0 0; text-align: center; font-size: 0.76rem; color: var(--dim); }

        @media (max-width: 620px) {
          .hero { padding-top: 42px; justify-content: center; text-align: center; }
          .hero-text p { max-width: none; }
          .tags { justify-content: center; }
          .cards { grid-template-columns: 1fr; }
          .support-cta {
            grid-template-columns:
              44px minmax(0, 1fr);
            gap: 12px;
          }
          .support-cta-badge {
            width: 44px;
            height: 44px;
          }
          .support-cta-action {
            grid-column: 2;
            justify-self: start;
          }
        }
      ` }} />

      <div className="wrap">
        <nav className="site-nav" aria-label="Gxufy pages">
          {SITE_LINKS.map(([href, label]) => (
            <a key={href} href={href}>{label}</a>
          ))}
          {supportEnabled ? (
            <a href="/support">
              Support
            </a>
          ) : null}
        </nav>

        <div className="hero">
          <img className="hero-avatar" src="/gxufy-avatar.gif" alt="Gxufy" />
          <div className="hero-text">
            <p className="hero-kicker">overlays &amp; stream tools</p>
            <h1>wtw, I&rsquo;m <span>Gxufy</span> 🕊️</h1>
            <p>
              I build tools that make streams smoother — multi-platform chat overlays and
              widgets that just work. No logins, no OAuth, no setup pain.
            </p>
          </div>
        </div>

        <div className="tags">
          {TAGS.map((tag) => <span key={tag} className="tag">{tag}</span>)}
        </div>

        <div className="cards">
          <a className="card" href={CANONICAL_MULTICHAT_ROUTE}>
            <p className="card-kicker">Free tool</p>
            <div className="card-badges">
              <span className="cb cb-kick">Kick</span>
              <span className="cb cb-tw">Twitch</span>
              <span className="cb cb-yt">YouTube</span>
              <span className="cb cb-tt">TikTok</span>
            </div>
            <h2>MultiChat — one overlay for every chat</h2>
            <p>
              Combine Kick, Twitch, YouTube &amp; TikTok chat into a single OBS browser source.
              7TV / BTTV / FFZ emotes, name paints, real platform badges,
              gifts &amp; Super Chats, plus a real-time viewer counter. Works with just a channel name.
            </p>
            <span className="card-cta">Open the generator →</span>
          </a>

          <a className="card" href={CANONICAL_COUNTER_ROUTE}>
            <p className="card-kicker">Free tool</p>
            <div className="card-badges">
              <span className="cb cb-kick">Kick</span>
              <span className="cb cb-tw">Twitch</span>
              <span className="cb cb-yt">YouTube</span>
              <span className="cb cb-tt">TikTok</span>
            </div>
            <h2>Viewer Counter — real-time counts</h2>
            <p>
              Create an OBS viewer-count overlay for Kick, Twitch, YouTube &amp; TikTok.
              Real-time counts with offline platforms sliding out, plus Google Fonts,
              shadows, outlines, icons, and transparent output.
            </p>
            <span className="card-cta">Open the generator →</span>
          </a>
        </div>

        {supportEnabled ? (
          <a
            className="support-cta"
            href="/support"
            aria-label="Support Gxufy"
          >
            <img
              className="support-cta-badge"
              src="/badges/gxufy/supporter.webp"
              alt=""
              aria-hidden="true"
            />

            <span className="support-cta-copy">
              <span className="support-cta-title">
                Support Gxufy
              </span>

              <span className="support-cta-text">
                Help keep MultiChat frequently updated as platform APIs change. Ongoing development takes time.
              </span>
            </span>

            <span className="support-cta-action">
              Support for $5
            </span>
          </a>
        ) : null}

        <a className="follow-cta" href={FOLLOW_HREF} target="_blank" rel="noreferrer">
          {FOLLOW_LABEL}
        </a>

        <footer>
          <p>
            © {new Date().getFullYear()} Gxufy 🕊️ — MultiChat lives at{' '}
            <a href={CANONICAL_MULTICHAT_ROUTE}>{CANONICAL_MULTICHAT_ROUTE}</a>
          </p>
          <p>
            For abuse prevention, IP addresses may be logged when repeated server rate limits indicate possible abuse.
          </p>
        </footer>
      </div>
    </>
  );
}
