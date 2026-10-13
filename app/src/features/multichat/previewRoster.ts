import type { PreviewIdentityTemplate } from '@/components/classic/useChatPreviewSimulator';
import {
  mergePreviewIdentityBadgeMaps,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';
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
  { login: 'wtwfrxsty', displayName: 'wtwfrxsty', fallbackText: PREVIEW_MESSAGES[7], emoteCount: 1 },
  { login: 'giovahni', displayName: 'giovahni', fallbackText: PREVIEW_MESSAGES[9], emoteCount: 1 },
  { login: 'hvdras', displayName: 'hvdras', fallbackText: PREVIEW_MESSAGES[10], emoteCount: 1 },
  { login: 'feelssunnyman', displayName: 'feelssunnyman', fallbackText: PREVIEW_MESSAGES[11], emoteCount: 1 },
  { login: 'magicnxtup', displayName: 'magicnxtup', fallbackText: PREVIEW_MESSAGES[12], emoteCount: 1 },
] as const satisfies readonly PreviewRosterEntry[];

export const PREVIEW_ROSTER_CONCURRENCY = 3;
export const PREVIEW_PLATFORM_SEQUENCE = [
  'twitch', 'youtube', 'kick', 'tiktok', 'youtube', 'twitch', 'kick',
  'youtube', 'tiktok', 'kick', 'twitch', 'tiktok', 'youtube', 'kick',
] as const satisfies readonly Platform[];

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

function badgeFromDescriptor(descriptor: string, image: string): UnifiedBadge {
  const separator = descriptor.indexOf('/');
  return {
    type: descriptor.slice(0, separator),
    version: descriptor.slice(separator + 1),
    url: image,
  };
}

export function curatedBadges(
  _entry: PreviewRosterEntry,
  response: PreviewIdentityResponse | undefined,
  _page: number,
): UnifiedBadge[] {
  if (!response) return [];

  const artwork = mergePreviewIdentityBadgeMaps(response.providers);
  const seenUrl = new Set<string>();
  const badges: UnifiedBadge[] = [];

  for (const [descriptor, image] of Object.entries(artwork)) {
    if (!descriptor.startsWith('community:') || seenUrl.has(image)) continue;
    seenUrl.add(image);
    badges.push(badgeFromDescriptor(descriptor, image));
  }

  const owned = [
    ...(response.providers.BTTV?.resources.ownedBadges ?? []),
    ...(response.providers.FFZ?.resources.ownedBadges ?? []),
  ];
  for (const badge of owned) {
    if (seenUrl.has(badge.image)) continue;
    seenUrl.add(badge.image);
    const provider = response.providers.BTTV?.resources.ownedBadges?.some(
      (candidate) => candidate.id === badge.id && candidate.image === badge.image,
    )
      ? 'bttv'
      : 'ffz';
    badges.push({ type: `community:${provider}:${badge.id}`, url: badge.image });
  }

  return badges;
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
 * Prefer a popular resolved 7TV emote from the row owner. If that user does not
 * have one, borrow another already-loaded preview identity that does. Only then
 * fall back to any usable resolved 7TV set. This keeps the showcase focused on
 * recognizable emotes without ever inserting an unresolved emote word.
 */
export function resolvedSevenTVResponse(
  preferred: PreviewIdentityResponse | undefined,
  responses: ReadonlyMap<string, PreviewIdentityResponse>,
): PreviewIdentityResponse | undefined {
  if (popularSevenTVPool(preferred).length) return preferred;
  for (const response of responses.values()) {
    if (popularSevenTVPool(response).length) return response;
  }

  const direct = usableSevenTVResponse(preferred);
  if (direct) return direct;
  for (const response of responses.values()) {
    const usable = usableSevenTVResponse(response);
    if (usable) return usable;
  }
  return undefined;
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
  if (!response || count <= 0) return text;

  const pool = sevenTVPool(response);
  if (!pool.length) return text;
  const popular = popularSevenTVPool(response);
  const selectionPool = popular.length ? popular : pool;

  const names: string[] = [];
  const start = (index + page) % selectionPool.length;
  const take = Math.min(Math.max(0, Math.trunc(count)), selectionPool.length);
  for (let offset = 0; offset < take; offset += 1) {
    names.push(selectionPool[(start + offset) % selectionPool.length]!.name);
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
    username: entry.displayName,
    color: '#a970ff',
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
  const visible = rosterTemplates(responses, page);
  const first = PREVIEW_ROSTER[0]!;
  const response = responses.get(first.login);
  const second = template(
    first,
    PREVIEW_ROSTER.length,
    page,
    response,
    resolvedSevenTVResponse(response, responses),
    PREVIEW_MESSAGES[(PREVIEW_ROSTER.length + page) % PREVIEW_MESSAGES.length]!,
    '-second',
  );
  return [...visible, second];
}
