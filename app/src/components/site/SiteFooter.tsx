/*
 * Generator footer: thin top border, brand block on the left, two links on
 * the right (Follow and the GitHub source).
 * The OBS overlay never renders it; the homepage keeps its own footer.
 */
import type { ReactNode } from 'react';

const FOLLOW_HREF = 'https://guns.lol/gxufy';
const SOURCE_HREF = 'https://github.com/gxufy/multichat-gxufy';

export const SITE_FOOTER_CSS = `
.site-footer { border-top: 1px solid var(--line, #2c2c35); margin-top: 44px; padding: 30px 0 10px;
  color: var(--dim, #62626e); font-size: .78rem; text-align: left; }
.site-footer-row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 22px; }
.site-footer-brand { margin: 0 0 6px; color: #fff; font-size: .95rem; font-weight: 800; letter-spacing: -.01em; }
.site-footer-about { margin: 0 0 12px; color: var(--muted, #9a9aa5); line-height: 1.55; max-width: 320px; }
.site-footer-copy { margin: 0; }
.site-footer-links { display: flex; flex-wrap: wrap; gap: 10px; }
.site-footer-btn { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 16px;
  border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.03);
  color: #f2f3f7; font-size: .82rem; font-weight: 700; text-decoration: none;
  transition: background .15s, border-color .15s, transform .2s; }
.site-footer-btn:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.22); color: #fff; opacity: 1; }
.site-footer-btn:active { transform: scale(.97); }
.site-footer-btn:focus-visible { outline: 2px solid var(--accent, #4a84fa); outline-offset: 2px; }
.site-footer-btn.is-primary { background: #fff; border-color: #fff; color: #111; }
.site-footer-btn.is-primary:hover { background: #e9e9ee; color: #111; }
.site-footer-btn svg { flex: none; }
.site-footer-notes { margin-top: 14px; }
.site-footer-notes p { margin: 0; line-height: 1.5; }
`;

type SiteFooterProps = {
  /** Extra notices shown under the footer, e.g. legal disclosures. */
  children?: ReactNode;
};

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default function SiteFooter({ children }: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <style dangerouslySetInnerHTML={{ __html: SITE_FOOTER_CSS }} />
      <div className="site-footer-row">
        <div>
          <p className="site-footer-brand">Gxufy 🕊️</p>
          <p className="site-footer-about">
            Free stream tools for Kick, Twitch, YouTube &amp; TikTok. No logins, no OAuth.
          </p>
          <p className="site-footer-copy">© {new Date().getFullYear()} Gxufy 🕊️</p>
        </div>
        <nav className="site-footer-links" aria-label="Gxufy">
          <a className="site-footer-btn is-primary" href={FOLLOW_HREF} target="_blank" rel="noreferrer">
            Follow @gxufy
          </a>
          <a className="site-footer-btn" href={SOURCE_HREF} target="_blank" rel="noreferrer">
            <GitHubMark />
            Source
          </a>
        </nav>
      </div>
      {children ? <div className="site-footer-notes">{children}</div> : null}
    </footer>
  );
}
