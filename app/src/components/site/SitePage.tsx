import type { ReactNode } from 'react';
import SiteSeo from './SiteSeo';

type SitePageProps = {
  title: string;
  heading: string;
  description: string;
  path: string;
  eyebrow?: string;
  children: ReactNode;
};

const NAV = [
  ['/multichat', 'MultiChat'],
  ['/viewer-counter', 'Viewer Counter'],
] as const;

export default function SitePage({
  title,
  heading,
  description,
  path,
  eyebrow = 'Gxufy stream tools',
  children,
}: SitePageProps) {
  return (
    <>
      <SiteSeo title={title} description={description} path={path} />
      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: #141418;
          color: #e2e2e8;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        body {
          background-image: radial-gradient(ellipse 900px 420px at 50% -80px, rgba(74,132,250,0.10), transparent);
        }
        a { color: #6d9dff; }
      `}</style>
      <style jsx>{`
        .shell { max-width: 920px; margin: 0 auto; padding: 0 22px 64px; }
        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          padding: 26px 0;
          border-bottom: 1px solid #2c2c35;
        }
        .brand {
          color: #fff;
          text-decoration: none;
          font-weight: 850;
          font-size: 1.08rem;
          white-space: nowrap;
        }
        nav { display: flex; flex-wrap: wrap; gap: 14px; justify-content: flex-end; }
        nav a {
          color: #aaaab6;
          text-decoration: none;
          font-size: .82rem;
          font-weight: 650;
        }
        nav a:hover { color: #fff; }
        main { padding: 64px 0 22px; }
        .eyebrow {
          margin: 0 0 10px;
          color: #6d9dff;
          text-transform: uppercase;
          letter-spacing: .14em;
          font-size: .73rem;
          font-weight: 800;
        }
        h1 {
          margin: 0 0 16px;
          color: #fff;
          font-size: clamp(2.25rem, 7vw, 4rem);
          line-height: 1.02;
          letter-spacing: -.045em;
        }
        .lede {
          max-width: 720px;
          margin: 0 0 42px;
          color: #aaaab6;
          font-size: 1.05rem;
          line-height: 1.75;
        }
        .content { display: grid; gap: 18px; }
        .content :global(section) {
          background: #1d1d23;
          border: 1px solid #2c2c35;
          border-radius: 14px;
          padding: 24px;
        }
        .content :global(h2) {
          margin: 0 0 10px;
          color: #fff;
          font-size: 1.25rem;
        }
        .content :global(p), .content :global(li) {
          color: #b3b3bd;
          line-height: 1.7;
        }
        .content :global(ul), .content :global(ol) { margin-bottom: 0; }
        .content :global(.cta) {
          display: inline-block;
          margin-top: 8px;
          border-radius: 10px;
          padding: 11px 16px;
          background: #4a84fa;
          color: #fff;
          text-decoration: none;
          font-weight: 750;
        }
        .content :global(table) {
          width: 100%;
          border-collapse: collapse;
          margin-top: 14px;
          font-size: .9rem;
        }
        .content :global(th), .content :global(td) {
          text-align: left;
          vertical-align: top;
          padding: 11px 10px;
          border-bottom: 1px solid #31313b;
        }
        .content :global(th) { color: #fff; }
        .content :global(code) {
          color: #dbe6ff;
          overflow-wrap: anywhere;
        }
        footer {
          margin-top: 44px;
          padding-top: 20px;
          border-top: 1px solid #2c2c35;
          color: #777784;
          font-size: .78rem;
        }
        @media (max-width: 720px) {
          header { align-items: flex-start; flex-direction: column; }
          nav { justify-content: flex-start; }
          main { padding-top: 46px; }
          .content :global(section) { padding: 20px; }
          .content :global(table) { display: block; overflow-x: auto; }
        }
      `}</style>

      <div className="shell">
        <header>
          <a className="brand" href="/">Gxufy 🕊️</a>
          <nav aria-label="Primary">
            {NAV.map(([href, label]) => (
              <a key={href} href={href}>{label}</a>
            ))}
          </nav>
        </header>

        <main>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{heading}</h1>
          <p className="lede">{description}</p>
          <div className="content">{children}</div>
        </main>

        <footer>
          © {new Date().getFullYear()} Gxufy 🕊️ · gxufy.com
        </footer>
      </div>
    </>
  );
}
