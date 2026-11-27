/*
 * The cosmetic data a chat message is built from, and a 7TV paint as CSS.
 *
 * Kept apart from multichatMessageModel.tsx (which re-exports all of it) so
 * that code such as the support and badges pages and the preview identity
 * loader can use it without loading the overlay renderer.
 *
 * Browser-safe: no server-only imports, no secrets, no network.
 */
import {
  decimalToRGBA,
  type Entitlements,
  type KickChannel,
  type SevenTVBadge,
  type SevenTVEmote,
  type SevenTVPaint,
} from './kick';
import { parseSevenTVPaint } from './cosmeticMetadata';
import type { Platform } from './types';
import type { PaintSource } from './paintChoice';

/**
 * The cosmetic data a conversion reads from.
 *
 * The overlay fills this from live 7TV lookups as they resolve; the generator
 * preview fills it from fixtures. Both shapes are the same, so neither needs a
 * special case in the conversion itself.
 */
export type ThirdPartyEmoteCatalog = Partial<
  Record<Extract<Platform, 'kick' | 'twitch' | 'youtube'>, SevenTVEmote[]>
>;

export type MessageCosmetics = {
  /** Community emotes scoped by platform; providers never cross chat services. */
  emotes: ThirdPartyEmoteCatalog;
  badges: SevenTVBadge[];
  paints: SevenTVPaint[];
  /** Keyed `${platform}:${senderId}`, as the cosmetics fetcher keys them. */
  entitlements: Entitlements;
  /** Which paint each chatter asked for when they wear both (paintChoice.ts),
   *  keyed `${platform}:${senderId}`. Optional: without it JilTV's is shown. */
  paintSources?: ReadonlyMap<string, PaintSource>;
  /** Chatters' personal 7TV emotes, keyed `${platform}:${senderId}`. Optional. */
  personalEmotes?: Record<string, SevenTVEmote[]>;
  /** Kick channel, for its subscriber badge tiers. Null when not loaded. */
  channel: KickChannel | null;
};

/** Empty cosmetics, for a caller with no 7TV data at all. */
export const NO_COSMETICS: MessageCosmetics = {
  emotes: {},
  badges: [],
  paints: [],
  entitlements: {},
  channel: null,
};

/**
 * A 7TV paint as CSS: a gradient (or image) for `background`, shadows for
 * `filter`.
 *
 * `paintShadows` is honoured by returning an empty filter rather than by
 * dropping the paint, so turning shadows off leaves the gradient intact — which
 * is what the setting claims to do.
 */
export function buildPaintStyle(
  paint: SevenTVPaint,
  paintShadows: boolean,
): { background: string; filter: string } {
  const normalizedPaint = parseSevenTVPaint(paint);
  if (!normalizedPaint) return { background: '', filter: '' };
  paint = normalizedPaint;
  const parts: string[] = [];
  const shadows: string[] = [];
  let prefix = '';
  if (paint.func === 'URL') {
    parts.push(paint.image_url ?? '');
  } else {
    if (paint.func === 'LINEAR_GRADIENT') parts.push(`${paint.angle ?? 0}deg`);
    else if (paint.func === 'RADIAL_GRADIENT') parts.push(paint.shape ?? 'circle');
    prefix = paint.repeat ? 'repeating-' : '';
    for (const stop of paint.stops) {
      parts.push(`${decimalToRGBA(stop.color)} ${stop.at * 100}%`);
    }
  }
  for (const shadow of paint.shadows) {
    if (!paintShadows) break;
    shadows.push(
      `drop-shadow(${shadow.x_offset}px ${shadow.y_offset}px ${shadow.radius}px ${decimalToRGBA(shadow.color)})`,
    );
  }
  /* Replace every underscore, not just the first: REPEATING_LINEAR_GRADIENT
     would otherwise emit repeating-linear_gradient() and the whole paint would
     be dropped as an invalid value. */
  const func = paint.func.toLowerCase().replace(/_/g, '-');
  const background =
    paint.func === 'URL'
      ? // quoted: an unquoted url() breaks on ")" or whitespace in the URL
        `url("${parts[0].replace(/["\\]/g, (c) => `\\${c}`)}")`
      : `${prefix}${func}(${parts.join(', ')})`;
  const filter = paintShadows ? shadows.join(' ') : '';
  return { background, filter };
}
