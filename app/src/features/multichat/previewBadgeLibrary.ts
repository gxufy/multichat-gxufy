
import { getKickChannel, type KickChannel } from '@/lib/kick';
import { parseBadgeMap } from '@/lib/connectors/twitch';
import { loadFFZRoomBadges } from '@/lib/twitchEmotes';
import type { SevenTVBadge } from '@/lib/kick';
import { parseSevenTVBadge } from '@/lib/cosmeticMetadata';
import {
  PREVIEW_FFZ_MOD_BADGE,
  PREVIEW_FFZ_VIP_BADGE,
} from './previewAssets';

export type BadgeProvider = 'Twitch' | 'Kick' | '7TV' | 'FFZ';

export type PreviewBadgeAsset = SevenTVBadge & {
  readonly label: string;
  readonly provider: BadgeProvider;
};

export type BadgeProviderRow = {
  readonly provider: BadgeProvider;
  readonly assets: readonly PreviewBadgeAsset[];
};

export type PreviewBadgeChannels = {
  readonly twitch?: string;
  readonly kick?: string;
};

export type PreviewBadgeResources = {
  readonly assets: readonly PreviewBadgeAsset[];
  readonly twitchBadges: Readonly<Record<string, string>>;
  readonly ffzBadges: Readonly<Record<string, string>>;
  readonly kickChannel: KickChannel | null;
  readonly failedProviders: readonly BadgeProvider[];
};

export class PreviewBadgeLoadError extends Error {
  constructor(
    message: string,
    readonly code: 'network' | 'bad-response',
  ) {
    super(message);
    this.name = 'PreviewBadgeLoadError';
  }
}

export const PREVIEW_BADGE_CATALOG: readonly PreviewBadgeAsset[] = [
  { id: 'ffz-mod', image: PREVIEW_FFZ_MOD_BADGE, label: 'FFZ moderator', provider: 'FFZ' },
  { id: 'ffz-vip', image: PREVIEW_FFZ_VIP_BADGE, label: 'FFZ VIP', provider: 'FFZ' },
  { id: 'kick-broadcaster', image: '/badges/broadcaster.svg', label: 'Kick broadcaster', provider: 'Kick' },
  { id: 'kick-moderator', image: '/badges/moderator.svg', label: 'Kick moderator', provider: 'Kick' },
  { id: 'kick-vip', image: '/badges/vip.svg', label: 'Kick VIP', provider: 'Kick' },
  { id: 'kick-founder', image: '/badges/founder.svg', label: 'Kick founder', provider: 'Kick' },
  { id: 'kick-og', image: '/badges/og.svg', label: 'Kick OG', provider: 'Kick' },
  { id: 'kick-verified', image: '/badges/verified.svg', label: 'Kick verified', provider: 'Kick' },
  { id: 'kick-staff', image: '/badges/staff.svg', label: 'Kick staff', provider: 'Kick' },
  { id: 'kick-subscriber', image: '/badges/subscriber.svg', label: 'Kick subscriber', provider: 'Kick' },
  { id: 'kick-gifter', image: '/badges/gifter-1.svg', label: 'Kick gifter', provider: 'Kick' },
  { id: 'kick-gift-rank', image: '/badges/gift-rank-1.png', label: 'Kick gift rank', provider: 'Kick' },
  { id: 'kick-kicks-rank', image: '/badges/kicks-rank-1.png', label: 'Kick Kicks rank', provider: 'Kick' },
];

const PROVIDER_ORDER: readonly BadgeProvider[] = ['Twitch', 'Kick', '7TV', 'FFZ'];

export function groupByProvider(
  assets: readonly PreviewBadgeAsset[],
): readonly BadgeProviderRow[] {
  const seen = new Set<string>();
  const rows = new Map<BadgeProvider, PreviewBadgeAsset[]>();
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    const bucket = rows.get(asset.provider) ?? [];
    bucket.push(asset);
    rows.set(asset.provider, bucket);
  }
  return PROVIDER_ORDER.flatMap((provider) => {
    const assetsForProvider = rows.get(provider);
    return assetsForProvider?.length ? [{ provider, assets: assetsForProvider }] : [];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function mapBadgeNode(node: unknown): PreviewBadgeAsset | null {
  const badge = parseSevenTVBadge(node);
  if (!badge || !isPlainObject(node)) return null;
  return {
    ...badge,
    label: nonEmptyString(node.tooltip) ? node.tooltip.slice(0, 160) : badge.id,
    provider: '7TV',
  };
}

const SEVENTV_GQL = 'https://7tv.io/v3/gql';
const BADGE_QUERY = 'query { cosmetics(list: []) { badges { id tooltip host { url } } } }';

async function requestSevenTV(signal?: AbortSignal): Promise<readonly PreviewBadgeAsset[]> {
  let response: Response;
  try {
    response = await fetch(SEVENTV_GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: BADGE_QUERY }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new PreviewBadgeLoadError('Badge request failed.', 'network');
  }
  if (!response.ok) throw new PreviewBadgeLoadError('Badge request failed.', 'bad-response');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PreviewBadgeLoadError('Badge response was malformed.', 'bad-response');
  }
  const cosmetics = isPlainObject(body) && isPlainObject(body.data)
    ? body.data.cosmetics
    : undefined;
  const rawBadges = isPlainObject(cosmetics) ? cosmetics.badges : undefined;
  if (!Array.isArray(rawBadges)) {
    throw new PreviewBadgeLoadError('Badge response was malformed.', 'bad-response');
  }
  const assets = rawBadges.flatMap((node) => {
    const asset = mapBadgeNode(node);
    return asset ? [asset] : [];
  });
  if (!assets.length) throw new PreviewBadgeLoadError('Badge response was empty.', 'bad-response');
  return assets;
}

function normalizeChannel(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^#|^@/, '');
}

async function requestTwitch(
  channel: string,
  signal?: AbortSignal,
): Promise<{ badges: Record<string, string>; roomId: string | null }> {
  const query = new URLSearchParams({ preview: '1' });
  if (channel) query.set('channel', channel);
  const response = await fetch(`/api/twitch/badges?${query}`, { signal });
  if (!response.ok) throw new PreviewBadgeLoadError('Twitch badges failed.', 'bad-response');
  const body: unknown = await response.json();
  if (!isPlainObject(body)) throw new PreviewBadgeLoadError('Twitch badges were malformed.', 'bad-response');
  const badges = parseBadgeMap(body.badges);
  const roomId = body.roomId === null || body.roomId === undefined
    ? null
    : nonEmptyString(body.roomId) && /^\d+$/.test(body.roomId)
      ? body.roomId
      : undefined;
  if (!badges || roomId === undefined) {
    throw new PreviewBadgeLoadError('Twitch badges were malformed.', 'bad-response');
  }
  return { badges, roomId };
}

function twitchAssets(map: Readonly<Record<string, string>>): PreviewBadgeAsset[] {
  return Object.entries(map).map(([id, image]) => ({
    id: `twitch-${id}`,
    image,
    label: id,
    provider: 'Twitch' as const,
  }));
}

function kickAssets(channel: KickChannel | null): PreviewBadgeAsset[] {
  if (!channel) return [];
  return channel.subscriber_badges.map((badge) => ({
    id: `kick-subscriber-${badge.months}`,
    image: badge.badge_image.src,
    label: `Kick subscriber · ${badge.months} month${badge.months === 1 ? '' : 's'}`,
    provider: 'Kick' as const,
  }));
}

const cache = new Map<string, PreviewBadgeResources>();
const inFlight = new Map<string, Promise<PreviewBadgeResources>>();
let sevenTVCache: readonly PreviewBadgeAsset[] | null = null;
let sevenTVInFlight: Promise<readonly PreviewBadgeAsset[]> | null = null;

export function cachedPreviewBadgeResources(
  channels: PreviewBadgeChannels = {},
): PreviewBadgeResources | null {
  return cache.get(`${normalizeChannel(channels.twitch)}|${normalizeChannel(channels.kick)}`) ?? null;
}

/** Compatibility accessor for the 7TV-only catalog used before orchestration. */
export function cachedPreviewBadges(): readonly PreviewBadgeAsset[] | null {
  return sevenTVCache;
}

export function __resetPreviewBadgeCache(): void {
  cache.clear();
  inFlight.clear();
  sevenTVCache = null;
  sevenTVInFlight = null;
}

async function loadSevenTVBadges(
  signal?: AbortSignal,
): Promise<readonly PreviewBadgeAsset[]> {
  if (sevenTVCache) return sevenTVCache;
  if (sevenTVInFlight) return sevenTVInFlight;
  sevenTVInFlight = requestSevenTV(signal).then(
    (assets) => {
      sevenTVCache = assets;
      sevenTVInFlight = null;
      return assets;
    },
    (error) => {
      sevenTVInFlight = null;
      throw error;
    },
  );
  return sevenTVInFlight;
}

export async function loadPreviewBadgeResources(
  channels: PreviewBadgeChannels = {},
  signal?: AbortSignal,
): Promise<PreviewBadgeResources> {
  const twitch = normalizeChannel(channels.twitch);
  const kick = normalizeChannel(channels.kick);
  const key = `${twitch}|${kick}`;
  const previous = cache.get(key);
  const shared = inFlight.get(key);
  if (shared) return shared;

  const request = (async () => {
    const [sevenTVResult, twitchResult, kickResult] = await Promise.allSettled([
      loadSevenTVBadges(signal),
      requestTwitch(twitch, signal),
      kick ? getKickChannel(kick, signal) : Promise.resolve(null),
    ]);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const failed: BadgeProvider[] = [];
    const sevenTV = sevenTVResult.status === 'fulfilled'
      ? sevenTVResult.value
      : (failed.push('7TV'), previous?.assets.filter((asset) => asset.provider === '7TV') ?? []);
    const twitchData = twitchResult.status === 'fulfilled'
      ? twitchResult.value
      : (failed.push('Twitch'), {
          badges: { ...(previous?.twitchBadges ?? {}) },
          roomId: null,
        });
    let kickChannel: KickChannel | null = previous?.kickChannel ?? null;
    if (kick) {
      if (kickResult.status === 'fulfilled' && kickResult.value) {
        kickChannel = kickResult.value;
      } else {
        failed.push('Kick');
      }
    } else {
      kickChannel = null;
    }

    let ffzBadges: Record<string, string> = { ...(previous?.ffzBadges ?? {}) };
    if (twitchData.roomId) {
      try {
        ffzBadges = await loadFFZRoomBadges(twitchData.roomId, signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        failed.push('FFZ');
      }
    }

    const result: PreviewBadgeResources = {
      assets: [...PREVIEW_BADGE_CATALOG, ...sevenTV, ...twitchAssets(twitchData.badges), ...kickAssets(kickChannel)],
      twitchBadges: twitchData.badges,
      ffzBadges,
      kickChannel,
      failedProviders: failed,
    };
    cache.set(key, result);
    return result;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** Compatibility facade used by focused 7TV loader tests and callers. */
export function loadPreviewBadges(signal?: AbortSignal): Promise<readonly PreviewBadgeAsset[]> {
  return loadSevenTVBadges(signal);
}
