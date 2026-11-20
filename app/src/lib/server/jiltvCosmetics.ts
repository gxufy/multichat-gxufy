/*
 * JilTV cosmetics (jiltv.app — not JilChat, not 7TV), server side.
 *
 * Contract, from JilTV's published docs and schema (checked 2026-11-15):
 *   - GET https://api.jiltv.app/v1/cosmetics/catalog: public, edge-cached paint,
 *     badge and decoration definitions. The schema tells chat clients to use
 *     it. Each paint carries a baked texture loop
 *     (`texture.url`, `texture.still`) and `data.fallback` / `data.shadows`.
 *   - POST https://api.jiltv.app/v1/graphql, `userByPlatform(platform: TWITCH,
 *     platformId)`: public, no key; `paint` / `badge` are what the user wears
 *     in chat. Rate limit header: 600 per window.
 *
 * Off unless GXUFY_JILTV_COSMETICS_ENABLED=1 (its own release gate). Nothing
 * here is about JilTV emotes, which stay out of this codebase.
 */

export const JILTV_API_BASE = 'https://api.jiltv.app/v1';
export const JILTV_CATALOG_URL = `${JILTV_API_BASE}/cosmetics/catalog`;
export const JILTV_GRAPHQL_URL = `${JILTV_API_BASE}/graphql`;
export const JILTV_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
export const JILTV_USER_MAX_BYTES = 64 * 1024;

export function jiltvCosmeticsServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GXUFY_JILTV_COSMETICS_ENABLED === '1';
}

export {
  isJilTVAssetUrl,
  parseJilTVCatalog,
  parseJilTVPaint,
  parseJilTVUserResponse,
  JILTV_USER_QUERY,
  type JilTVBadgeView,
  type JilTVCatalog,
  type JilTVPaintShadow,
  type JilTVPaintView,
  type JilTVUserCosmetics,
  type JilTVUserRef,
} from '../jiltvCosmeticsContract';
