import type { SevenTVBadge, SevenTVPaint } from './kick';

export type CosmeticAssetProvider = '7tv' | 'ffz' | 'bttv';

export const COSMETIC_METADATA_LIMITS = Object.freeze({
  idLength: 128,
  urlLength: 2_048,
  gradientStops: 16,
  shadows: 8,
  angleMagnitude: 3_600,
  shadowOffsetMagnitude: 64,
  shadowRadius: 64,
});

const COSMETIC_CDN_DOMAINS: Readonly<Record<CosmeticAssetProvider, readonly string[]>> = {
  '7tv': ['cdn.7tv.app'],
  ffz: ['cdn.frankerfacez.com', 'cdn2.frankerfacez.com'],
  bttv: ['cdn.betterttv.net'],
};

const PAINT_FUNCTIONS = new Set(['LINEAR_GRADIENT', 'RADIAL_GRADIENT', 'URL']);
const RADIAL_SHAPES = new Set(['circle', 'ellipse']);
const UINT32_MAX = 0xffff_ffff;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cosmeticId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > COSMETIC_METADATA_LIMITS.idLength) return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function isAllowedHost(hostname: string, domains: readonly string[]): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

/** Validate a provider-owned cosmetic asset without widening unrelated image policy. */
export function validateCosmeticAssetUrl(
  value: unknown,
  provider: CosmeticAssetProvider,
): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > COSMETIC_METADATA_LIMITS.urlLength) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || !isAllowedHost(hostname, COSMETIC_CDN_DOMAINS[provider])) return null;
    // Canonicalize IDNA/casing and remove a harmless-but-ambiguous trailing dot.
    url.hostname = hostname;
    return url.toString();
  } catch {
    return null;
  }
}

/** Convert 7TV's protocol-relative badge host into its 3x asset URL. */
export function sevenTVBadgeImageFromHost(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('//') || value.startsWith('///')) return null;
  try {
    const base = new URL(`https:${value}`);
    if (base.search || base.hash) return null;
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/3x`;
    return validateCosmeticAssetUrl(base.toString(), '7tv');
  } catch {
    return null;
  }
}

export function parseSevenTVBadge(value: unknown): SevenTVBadge | null {
  try {
    if (!isPlainObject(value)) return null;
    const id = cosmeticId(value.id);
    const host = isPlainObject(value.host) ? value.host.url : undefined;
    const image = sevenTVBadgeImageFromHost(host);
    return id && image ? { id, image } : null;
  } catch {
    return null;
  }
}

export function parseCosmeticBadge(
  value: unknown,
  provider: CosmeticAssetProvider,
): SevenTVBadge | null {
  try {
    if (!isPlainObject(value)) return null;
    const id = cosmeticId(value.id);
    const image = validateCosmeticAssetUrl(value.image, provider);
    return id && image ? { id, image } : null;
  } catch {
    return null;
  }
}

export function createSevenTVBadgeFromEvent(
  idValue: unknown,
  hostValue: unknown,
): SevenTVBadge | null {
  const id = cosmeticId(idValue);
  if (!id) return null;
  if (hostValue === undefined || hostValue === null || hostValue === '') {
    return { id, image: `https://cdn.7tv.app/badge/${encodeURIComponent(id)}/3x` };
  }
  const image = sevenTVBadgeImageFromHost(hostValue);
  return image ? { id, image } : null;
}

function uint32(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= UINT32_MAX;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** Normalize the legacy 7TV paint fields consumed by the current overlay renderer. */
export function parseSevenTVPaint(value: unknown): SevenTVPaint | null {
  try {
    if (!isPlainObject(value)) return null;
    const id = cosmeticId(value.id);
    const rawFunction = value.func ?? value.function;
    if (!id || typeof rawFunction !== 'string' || !PAINT_FUNCTIONS.has(rawFunction)) return null;
    if (value.func !== undefined && value.function !== undefined && value.func !== value.function) return null;

    if (value.repeat !== undefined && value.repeat !== null && typeof value.repeat !== 'boolean') return null;
    if (value.angle !== undefined && value.angle !== null && !boundedNumber(
      value.angle,
      -COSMETIC_METADATA_LIMITS.angleMagnitude,
      COSMETIC_METADATA_LIMITS.angleMagnitude,
    )) return null;
    if (value.color !== undefined && value.color !== null && !uint32(value.color)) return null;

    const rawStops = value.stops ?? [];
    if (!Array.isArray(rawStops) || rawStops.length > COSMETIC_METADATA_LIMITS.gradientStops) return null;
    const stops: SevenTVPaint['stops'] = [];
    for (const stop of rawStops) {
      if (!isPlainObject(stop) || !uint32(stop.color) || !boundedNumber(stop.at, 0, 1)) return null;
      stops.push({ color: stop.color, at: stop.at });
    }

    const rawShadows = value.shadows ?? [];
    if (!Array.isArray(rawShadows) || rawShadows.length > COSMETIC_METADATA_LIMITS.shadows) return null;
    const shadows: SevenTVPaint['shadows'] = [];
    for (const shadow of rawShadows) {
      if (
        !isPlainObject(shadow)
        || !uint32(shadow.color)
        || !boundedNumber(
          shadow.x_offset,
          -COSMETIC_METADATA_LIMITS.shadowOffsetMagnitude,
          COSMETIC_METADATA_LIMITS.shadowOffsetMagnitude,
        )
        || !boundedNumber(
          shadow.y_offset,
          -COSMETIC_METADATA_LIMITS.shadowOffsetMagnitude,
          COSMETIC_METADATA_LIMITS.shadowOffsetMagnitude,
        )
        || !boundedNumber(shadow.radius, 0, COSMETIC_METADATA_LIMITS.shadowRadius)
      ) return null;
      shadows.push({
        color: shadow.color,
        x_offset: shadow.x_offset,
        y_offset: shadow.y_offset,
        radius: shadow.radius,
      });
    }

    let imageUrl: string | undefined;
    if (rawFunction === 'URL') {
      imageUrl = validateCosmeticAssetUrl(value.image_url, '7tv') ?? undefined;
      if (!imageUrl) return null;
    }

    let shape: string | undefined;
    if (rawFunction === 'RADIAL_GRADIENT' && value.shape !== undefined && value.shape !== null) {
      if (typeof value.shape !== 'string') return null;
      const normalizedShape = value.shape.toLowerCase();
      if (!RADIAL_SHAPES.has(normalizedShape)) return null;
      shape = normalizedShape;
    }

    return {
      id,
      func: rawFunction,
      repeat: value.repeat === true,
      shadows,
      stops,
      ...(typeof value.angle === 'number' ? { angle: value.angle } : {}),
      ...(typeof value.color === 'number' ? { color: value.color } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(shape ? { shape } : {}),
    };
  } catch {
    return null;
  }
}
