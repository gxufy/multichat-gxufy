import type { PreviewIdentityTemplate } from '@/components/classic/useChatPreviewSimulator';
import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import { formatTwitchVisibleUsername } from '@/lib/connectors/twitch';
import type { SevenTVEmote } from '@/lib/kick';
import type { Platform, UnifiedBadge } from '@/lib/types';

export type PreviewRosterEntry = {
  readonly login: string;
  readonly displayName: string;
  readonly fallbackText: string;
  /** Number of real 7TV emotes to append once usable 7TV resources exist. */
  readonly emoteCount?: number;
};

/* Keep the original MultiChat preview roster and make the sample conversation
   sound like people reacting to this overlay. Emote words are never hard-coded
   into these messages; resolved 7TV artwork is appended only after the provider
   confirms that the emote actually exists in one of the loaded preview sets. */
export const PREVIEW_MESSAGES = [
  'MultiChat keeps every platform in one clean feed',
  'one OBS source for Kick Twitch YouTube and TikTok is so clean',
  'the badges and 7TV emotes look crazy on this overlay',
  'wait the emotes actually work across the preview too',
  'this is way cleaner than stacking four different chat boxes',
  'the platform icons make it easy to see where everyone came from',
  'custom fonts with the same chat layout is a W',
  'MultiChat is looking smooth',
  'okay multichat-gxufy is actually tough',
  'Kick Twitch YouTube TikTok all together is fire',
  "yeah i'm keeping this overlay",
  'the preview feels alive when 7TV starts popping off',
  'this multichat setup is a W',
] as const;

export const PREVIEW_ROSTER = [
  { login: 'gxufy', displayName: 'gxufy', fallbackText: PREVIEW_MESSAGES[0], emoteCount: 1 },
  { login: 'blu01_', displayName: 'blu01_', fallbackText: PREVIEW_MESSAGES[1] },
  { login: 'uniidev', displayName: 'uniiDev', fallbackText: PREVIEW_MESSAGES[2], emoteCount: 1 },
  { login: 'xslash58', displayName: 'Xslash58', fallbackText: PREVIEW_MESSAGES[3], emoteCount: 1 },
  { login: 'moltobenne_', displayName: 'moltobenne_', fallbackText: PREVIEW_MESSAGES[4], emoteCount: 1 },
  { login: 'said', displayName: 'Said', fallbackText: PREVIEW_MESSAGES[5] },
  { login: 'slaiqe', displayName: 'slaiqe', fallbackText: PREVIEW_MESSAGES[6] },
  { login: 'djrr13', displayName: 'Djrr13', fallbackText: PREVIEW_MESSAGES[7], emoteCount: 1 },
  { login: 'tuk7', displayName: 'tuk7', fallbackText: PREVIEW_MESSAGES[8], emoteCount: 2 },
  { login: 'giovahni', displayName: 'giovahni', fallbackText: PREVIEW_MESSAGES[9], emoteCount: 1 },
  { login: 'feelssunnyman', displayName: 'feelssunnyman', fallbackText: PREVIEW_MESSAGES[11], emoteCount: 1 },
  { login: 'br_winters', displayName: 'br_winters', fallbackText: PREVIEW_MESSAGES[12], emoteCount: 1 },
  { login: 'zo0x_', displayName: 'zo0x_', fallbackText: PREVIEW_MESSAGES[12], emoteCount: 1 },
  { login: 'jilence', displayName: 'jilence', fallbackText: PREVIEW_MESSAGES[0], emoteCount: 1 },
  { login: 'sirstendec', displayName: 'sirstendec', fallbackText: PREVIEW_MESSAGES[1], emoteCount: 1 },
  { login: 'marc', displayName: 'marc', fallbackText: PREVIEW_MESSAGES[2], emoteCount: 1 },
  { login: 'themizeguy', displayName: 'themizeguy', fallbackText: PREVIEW_MESSAGES[3], emoteCount: 2 },
  { login: 'dansalvato', displayName: 'dansalvato', fallbackText: PREVIEW_MESSAGES[4], emoteCount: 1 },
  { login: 'tduva', displayName: 'tduva', fallbackText: PREVIEW_MESSAGES[5], emoteCount: 1 },
  { login: 'igorovh', displayName: 'igorovh', fallbackText: PREVIEW_MESSAGES[6], emoteCount: 1 },
  { login: 'night', displayName: 'night', fallbackText: PREVIEW_MESSAGES[7], emoteCount: 1 },
  { login: 'itzalexpl', displayName: 'itzAlexPL', fallbackText: PREVIEW_MESSAGES[8], emoteCount: 2 },
] as const satisfies readonly PreviewRosterEntry[];

/*
 * One Preview Identity request has a fixed-provider admission cost of 8 while
 * the process-wide weighted ceiling is 32. Two concurrent roster requests use
 * 16 weighted units, leaving enough room for one previous two-request
 * generation to finish during a normal refresh without exceeding the ceiling.
 *
 * Preview Data still has deterministic fallback rows from first paint, so the
 * remaining identities can hydrate progressively without blocking the preview.
 */
export const PREVIEW_ROSTER_CONCURRENCY = 2;
export const PREVIEW_PLATFORM_SEQUENCE = [
  'twitch', 'youtube', 'kick', 'tiktok', 'youtube', 'twitch', 'kick',
  'youtube', 'tiktok', 'kick', 'twitch', 'tiktok', 'youtube', 'kick',
  'twitch', 'youtube', 'tiktok', 'kick', 'youtube', 'twitch', 'kick',
  'tiktok', 'youtube',
] as const satisfies readonly Platform[];

export const PREVIEW_SEASONAL_SEVENTV_SET_ID =
  '01M4E9Y7XNVPB9DTS6TF4VVDXY';

export const PREVIEW_FEATURED_SEVENTV_SET_ID =
  '01M4E9Y7XNVPB9DTS6TF4VVDXY';

export const PREVIEW_FEATURED_SEVENTV_EMOTES = [
  {
    name: 'LOL',
    image: 'https://cdn.7tv.app/emote/01K5HWC3JPGCSTBS3Q01BX3DAW/4x.webp',
    width: 256,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'gg',
    image: 'https://cdn.7tv.app/emote/01K6VBHM2R6FCW7ZP3G63Z70JG/4x.webp',
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'ome32',
    image: 'https://cdn.7tv.app/emote/01K63XSSSTWMF1HQ15D8VJ8550/4x.webp',
    width: 384,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'sob',
    image: 'https://cdn.7tv.app/emote/01M3Z94FR0HAQMJP73RVNX0X8G/4x.webp',
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'ome44',
    image: 'https://cdn.7tv.app/emote/01K67DE7YJ0YCQGGQSMGH1Z0PQ/4x.webp',
    width: 384,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'RT',
    image: 'https://cdn.7tv.app/emote/01K77M7Z1VE1VXDMMY3414JGQ5/4x.webp',
    width: 228,
    height: 128,
    zeroWidth: false,
    upscale: false,
  }
] as const satisfies readonly SevenTVEmote[];

export const PREVIEW_SEASONAL_SEVENTV_EMOTES = [
  {
    name: 'OMEGALUL',
    image: 'https://cdn.7tv.app/emote/01GDR51Q1R0006171NHFCC48HX/4x.webp',
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'catJAM',
    image: 'https://cdn.7tv.app/emote/01GDGFJEWG000BMR7QE2FQC25Z/4x.webp',
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'HUH',
    image: 'https://cdn.7tv.app/emote/01GE9PDMR80002HMKV76RD7ZT0/4x.webp',
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'KEKW',
    image: 'https://cdn.7tv.app/emote/01GCW886E8000B8177T65C9HA3/4x.webp',
    width: 132,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'PUMPKIN',
    image: 'https://cdn.7tv.app/emote/01KA06235WKW1KJ9709QR9YH74/4x.webp',
    width: 120,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'boo',
    image: 'https://cdn.7tv.app/emote/01J9XJXWAR0005R7SSSMETRRRV/4x.webp',
    width: 228,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'peepoScared',
    image: 'https://cdn.7tv.app/emote/01FH07N4DR000BF1F0BAH6R976/4x.webp',
    width: 180,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'skeletonPls',
    image: 'https://cdn.7tv.app/emote/01GDT5J0NG00098X7GNB35M1FR/4x.webp',
    width: 132,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'doot',
    image: 'https://cdn.7tv.app/emote/01FSSJ72G0000651CCCG314JSE/4x.webp',
    width: 140,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'GIGADEAD',
    image: 'https://cdn.7tv.app/emote/01GE6TFH9G0007X9MP8W6ANPWF/4x.webp',
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'candyy',
    image: 'https://cdn.7tv.app/emote/01GEB3DNT0000789X4TFKN8S55/4x.webp',
    width: 140,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'peepoChainsaw',
    image: 'https://cdn.7tv.app/emote/01GCSMJ3780004ZMF9GMF8X3SE/4x.webp',
    width: 140,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
] as const satisfies readonly SevenTVEmote[];

/*
 * The Preview Data renderer uses one fixed real-provider catalog.
 * Featured requested emotes come first; the existing seasonal set remains
 * available afterward. Identity-resolved 7TV resources are still appended later.
 */
export const PREVIEW_FIXED_SEVENTV_EMOTES = [
  ...PREVIEW_FEATURED_SEVENTV_EMOTES,
  ...PREVIEW_SEASONAL_SEVENTV_EMOTES,
] as const satisfies readonly SevenTVEmote[];

/* Ordered from broadly common 7TV usage toward familiar fallback favorites.
   Matching is case-insensitive, but the exact provider-returned emote name is
   preserved so the production renderer resolves the correct artwork. */
export const POPULAR_SEVENTV_EMOTE_NAMES = [
  'lol',
  'ww',
  'clap',
  'huh',
  'o7',
  'edm',
  'pog',
  'gg',
  'scuba',
  'sob',
  'dansi',
  'rt',
  'lapeace',
  'ome32',
  'ome44',
  'kekw',
  'omegalul',
  'sadge',
  'ayaya',
  'peepohappy',
  'pepelaugh',
  'catrave',
] as const;

const POPULAR_SEVENTV_RANK = new Map<string, number>(
  POPULAR_SEVENTV_EMOTE_NAMES.map((name, index) => [name, index]),
);

function visualPlatform(index: number, page: number): Platform {
  return PREVIEW_PLATFORM_SEQUENCE[(page * PREVIEW_ROSTER.length + index) % PREVIEW_PLATFORM_SEQUENCE.length]!;
}

export function curatedBadges(
  _entry: PreviewRosterEntry,
  response: PreviewIdentityResponse | undefined,
  _page: number,
): UnifiedBadge[] {
  if (!response) return [];

  const seen = new Set<string>();
  const seenImages = new Set<string>();
  const providerOwnedBadges: UnifiedBadge[] = [
    ...(response.providers.BTTV?.resources.ownedBadges ?? []).map((badge) => ({
      type: `community:bttv:${badge.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      url: badge.image,
    })),
    ...(response.providers.FFZ?.resources.ownedBadges ?? []).map((badge) => ({
      type: `community:ffz:${badge.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      url: badge.image,
    })),
  ];

  const badges: UnifiedBadge[] = [
    ...(response.providers.Twitch?.resources.ownedBadges ?? []),
    ...(response.communityBadges ?? []),
    ...providerOwnedBadges,
  ];

  return badges.flatMap((badge) => {
    const key = [
      badge.type,
      badge.version ?? '',
      badge.url ?? '',
      badge.fallbackUrl ?? '',
      badge.title ?? '',
    ].join('|');

    const imageKey = badge.url
      ? badge.url.replace(/[?#].*$/, '').toLowerCase()
      : '';

    if (seen.has(key)) return [];
    if (imageKey && seenImages.has(imageKey)) return [];

    seen.add(key);
    if (imageKey) seenImages.add(imageKey);

    return [{ ...badge }];
  });
}
function sevenTVPool(response: PreviewIdentityResponse | undefined) {
  const resources = response?.providers['7TV']?.resources;
  if (!resources) return [];

  const seen = new Set<string>();
  return [
    ...resources.personalEmotes,
    ...resources.channelEmotes,
    ...resources.globalEmotes,
  ].filter((emote) => {
    const key = emote.name.trim().toLowerCase();
    if (emote.zeroWidth || !key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function popularSevenTVPool(response: PreviewIdentityResponse | undefined) {
  return sevenTVPool(response)
    .filter((emote) => POPULAR_SEVENTV_RANK.has(emote.name.toLowerCase()))
    .sort((left, right) => (
      POPULAR_SEVENTV_RANK.get(left.name.toLowerCase())!
      - POPULAR_SEVENTV_RANK.get(right.name.toLowerCase())!
    ));
}

function usableSevenTVResponse(
  response: PreviewIdentityResponse | undefined,
): PreviewIdentityResponse | undefined {
  return sevenTVPool(response).length ? response : undefined;
}

/**
 * Use only 7TV resources resolved for this Twitch identity.
 * Preview users never borrow another user's emotes or cosmetics.
 */
export function resolvedSevenTVResponse(
  preferred: PreviewIdentityResponse | undefined,
  _responses: ReadonlyMap<string, PreviewIdentityResponse>,
): PreviewIdentityResponse | undefined {
  return usableSevenTVResponse(preferred);
}

/**
 * Append only emotes that actually arrived from 7TV. When recognizable popular
 * names are available, use those first; otherwise use a real resolved fallback.
 * The production renderer receives the same preview resources, so every inserted
 * token has matching artwork instead of showing up as plain text.
 */
export function withResolvedSevenTVEmotes(
  text: string,
  response: PreviewIdentityResponse | undefined,
  index: number,
  page: number,
  count: number,
): string {
  if (count <= 0) return text;

  const identityPool = sevenTVPool(response);
  const popular = popularSevenTVPool(response);
  const identitySelection = popular.length ? popular : identityPool;

  const selectionPool: SevenTVEmote[] = [];
  const seen = new Set<string>();

  for (const emote of [
    ...PREVIEW_FIXED_SEVENTV_EMOTES,
    ...identitySelection,
  ]) {
    const key = emote.name.trim().toLowerCase();
    if (!key || emote.zeroWidth || seen.has(key)) continue;
    seen.add(key);
    selectionPool.push(emote);
  }

  if (!selectionPool.length) return text;

  const names: string[] = [];
  const start = (index + page) % selectionPool.length;
  const take = Math.min(
    Math.max(0, Math.trunc(count)),
    selectionPool.length,
  );

  for (let offset = 0; offset < take; offset += 1) {
    names.push(
      selectionPool[(start + offset) % selectionPool.length]!.name,
    );
  }

  return [text.trim(), ...names].filter(Boolean).join(' ');
}

function template(
  entry: PreviewRosterEntry,
  index: number,
  page: number,
  response: PreviewIdentityResponse | undefined,
  emoteResponse: PreviewIdentityResponse | undefined,
  text: string,
  suffix = '',
): PreviewIdentityTemplate {
  return {
    templateId: `roster-${entry.login}${suffix}`,
    platform: 'twitch',
    displayPlatform: visualPlatform(index, page),
    senderId: response?.identity.userId ?? `preview-roster-${entry.login}`,
    senderUsername: response?.identity.login ?? entry.login,
    username: formatTwitchVisibleUsername(
      response?.identity.login ?? entry.login,
      response?.identity.displayName ?? entry.displayName,
    ),
    color: response?.identity.chatColor ?? '#a970ff',
    badges: curatedBadges(entry, response, page),
    text: withResolvedSevenTVEmotes(text, emoteResponse, index, page, entry.emoteCount ?? 0),
    emotes: [],
    kind: 'chat',
  };
}

export function fallbackRosterTemplate(
  entry: PreviewRosterEntry,
  index = 0,
  page = 0,
): PreviewIdentityTemplate {
  return template(entry, index, page, undefined, undefined, entry.fallbackText, '-fallback');
}

export function rosterTemplates(
  responses: ReadonlyMap<string, PreviewIdentityResponse>,
  page: number,
): readonly PreviewIdentityTemplate[] {
  return PREVIEW_ROSTER.map((entry, index) => {
    const response = responses.get(entry.login);
    return template(
      entry,
      index,
      page,
      response,
      resolvedSevenTVResponse(response, responses),
      PREVIEW_MESSAGES[(index + page) % PREVIEW_MESSAGES.length]!,
    );
  });
}

export function rosterFeedTemplates(
  responses: ReadonlyMap<string, PreviewIdentityResponse>,
  page: number,
): readonly PreviewIdentityTemplate[] {
  /*
   * The feed and visible roster are the same set of identities. Older preview
   * code appended PREVIEW_ROSTER[0] a second time to seed the simulator, which
   * made Gxufy visibly appear twice. Message cycling belongs to the simulator,
   * not to duplicate identity templates.
   */
  return rosterTemplates(responses, page);
}
