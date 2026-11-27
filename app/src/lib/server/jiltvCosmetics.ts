/*
 * JilTV cosmetics (jiltv.app — not JilChat, not 7TV), server side.
 *
 * Contract, from JilTV's chat-client docs (jiltv.app/docs/chat-clients,
 * checked 2026-11-25):
 *   - GET https://api.jiltv.app/v1/cosmetics/catalog: every published paint,
 *     badge and decoration with its design, edge-cached; load it once. Each
 *     paint carries a baked texture loop (`texture.url`, `texture.still`,
 *     `texture.tile`) and `data.fallback` / `data.shadows`.
 *   - GET https://api.jiltv.app/v1/cosmetics/twitch?logins=a,b&channel=c: what
 *     those chatters wear, as catalog ids (`p` is the paint on the name), up to
 *     100 logins at once. Logins wearing nothing are left out. A look can
 *     differ per channel, so `channel` is the login of the channel shown.
 *     Answers are cached for a minute. No key; 600 requests a minute per IP.
 *
 * Off unless GXUFY_JILTV_COSMETICS_ENABLED=1 (its own release gate, set by
 * the server setup for both apps). JilTV emotes are separate: the overlay
 * loads them itself (lib/jiltvEmotes.ts), with no server part.
 */

export const JILTV_API_BASE = 'https://api.jiltv.app/v1';
export const JILTV_CATALOG_URL = `${JILTV_API_BASE}/cosmetics/catalog`;
export const JILTV_LOOKS_URL = `${JILTV_API_BASE}/cosmetics/twitch`;
export const JILTV_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
export const JILTV_LOOKS_MAX_BYTES = 256 * 1024;

export function jiltvCosmeticsServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GXUFY_JILTV_COSMETICS_ENABLED === '1';
}

export {
  isJilTVAssetUrl,
  parseJilTVCatalog,
  parseJilTVLooks,
  parseJilTVPaint,
  JILTV_LOOKUP_MAX_LOGINS,
  TWITCH_LOGIN_RE,
  type JilTVCatalog,
  type JilTVPaintShadow,
  type JilTVPaintView,
} from '../jiltvCosmeticsContract';
