/*
 * JilTV cosmetics contract: types and validation shared by the server proxy
 * and the overlay. No imports, no side effects.
 */

export type JilTVPaintShadow = { x: number; y: number; blur: number; color: string };

export type JilTVPaintView = {
  id: string;
  name: string;
  /** Animated baked loop (webp) on cdn.jiltv.app. A paint without one is
   *  drawn in its fallback colour. */
  texture?: string;
  /** First frame, for reduced motion. */
  still?: string;
  /** Set for a texture that repeats sideways: the width (CSS px) of one
   *  repeat. Other textures are stretched over the whole name. */
  tileWidth?: number;
  /** Solid colour shown under the texture and if it fails to load. */
  fallback?: string;
  shadows: JilTVPaintShadow[];
};

export type JilTVCatalog = { paints: Map<string, JilTVPaintView> };

/** A Twitch login, the key JilTV's chat-client lookups take. */
export const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

/** Logins asked about in one lookup (JilTV takes up to 100). */
export const JILTV_LOOKUP_MAX_LOGINS = 50;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown, max = 200): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : '';
}

export const ID_RE = /^[0-9A-Za-z_-]{1,64}$/;
export const HEX_COLOR_RE = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Only JilTV's own HTTPS hosts, no credentials/ports/fragments/CSS breakers. */
export function isJilTVAssetUrl(candidate: string): boolean {
  if (!candidate || candidate.length > 512 || /["'\\()\s]/.test(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:'
    && !url.username && !url.password && !url.port && !url.hash
    && (host === 'jiltv.app' || host.endsWith('.jiltv.app'));
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function parseJilTVPaint(raw: unknown): JilTVPaintView | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 64);
  if (!ID_RE.test(id)) return null;
  const texture = isRecord(raw.texture) ? raw.texture : null;
  const textureUrl = texture ? str(texture.url, 512) : '';
  /* A texture must be JilTV's own; a paint without one needs its colour. */
  if (textureUrl && !isJilTVAssetUrl(textureUrl)) return null;
  const stillUrl = textureUrl && texture ? str(texture.still, 512) : '';
  const tileWidth = textureUrl && texture?.tile === true ? finite(texture.w, 1, 2_048) : null;
  const data = isRecord(raw.data) ? raw.data : {};
  const fallback = str(data.fallback, 9);
  if (!textureUrl && !HEX_COLOR_RE.test(fallback)) return null;
  const shadows = (Array.isArray(data.shadows) ? data.shadows : [])
    .slice(0, 4)
    .flatMap((shadow): JilTVPaintShadow[] => {
      if (!isRecord(shadow)) return [];
      const x = finite(shadow.x, -50, 50);
      const y = finite(shadow.y, -50, 50);
      const blur = finite(shadow.blur, 0, 50);
      const color = str(shadow.color, 9);
      return x === null || y === null || blur === null || !HEX_COLOR_RE.test(color)
        ? []
        : [{ x, y, blur, color }];
    });
  return {
    id,
    name: str(raw.name, 80) || 'JilTV paint',
    ...(textureUrl ? { texture: textureUrl } : {}),
    ...(isJilTVAssetUrl(stillUrl) ? { still: stillUrl } : {}),
    ...(tileWidth !== null ? { tileWidth } : {}),
    ...(HEX_COLOR_RE.test(fallback) ? { fallback } : {}),
    shadows,
  };
}

/** `null` when the body is not a catalog at all. */
export function parseJilTVCatalog(body: unknown): JilTVCatalog | null {
  if (!isRecord(body) || !Array.isArray(body.paints)) return null;
  const paints = new Map<string, JilTVPaintView>();
  for (const raw of body.paints.slice(0, 2_000)) {
    const paint = parseJilTVPaint(raw);
    if (paint && !paints.has(paint.id)) paints.set(paint.id, paint);
  }
  return { paints };
}

/**
 * JilTV's `/v1/cosmetics/twitch` answer, `{ users: { login: { p, b, d, bn } } }`
 * with catalog ids, as the paint id each login wears. Logins wearing nothing
 * are left out of JilTV's answer and of this map. `null` when the body is not
 * such an answer at all.
 */
export function parseJilTVLooks(body: unknown): Map<string, string> | null {
  if (!isRecord(body) || !isRecord(body.users)) return null;
  const paints = new Map<string, string>();
  for (const [login, look] of Object.entries(body.users).slice(0, 200)) {
    const key = login.toLowerCase();
    if (!TWITCH_LOGIN_RE.test(key) || !isRecord(look)) continue;
    const paintId = str(look.p, 64);
    if (ID_RE.test(paintId)) paints.set(key, paintId);
  }
  return paints;
}

/** One paint as /api/jiltv/cosmetics sends it, checked again in the browser. */
export function parseJilTVPaintView(raw: unknown): JilTVPaintView | null {
  if (!isRecord(raw)) return null;
  return parseJilTVPaint({
    id: raw.id,
    name: raw.name,
    texture: {
      url: raw.texture,
      still: raw.still,
      tile: raw.tileWidth !== undefined,
      w: raw.tileWidth,
    },
    data: { fallback: raw.fallback, shadows: raw.shadows },
  });
}

/**
 * What the browser accepts back from /api/jiltv/cosmetics:
 * `{ paints: { login: paint | null } }`, null meaning the login wears no
 * JilTV paint in that channel. `null` when the body is not such an answer.
 */
export function parseJilTVPaintAnswer(body: unknown): Map<string, JilTVPaintView | null> | null {
  if (!isRecord(body) || !isRecord(body.paints)) return null;
  const paints = new Map<string, JilTVPaintView | null>();
  for (const [login, raw] of Object.entries(body.paints).slice(0, JILTV_LOOKUP_MAX_LOGINS)) {
    const key = login.toLowerCase();
    if (!TWITCH_LOGIN_RE.test(key)) continue;
    paints.set(key, raw === null ? null : parseJilTVPaintView(raw));
  }
  return paints;
}

export type JilTVPaintStyle = {
  background: string;
  filter: string;
  /** CSS background-size and background-repeat for `background`. */
  size?: string;
  repeat?: string;
};

/**
 * A JilTV paint as name CSS: JilTV's baked texture loop over its fallback
 * colour (so the name never goes invisible while the image loads), and its
 * shadows as drop-shadow filters. Reduced motion uses the still frame. The
 * texture is stretched over the whole name, or repeats sideways at its own
 * width when it is a tiling one (as jiltv.app draws them); a paint without a
 * texture is its fallback colour.
 */
export function buildJilTVPaintStyle(
  paint: JilTVPaintView,
  paintShadows: boolean,
  reducedMotion = false,
): JilTVPaintStyle {
  const fallback = paint.fallback && HEX_COLOR_RE.test(paint.fallback) ? paint.fallback : '';
  const solid = fallback ? `linear-gradient(${fallback}, ${fallback})` : '';
  const still = reducedMotion && paint.still && isJilTVAssetUrl(paint.still) ? paint.still : '';
  const image = still || paint.texture || '';
  let background: string;
  if (isJilTVAssetUrl(image)) background = solid ? `url("${image}"), ${solid}` : `url("${image}")`;
  else if (!paint.texture && solid) background = solid;
  else return { background: '', filter: '' };
  const tileWidth = paint.texture && typeof paint.tileWidth === 'number' && Number.isFinite(paint.tileWidth)
    ? Math.min(2_048, Math.max(1, Math.round(paint.tileWidth)))
    : 0;
  const filter = paintShadows
    ? paint.shadows
      .filter((shadow) => HEX_COLOR_RE.test(shadow.color))
      .map((shadow) => `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})`)
      .join(' ')
    : '';
  return {
    background,
    filter,
    size: tileWidth ? `${tileWidth}px 100%` : '100% 100%',
    repeat: tileWidth ? 'repeat-x' : 'no-repeat',
  };
}
