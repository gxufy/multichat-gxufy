/* The shared site footer's stylesheet and links (SiteFooter.svelte). */
export const FOLLOW_HREF = 'https://guns.lol/gxufy';
export const SOURCE_HREF = 'https://github.com/gxufy/flosschat';

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
