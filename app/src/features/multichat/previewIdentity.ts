import type {
  MessageCosmetics,
} from '@/lib/multichatMessageModel';
import { NO_COSMETICS } from '@/lib/multichatMessageModel';
import type {
  SevenTVBadge,
  SevenTVEmote,
  SevenTVPaint,
} from '@/lib/kick';
import {
  parseCosmeticBadge,
  parseSevenTVPaint,
  type CosmeticAssetProvider,
} from '@/lib/cosmeticMetadata';
import type { UnifiedBadge, UnifiedMessage } from '@/lib/types';

export const PREVIEW_IDENTITY_PROVIDERS = ['Twitch', 'FFZ', 'BTTV', '7TV'] as const;
export type PreviewIdentityProvider = (typeof PREVIEW_IDENTITY_PROVIDERS)[number];
export type PreviewIdentityProviderStatus = 'loaded' | 'unavailable' | 'failed';
export type EmoteScope = 'global' | 'room' | 'channel' | 'shared' | 'personal';

export type TwitchPreviewIdentity = {
  readonly userId: string;
  readonly login: string;
  readonly displayName: string;
};

export type PreviewIdentityEmote = SevenTVEmote & {
  readonly id: string;
  readonly provider: Exclude<PreviewIdentityProvider, 'Twitch'>;
  readonly scope: EmoteScope;
};

export type TwitchIdentityResources = {
  readonly globalBadges: Readonly<Record<string, string>>;
  readonly channelBadges: Readonly<Record<string, string>>;
};

export type FFZIdentityResources = {
  readonly globalEmotes: readonly PreviewIdentityEmote[];
  readonly roomEmotes: readonly PreviewIdentityEmote[];
  readonly badgeOverrides: Readonly<Record<string, string>>;
  readonly ownedBadges?: readonly SevenTVBadge[];
};

export type BTTVIdentityResources = {
  readonly globalEmotes: readonly PreviewIdentityEmote[];
  readonly channelEmotes: readonly PreviewIdentityEmote[];
  readonly sharedEmotes: readonly PreviewIdentityEmote[];
  readonly ownedBadges?: readonly SevenTVBadge[];
};

export type SevenTVIdentityResources = {
  readonly globalEmotes: readonly PreviewIdentityEmote[];
  readonly channelEmotes: readonly PreviewIdentityEmote[];
  readonly personalEmotes: readonly PreviewIdentityEmote[];
  readonly paint: SevenTVPaint | null;
  readonly badge: SevenTVBadge | null;
};

export type PreviewProviderOutcome<T> = {
  readonly status: PreviewIdentityProviderStatus;
  /** Successful subresources remain usable when another request in this provider failed. */
  readonly resources: T;
};

export type PreviewIdentityProviderMap = {
  readonly Twitch: PreviewProviderOutcome<TwitchIdentityResources>;
  readonly FFZ: PreviewProviderOutcome<FFZIdentityResources>;
  readonly BTTV: PreviewProviderOutcome<BTTVIdentityResources>;
  readonly '7TV': PreviewProviderOutcome<SevenTVIdentityResources>;
};

export type PreviewIdentityResponse = {
  readonly identity: TwitchPreviewIdentity;
  /** Retry responses intentionally contain only the requested provider slices. */
  readonly providers: Partial<PreviewIdentityProviderMap>;
};

export const EMPTY_TWITCH_IDENTITY_RESOURCES: TwitchIdentityResources = {
  globalBadges: {},
  channelBadges: {},
};
export const EMPTY_FFZ_IDENTITY_RESOURCES: FFZIdentityResources = {
  globalEmotes: [],
  roomEmotes: [],
  badgeOverrides: {},
  ownedBadges: [],
};
export const EMPTY_BTTV_IDENTITY_RESOURCES: BTTVIdentityResources = {
  globalEmotes: [],
  channelEmotes: [],
  sharedEmotes: [],
  ownedBadges: [],
};
export const EMPTY_SEVENTV_IDENTITY_RESOURCES: SevenTVIdentityResources = {
  globalEmotes: [],
  channelEmotes: [],
  personalEmotes: [],
  paint: null,
  badge: null,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpsUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseBadgeMap(value: unknown): Record<string, string> | null {
  if (!isPlainObject(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, image] of Object.entries(value)) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(key) || !httpsUrl(image)) return null;
    result[key] = image;
  }
  return result;
}

function parseEmote(value: unknown, provider: PreviewIdentityEmote['provider'], scope: EmoteScope): PreviewIdentityEmote | null {
  if (!isPlainObject(value)) return null;
  if (!nonEmptyString(value.id) || !nonEmptyString(value.name) || !httpsUrl(value.image)) return null;
  if (!positiveNumber(value.height) || !positiveNumber(value.width)) return null;
  if (typeof value.zeroWidth !== 'boolean' || typeof value.upscale !== 'boolean') return null;
  return {
    id: value.id,
    name: value.name,
    image: value.image,
    height: value.height,
    width: value.width,
    zeroWidth: value.zeroWidth,
    upscale: value.upscale,
    provider,
    scope,
  };
}

function parseEmoteArray(value: unknown, provider: PreviewIdentityEmote['provider'], scope: EmoteScope): PreviewIdentityEmote[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    const parsed = parseEmote(entry, provider, scope);
    return parsed ? [parsed] : [];
  });
}

function parseOwnedBadges(value: unknown, provider: CosmeticAssetProvider): SevenTVBadge[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const badges: SevenTVBadge[] = [];
  for (const entry of value) {
    const badge = parseCosmeticBadge(entry, provider);
    if (badge) badges.push(badge);
  }
  return badges;
}

function parseStatus(value: unknown): PreviewIdentityProviderStatus | null {
  return value === 'loaded' || value === 'unavailable' || value === 'failed' ? value : null;
}

function parseOutcome<T>(value: unknown, parseResources: (value: unknown) => T | null): PreviewProviderOutcome<T> | null {
  if (!isPlainObject(value)) return null;
  const status = parseStatus(value.status);
  const resources = parseResources(value.resources);
  return status && resources ? { status, resources } : null;
}

function parseTwitchResources(value: unknown): TwitchIdentityResources | null {
  if (!isPlainObject(value)) return null;
  const globalBadges = parseBadgeMap(value.globalBadges);
  const channelBadges = parseBadgeMap(value.channelBadges);
  return globalBadges && channelBadges ? { globalBadges, channelBadges } : null;
}

function parseFFZResources(value: unknown): FFZIdentityResources | null {
  if (!isPlainObject(value)) return null;
  const globalEmotes = parseEmoteArray(value.globalEmotes, 'FFZ', 'global');
  const roomEmotes = parseEmoteArray(value.roomEmotes, 'FFZ', 'room');
  const badgeOverrides = parseBadgeMap(value.badgeOverrides);
  const ownedBadges = parseOwnedBadges(value.ownedBadges, 'ffz');
  return globalEmotes && roomEmotes && badgeOverrides && ownedBadges
    ? { globalEmotes, roomEmotes, badgeOverrides, ownedBadges }
    : null;
}

function parseBTTVResources(value: unknown): BTTVIdentityResources | null {
  if (!isPlainObject(value)) return null;
  const globalEmotes = parseEmoteArray(value.globalEmotes, 'BTTV', 'global');
  const channelEmotes = parseEmoteArray(value.channelEmotes, 'BTTV', 'channel');
  const sharedEmotes = parseEmoteArray(value.sharedEmotes, 'BTTV', 'shared');
  const ownedBadges = parseOwnedBadges(value.ownedBadges, 'bttv');
  return globalEmotes && channelEmotes && sharedEmotes && ownedBadges
    ? { globalEmotes, channelEmotes, sharedEmotes, ownedBadges }
    : null;
}

function parseSevenTVResources(value: unknown): SevenTVIdentityResources | null {
  if (!isPlainObject(value)) return null;
  const globalEmotes = parseEmoteArray(value.globalEmotes, '7TV', 'global');
  const channelEmotes = parseEmoteArray(value.channelEmotes, '7TV', 'channel');
  const personalEmotes = parseEmoteArray(value.personalEmotes, '7TV', 'personal');
  const paint = value.paint === null || value.paint === undefined ? null : parseSevenTVPaint(value.paint);
  const badge = value.badge === null || value.badge === undefined ? null : parseCosmeticBadge(value.badge, '7tv');
  return globalEmotes && channelEmotes && personalEmotes
    ? { globalEmotes, channelEmotes, personalEmotes, paint, badge }
    : null;
}

export function parsePreviewIdentityResponse(value: unknown): PreviewIdentityResponse | null {
  if (!isPlainObject(value) || !isPlainObject(value.identity) || !isPlainObject(value.providers)) return null;
  const { identity, providers } = value;
  if (!nonEmptyString(identity.userId) || !/^\d+$/.test(identity.userId)) return null;
  if (!nonEmptyString(identity.login) || !/^[a-z0-9_]{1,25}$/.test(identity.login)) return null;
  if (!nonEmptyString(identity.displayName)) return null;
  const parsedProviders: {
    Twitch?: PreviewProviderOutcome<TwitchIdentityResources>;
    FFZ?: PreviewProviderOutcome<FFZIdentityResources>;
    BTTV?: PreviewProviderOutcome<BTTVIdentityResources>;
    '7TV'?: PreviewProviderOutcome<SevenTVIdentityResources>;
  } = {};
  for (const key of Object.keys(providers)) {
    if (!(PREVIEW_IDENTITY_PROVIDERS as readonly string[]).includes(key)) return null;
  }
  if (providers.Twitch !== undefined) {
    const parsed = parseOutcome(providers.Twitch, parseTwitchResources);
    if (!parsed) return null;
    parsedProviders.Twitch = parsed;
  }
  if (providers.FFZ !== undefined) {
    const parsed = parseOutcome(providers.FFZ, parseFFZResources);
    if (!parsed) return null;
    parsedProviders.FFZ = parsed;
  }
  if (providers.BTTV !== undefined) {
    const parsed = parseOutcome(providers.BTTV, parseBTTVResources);
    if (!parsed) return null;
    parsedProviders.BTTV = parsed;
  }
  if (providers['7TV'] !== undefined) {
    const parsed = parseOutcome(providers['7TV'], parseSevenTVResources);
    if (!parsed) return null;
    parsedProviders['7TV'] = parsed;
  }
  return {
    identity: {
      userId: identity.userId,
      login: identity.login,
      displayName: identity.displayName,
    },
    providers: parsedProviders,
  };
}

export function mergeTwitchBadgeMaps(resources: TwitchIdentityResources): Record<string, string> {
  return { ...resources.globalBadges, ...resources.channelBadges };
}

/** Production precedence: Twitch globals, Twitch channel art, then FFZ room overrides. */
export function mergePreviewIdentityBadgeMaps(
  providers: Partial<PreviewIdentityProviderMap>,
): Record<string, string> {
  return {
    ...(providers.Twitch ? mergeTwitchBadgeMaps(providers.Twitch.resources) : {}),
    ...(providers.FFZ?.resources.badgeOverrides ?? {}),
  };
}

export function mergeIdentityEmotes(providers: Partial<PreviewIdentityProviderMap>): PreviewIdentityEmote[] {
  const ordered = [
    ...(providers.FFZ?.resources.globalEmotes ?? []),
    ...(providers.FFZ?.resources.roomEmotes ?? []),
    ...(providers.BTTV?.resources.globalEmotes ?? []),
    ...(providers.BTTV?.resources.channelEmotes ?? []),
    ...(providers.BTTV?.resources.sharedEmotes ?? []),
    ...(providers['7TV']?.resources.globalEmotes ?? []),
    ...(providers['7TV']?.resources.channelEmotes ?? []),
    ...(providers['7TV']?.resources.personalEmotes ?? []),
  ];
  const merged = new Map<string, PreviewIdentityEmote>();
  for (const emote of ordered) merged.set(emote.name, emote);
  return [...merged.values()];
}

export function failedPreviewIdentityProviders(response: PreviewIdentityResponse): PreviewIdentityProvider[] {
  return PREVIEW_IDENTITY_PROVIDERS.filter((provider) => response.providers[provider]?.status === 'failed');
}

export function mergePreviewIdentityRetry(current: PreviewIdentityResponse, retry: PreviewIdentityResponse): PreviewIdentityResponse | null {
  if (current.identity.userId !== retry.identity.userId || current.identity.login !== retry.identity.login) return null;
  return { identity: retry.identity, providers: { ...current.providers, ...retry.providers } };
}

export function buildPreviewIdentityCosmetics(
  response: PreviewIdentityResponse,
  base: MessageCosmetics = NO_COSMETICS,
): MessageCosmetics {
  const sevenTV = response.providers['7TV']?.resources;
  const emotes = mergeIdentityEmotes(response.providers);
  const thirdPartyBadges = [
    ...(response.providers.BTTV?.resources.ownedBadges ?? []),
    ...(response.providers.FFZ?.resources.ownedBadges ?? []),
    ...(sevenTV?.badge ? [sevenTV.badge] : []),
  ];
  const badgeMap = new Map(base.badges.map((badge) => [badge.id, badge]));
  for (const badge of thirdPartyBadges) badgeMap.set(badge.id, badge);
  const badges = [...badgeMap.values()];
  const paints = sevenTV?.paint
    ? [...base.paints.filter((paint) => paint.id !== sevenTV.paint!.id), sevenTV.paint]
    : [...base.paints];
  const entitlement = {
    ...(sevenTV?.badge ? { badge: sevenTV.badge.id } : {}),
    ...(sevenTV?.paint ? { paint: sevenTV.paint.id } : {}),
  };
  return {
    ...base,
    emotes: { ...base.emotes, twitch: emotes },
    badges,
    paints,
    entitlements: {
      ...base.entitlements,
      ...(Object.keys(entitlement).length ? { [`twitch:${response.identity.userId}`]: entitlement } : {}),
    },
  };
}

type IdentityTemplate = Omit<UnifiedMessage, 'id' | 'timestamp'> & { readonly templateId: string };

function sortedEmotes(emotes: readonly PreviewIdentityEmote[]): PreviewIdentityEmote[] {
  return [...emotes].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function badgeFromEntry(key: string, image: string): UnifiedBadge {
  const separator = key.indexOf('/');
  return { type: key.slice(0, separator), version: key.slice(separator + 1), url: image };
}

export function buildPreviewIdentityMessages(
  response: PreviewIdentityResponse,
  displayName = response.identity.displayName,
): readonly IdentityTemplate[] {
  const { identity, providers } = response;
  const base = (templateId: string, text: string, badges: UnifiedBadge[] = []): IdentityTemplate => ({
    templateId,
    platform: 'twitch',
    senderId: identity.userId,
    username: displayName,
    color: '#a970ff',
    badges,
    text,
    emotes: [],
    kind: 'chat',
  });
  const messages: IdentityTemplate[] = [];
  const twitch = providers.Twitch?.resources;
  if (twitch) {
    const merged = mergeTwitchBadgeMaps(twitch);
    const first = Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))[0];
    if (first) messages.push(base('twitch-badge', 'Canonical Twitch identity and badge', [badgeFromEntry(...first)]));
    const channel = Object.entries(twitch.channelBadges).sort(([a], [b]) => a.localeCompare(b))[0];
    if (channel) messages.push(base('twitch-channel-badge', 'Channel-specific Twitch badge', [badgeFromEntry(...channel)]));
  }
  const ffz = providers.FFZ?.resources;
  const override = ffz && Object.entries(ffz.badgeOverrides).sort(([a], [b]) => a.localeCompare(b))[0];
  if (override) messages.push(base('ffz-room-badge', 'FFZ room badge override', [badgeFromEntry(...override)]));
  const sevenTV = providers['7TV']?.resources;
  if (sevenTV?.badge || sevenTV?.paint) messages.push(base('7tv-cosmetics', '7TV identity cosmetics'));
  const addEmote = (templateId: string, label: string, emotes: readonly PreviewIdentityEmote[]) => {
    const emote = sortedEmotes(emotes)[0];
    if (emote) messages.push(base(templateId, `${label} ${emote.name}`));
  };
  if (sevenTV) addEmote('7tv-emote', '7TV emote', [...sevenTV.globalEmotes, ...sevenTV.channelEmotes, ...sevenTV.personalEmotes]);
  const bttv = providers.BTTV?.resources;
  if (bttv) addEmote('bttv-emote', 'BTTV emote', [...bttv.globalEmotes, ...bttv.channelEmotes, ...bttv.sharedEmotes]);
  if (ffz) addEmote('ffz-emote', 'FFZ emote', [...ffz.globalEmotes, ...ffz.roomEmotes]);
  const allEmotes = mergeIdentityEmotes(providers);
  const ordinary = sortedEmotes(allEmotes.filter((emote) => !emote.zeroWidth))[0];
  const overlay = sortedEmotes(allEmotes.filter((emote) => emote.zeroWidth))[0];
  if (ordinary && overlay) messages.push(base('zero-width', `${ordinary.name} ${overlay.name}`));
  return messages;
}
