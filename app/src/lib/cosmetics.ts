import type { SevenTVBadge, SevenTVPaint, Entitlements } from './kick';
import {
  parseCosmeticBadge,
  parseSevenTVBadge,
  parseSevenTVPaint,
  validateCosmeticAssetUrl,
} from './cosmeticMetadata';

export const SEVENTV_V4_GQL = 'https://api.7tv.app/v4/gql';

/*
 * 7TV rejects any v4 query whose complexity exceeds 400 with
 * `{ data: null, errors: [{ message: 'Query is too complex.' }] }` (HTTP 200).
 * One userByConnection with SEVENTV_V4_STYLE_FIELDS costs 40, so 9 users is the
 * hard ceiling (measured 2026-11-14). Stay one below it for headroom.
 */
export const SEVENTV_V4_MAX_USERS_PER_QUERY = 8;
/** Users the live fetcher drains per flush, sent as parallel capped queries. */
export const SEVENTV_V4_USERS_PER_FLUSH = 40;

export const SEVENTV_V4_STYLE_FIELDS = `
  style {
    activePaint {
      id
      data {
        layers {
          opacity
          ty {
            __typename
            ... on PaintLayerTypeSingleColor {
              color { hex }
            }
            ... on PaintLayerTypeLinearGradient {
              angle
              repeating
              stops { at color { hex } }
            }
            ... on PaintLayerTypeRadialGradient {
              repeating
              shape
              stops { at color { hex } }
            }
            ... on PaintLayerTypeImage {
              images { url mime scale frameCount }
            }
          }
        }
        shadows {
          color { hex }
          offsetX
          offsetY
          blur
        }
      }
    }
    activeBadge {
      id
      images { url mime scale frameCount }
    }
  }
`;

export interface CosmeticsStores {
  paints: SevenTVPaint[];
  badges: SevenTVBadge[];
  entitlements: Entitlements;
}

/** How long a new chatter's lookups wait to be grouped into one request. */
export const COSMETICS_FLUSH_DELAY_MS = 100;

export interface CosmeticsFetcher {
  /** queue a chatter for cosmetics lookup (no-op if already seen) */
  want(platform: 'kick' | 'twitch', senderId: string): void;
  /** True while this chatter's first lookup has not answered yet. */
  isPending(platform: string, senderId: string | undefined): boolean;
  stop(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function colorHexToUint32(value: unknown): number | null {
  const record = isRecord(value) ? value : null;
  const hex = typeof record?.hex === 'string' ? record.hex : '';
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex)) return null;
  return Number.parseInt(hex.slice(1) + (hex.length === 7 ? 'ff' : ''), 16);
}

function applyOpacity(color: number, opacity: number): number {
  const alpha = color & 0xff;
  const nextAlpha = Math.max(0, Math.min(255, Math.round(alpha * opacity)));
  return (((color & 0xffffff00) | nextAlpha) >>> 0);
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function chooseV4Image(value: unknown, preferredScale: number): string | null {
  if (!Array.isArray(value)) return null;
  const candidates = value
    .filter(isRecord)
    .map((image) => ({
      url: validateCosmeticAssetUrl(image.url, '7tv'),
      scale: numeric(image.scale) ?? 0,
      animated: (numeric(image.frameCount) ?? 0) > 1,
    }))
    .filter((image): image is { url: string; scale: number; animated: boolean } => Boolean(image.url));

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const aPreferred = a.scale === preferredScale ? 1 : 0;
    const bPreferred = b.scale === preferredScale ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    if (a.animated !== b.animated) return Number(b.animated) - Number(a.animated);
    return b.scale - a.scale;
  });
  return candidates[0]!.url;
}

/**
 * Convert the current 7TV v4 paint payload into the renderer's bounded legacy
 * paint model. The renderer currently consumes one background paint, so when a
 * v4 paint has multiple visual layers we use the topmost supported non-empty
 * layer while preserving the paint's complete shadow stack.
 */
export function parseSevenTVV4Paint(value: unknown): SevenTVPaint | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const data = isRecord(value.data) ? value.data : null;
  const layers = Array.isArray(data?.layers) ? data.layers : [];

  const rawShadows = Array.isArray(data?.shadows) ? data.shadows : [];
  const shadows = rawShadows.map((shadow) => {
    if (!isRecord(shadow)) return null;
    const color = colorHexToUint32(shadow.color);
    const x = numeric(shadow.offsetX);
    const y = numeric(shadow.offsetY);
    const radius = numeric(shadow.blur);
    if (color === null || x === null || y === null || radius === null) return null;
    return { color, x_offset: x, y_offset: y, radius };
  }).filter((shadow): shadow is NonNullable<typeof shadow> => shadow !== null);

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = isRecord(layers[index]) ? layers[index] : null;
    const ty = isRecord(layer?.ty) ? layer.ty : null;
    const typename = typeof ty?.__typename === 'string' ? ty.__typename : '';
    const opacityRaw = numeric(layer?.opacity);
    const opacity = opacityRaw === null ? 1 : Math.max(0, Math.min(1, opacityRaw));
    if (!ty || opacity <= 0) continue;

    if (typename === 'PaintLayerTypeSingleColor') {
      const color = colorHexToUint32(ty.color);
      if (color === null) continue;
      const withOpacity = applyOpacity(color, opacity);
      return parseSevenTVPaint({
        id: value.id,
        function: 'LINEAR_GRADIENT',
        angle: 0,
        repeat: false,
        stops: [
          { color: withOpacity, at: 0 },
          { color: withOpacity, at: 1 },
        ],
        shadows,
      });
    }

    if (typename === 'PaintLayerTypeLinearGradient') {
      const stops = Array.isArray(ty.stops)
        ? ty.stops.map((stop: unknown) => {
            if (!isRecord(stop)) return null;
            const color = colorHexToUint32(stop.color);
            const at = numeric(stop.at);
            if (color === null || at === null) return null;
            return { color: applyOpacity(color, opacity), at };
          }).filter((stop: { color: number; at: number } | null): stop is { color: number; at: number } => stop !== null)
        : [];
      return parseSevenTVPaint({
        id: value.id,
        function: 'LINEAR_GRADIENT',
        angle: numeric(ty.angle) ?? 0,
        repeat: ty.repeating === true,
        stops,
        shadows,
      });
    }

    if (typename === 'PaintLayerTypeRadialGradient') {
      const stops = Array.isArray(ty.stops)
        ? ty.stops.map((stop: unknown) => {
            if (!isRecord(stop)) return null;
            const color = colorHexToUint32(stop.color);
            const at = numeric(stop.at);
            if (color === null || at === null) return null;
            return { color: applyOpacity(color, opacity), at };
          }).filter((stop: { color: number; at: number } | null): stop is { color: number; at: number } => stop !== null)
        : [];
      return parseSevenTVPaint({
        id: value.id,
        function: 'RADIAL_GRADIENT',
        repeat: ty.repeating === true,
        shape: typeof ty.shape === 'string' ? ty.shape : undefined,
        stops,
        shadows,
      });
    }

    if (typename === 'PaintLayerTypeImage') {
      const imageUrl = chooseV4Image(ty.images, 1);
      if (!imageUrl) continue;
      return parseSevenTVPaint({
        id: value.id,
        function: 'URL',
        image_url: imageUrl,
        repeat: false,
        shadows,
      });
    }
  }

  return null;
}

export function parseSevenTVV4Badge(value: unknown): SevenTVBadge | null {
  if (!isRecord(value)) return null;
  const image = chooseV4Image(value.images, 3);
  return parseCosmeticBadge({ id: value.id, image }, '7tv');
}

/**
 * Merge one cosmetics batch with the existing catalog while preserving the
 * previous "remove then append" semantics.
 */
function mergeBatchToEnd<T extends { id: string }>(existing: T[], updates: Map<string, T>): T[] {
  if (!updates.size) return existing;
  return [
    ...existing.filter((item) => !updates.has(item.id)),
    ...updates.values(),
  ];
}

export function createCosmeticsFetcher(
  stores: CosmeticsStores,
  onApplied: (keys: string[]) => void,
): CosmeticsFetcher {
  const seen = new Set<string>();
  /* Wanted but not answered yet (queued or in flight). */
  const pending = new Set<string>();
  const queue: Array<{ platform: 'kick' | 'twitch'; senderId: string }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const activeControllers = new Set<AbortController>();

  async function flush() {
    timer = null;
    if (stopped || !queue.length) return;
    const drained = queue.splice(0, SEVENTV_V4_USERS_PER_FLUSH);
    if (queue.length) schedule();

    const chunks: Array<typeof drained> = [];
    for (let start = 0; start < drained.length; start += SEVENTV_V4_MAX_USERS_PER_QUERY) {
      chunks.push(drained.slice(start, start + SEVENTV_V4_MAX_USERS_PER_QUERY));
    }
    await Promise.all(chunks.map((batch) => flushBatch(batch)));
  }

  async function flushBatch(batch: Array<{ platform: 'kick' | 'twitch'; senderId: string }>) {
    try {
      await lookupBatch(batch);
    } finally {
      for (const entry of batch) pending.delete(`${entry.platform}:${entry.senderId}`);
    }
  }

  async function lookupBatch(batch: Array<{ platform: 'kick' | 'twitch'; senderId: string }>) {
    if (stopped) return;
    const parts = batch.map((entry, index) =>
      `u${index}: userByConnection(platform: ${entry.platform.toUpperCase()}, platformId: ${JSON.stringify(entry.senderId)}) { ${SEVENTV_V4_STYLE_FIELDS} }`
    );

    let data: unknown;
    const controller = new AbortController();
    activeControllers.add(controller);
    try {
      const response = await fetch(SEVENTV_V4_GQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `query { users { ${parts.join(' ')} } }` }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('request failed');
      const body: unknown = await response.json();
      const root = isRecord(body) ? body.data : null;
      data = isRecord(root)
        ? (isRecord(root.users) ? root.users : root)
        : null;
    } catch {
      for (const entry of batch) seen.delete(`${entry.platform}:${entry.senderId}`);
      return;
    } finally {
      activeControllers.delete(controller);
    }

    if (stopped || !isRecord(data)) {
      for (const entry of batch) seen.delete(`${entry.platform}:${entry.senderId}`);
      return;
    }

    const result = data;
    const applied: string[] = [];
    const paintUpdates = new Map<string, SevenTVPaint>();
    const badgeUpdates = new Map<string, SevenTVBadge>();

    batch.forEach((entry, index) => {
      const user = result[`u${index}`];
      const style = isRecord(user) && isRecord(user.style) ? user.style : null;
      if (!style) return;

      const key = `${entry.platform}:${entry.senderId}`;
      const ent: { badge?: string; paint?: string } = { ...stores.entitlements[key] };

      const mappedPaint = parseSevenTVV4Paint(style.activePaint)
        ?? parseSevenTVPaint(style.paint);
      if (mappedPaint) {
        paintUpdates.delete(mappedPaint.id);
        paintUpdates.set(mappedPaint.id, mappedPaint);
        ent.paint = mappedPaint.id;
      }

      const mappedBadge = parseSevenTVV4Badge(style.activeBadge)
        ?? parseSevenTVBadge(style.badge);
      if (mappedBadge) {
        badgeUpdates.delete(mappedBadge.id);
        badgeUpdates.set(mappedBadge.id, mappedBadge);
        ent.badge = mappedBadge.id;
      }

      if (ent.paint || ent.badge) {
        stores.entitlements[key] = ent;
        applied.push(key);
      }
    });

    if (paintUpdates.size) stores.paints = mergeBatchToEnd(stores.paints, paintUpdates);
    if (badgeUpdates.size) stores.badges = mergeBatchToEnd(stores.badges, badgeUpdates);
    if (applied.length) onApplied(applied);
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, COSMETICS_FLUSH_DELAY_MS);
  }

  return {
    want(platform, senderId) {
      if (stopped || !senderId) return;
      const key = `${platform}:${senderId}`;
      if (seen.has(key)) return;
      seen.add(key);
      pending.add(key);
      queue.push({ platform, senderId });
      schedule();
    },
    isPending(platform, senderId) {
      return Boolean(senderId) && pending.has(`${platform}:${senderId}`);
    },
    stop() {
      stopped = true;
      queue.length = 0;
      pending.clear();
      if (timer) clearTimeout(timer);
      timer = null;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    },
  };
}
