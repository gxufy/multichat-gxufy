/*
 * JilTV cosmetics contract: types and validation shared by the server proxy
 * and the overlay. No imports, no side effects.
 */

export type JilTVPaintShadow = { x: number; y: number; blur: number; color: string };

export type JilTVPaintView = {
  id: string;
  name: string;
  /** Animated baked loop (webp) on cdn.jiltv.app. */
  texture: string;
  /** First frame, for reduced motion. */
  still?: string;
  /** Solid colour shown under the texture and if it fails to load. */
  fallback?: string;
  shadows: JilTVPaintShadow[];
};

export type JilTVBadgeView = { id: string; title: string; url: string };

export type JilTVUserCosmetics = {
  paint: JilTVPaintView | null;
  badge: JilTVBadgeView | null;
};

export type JilTVCatalog = { paints: Map<string, JilTVPaintView> };

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
  if (!isJilTVAssetUrl(textureUrl)) return null;
  const stillUrl = texture ? str(texture.still, 512) : '';
  const data = isRecord(raw.data) ? raw.data : {};
  const fallback = str(data.fallback, 9);
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
    texture: textureUrl,
    ...(isJilTVAssetUrl(stillUrl) ? { still: stillUrl } : {}),
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

export const JILTV_USER_QUERY =
  'query($id:String!){userByPlatform(platform:TWITCH,platformId:$id){paint{id} badge{id name imageUrl}}}';

export type JilTVUserRef = { paintId: string | null; badge: JilTVBadgeView | null };

/**
 * `null` when the response is not a GraphQL answer we understand.
 * A user who is not on JilTV is `{ paintId: null, badge: null }`.
 */
export function parseJilTVUserResponse(body: unknown): JilTVUserRef | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  if (!('userByPlatform' in body.data)) return null;
  const user = body.data.userByPlatform;
  if (user === null) return { paintId: null, badge: null };
  if (!isRecord(user)) return null;
  const paintId = isRecord(user.paint) ? str(user.paint.id, 64) : '';
  let badge: JilTVBadgeView | null = null;
  if (isRecord(user.badge)) {
    const id = str(user.badge.id, 64);
    const url = str(user.badge.imageUrl, 512);
    if (ID_RE.test(id) && isJilTVAssetUrl(url)) {
      badge = { id, title: str(user.badge.name, 80) || 'JilTV', url };
    }
  }
  return { paintId: ID_RE.test(paintId) ? paintId : null, badge };
}

/** What the browser accepts back from /api/jiltv/cosmetics (re-checked). */
export function parseJilTVUserCosmetics(body: unknown): JilTVUserCosmetics | null {
  if (!isRecord(body)) return null;
  const paintRaw = body.paint;
  const badgeRaw = body.badge;
  let paint: JilTVPaintView | null = null;
  if (isRecord(paintRaw)) {
    paint = parseJilTVPaint({
      id: paintRaw.id,
      name: paintRaw.name,
      texture: { url: paintRaw.texture, still: paintRaw.still },
      data: { fallback: paintRaw.fallback, shadows: paintRaw.shadows },
    });
  }
  let badge: JilTVBadgeView | null = null;
  if (isRecord(badgeRaw)) {
    const id = str(badgeRaw.id, 64);
    const url = str(badgeRaw.url, 512);
    if (ID_RE.test(id) && isJilTVAssetUrl(url)) badge = { id, title: str(badgeRaw.title, 80) || 'JilTV', url };
  }
  return { paint, badge };
}

/**
 * A JilTV paint as name CSS: JilTV's baked texture loop over its fallback
 * colour (so the name never goes invisible while the image loads), and its
 * shadows as drop-shadow filters. Reduced motion uses the still frame.
 */
export function buildJilTVPaintStyle(
  paint: JilTVPaintView,
  paintShadows: boolean,
  reducedMotion = false,
): { background: string; filter: string } {
  const image = reducedMotion && paint.still ? paint.still : paint.texture;
  if (!isJilTVAssetUrl(image)) return { background: '', filter: '' };
  const fallback = paint.fallback && HEX_COLOR_RE.test(paint.fallback) ? paint.fallback : '';
  const background = fallback
    ? `url("${image}"), linear-gradient(${fallback}, ${fallback})`
    : `url("${image}")`;
  const filter = paintShadows
    ? paint.shadows
      .filter((shadow) => HEX_COLOR_RE.test(shadow.color))
      .map((shadow) => `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})`)
      .join(' ')
    : '';
  return { background, filter };
}
