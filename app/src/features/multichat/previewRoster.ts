import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import { formatTwitchVisibleUsername } from '@/lib/connectors/twitch';
import type { SevenTVEmote } from '@/lib/kick';
import type { Platform, UnifiedBadge, UnifiedMessage } from '@/lib/types';

/** A sample chatter made from a real account's look, without its id or time. */
export type PreviewIdentityTemplate = Omit<UnifiedMessage, 'id' | 'timestamp'> & {
  readonly templateId: string;
};

export type PreviewRosterEntry = {
  readonly login: string;
  readonly displayName: string;
  /** This person's own line in the sample chat (unique per person). */
  readonly fallbackText: string;
  /** Christmas 7TV emotes (names from PREVIEW_FIXED_SEVENTV_EMOTES) that fit the line. */
  readonly emotes?: readonly string[];
};

/** One line of the sample chat and the Christmas 7TV emotes that go with it. */
export type PreviewRosterLine = {
  readonly text: string;
  readonly emotes: readonly string[];
};

/* The sample chat shows real community members' names so their real badges,
   paints and emotes appear. Each of them has their own ordinary stream-chat
   line, never praise for this overlay: a real person must not look like they
   are endorsing it. Only the owner's own account says FlossChat lines.
   Emotes are the fixed Christmas 7TV emotes, chosen per line to fit what it
   says; no line contains a word that is itself an emote name. */
export const PREVIEW_OWNER_LOGIN = 'gxufy';

export const PREVIEW_OWNER_LINES = [
  { text: 'FlossChat keeps every platform in one clean feed', emotes: ['peepoSnow'] },
  { text: 'one OBS source for Kick Twitch YouTube and TikTok', emotes: ['catJam'] },
  { text: 'Kick Twitch YouTube TikTok all in one chat', emotes: ['ome32'] },
  { text: 'custom fonts with the same chat layout', emotes: [] },
] as const satisfies readonly PreviewRosterLine[];

export const PREVIEW_OWNER_MESSAGES = PREVIEW_OWNER_LINES.map((line) => line.text);

export const PREVIEW_ROSTER = [
  { login: 'gxufy', displayName: 'gxufy', fallbackText: PREVIEW_OWNER_LINES[0].text, emotes: PREVIEW_OWNER_LINES[0].emotes },
  { login: 'blu01_', displayName: 'blu01_', fallbackText: 'good morning chat', emotes: [] },
  { login: 'uniidev', displayName: 'uniiDev', fallbackText: 'minecraft had an update', emotes: [] },
  { login: 'xslash58', displayName: 'Xslash58', fallbackText: 'that last round was insane', emotes: ['ome44'] },
  { login: 'moltobenne_', displayName: 'moltobenne_', fallbackText: 'close game, well played', emotes: ['gg'] },
  { login: 'said', displayName: 'Said', fallbackText: 'what game are we playing next', emotes: [] },
  { login: 'slaiqe', displayName: 'slaiqe', fallbackText: 'just got here, what did I miss', emotes: [] },
  { login: 'djrr13', displayName: 'Djrr13', fallbackText: 'this song goes hard', emotes: ['catJam'] },
  { login: 'tuk7', displayName: 'tuk7', fallbackText: 'wait what just happened', emotes: ['HUH', 'OMEGALUL'] },
  { login: 'giovahni', displayName: 'giovahni', fallbackText: 'first snow of the year here', emotes: ['peepoSnow'] },
  { login: 'feelssunnyman', displayName: 'feelssunnyman', fallbackText: 'it is freezing outside today', emotes: ['Coldge'] },
  { login: 'br_winters', displayName: 'br_winters', fallbackText: 'anyone gifting subs tonight', emotes: ['ANYGIFTERS'] },
  { login: 'zo0x_', displayName: 'zo0x_', fallbackText: 'that is so real', emotes: ['RT'] },
  { login: 'jilence', displayName: 'jilence', fallbackText: 'merry early christmas chat', emotes: ['ome32'] },
  { login: 'sirstendec', displayName: 'sirstendec', fallbackText: 'i cannot stop laughing at that', emotes: ['LOL'] },
  { login: 'marc', displayName: 'marc', fallbackText: 'who else is here from the clip', emotes: [] },
  { login: 'themizeguy', displayName: 'themizeguy', fallbackText: 'lost my last game by one point', emotes: ['sob'] },
  { login: 'dansalvato', displayName: 'dansalvato', fallbackText: 'brb grabbing some hot cocoa', emotes: ['peepoSnow'] },
  { login: 'tduva', displayName: 'tduva', fallbackText: 'chat is moving so fast today', emotes: [] },
  { login: 'igorovh', displayName: 'igorovh', fallbackText: 'hydrate chat', emotes: [] },
  { login: 'night', displayName: 'night', fallbackText: 'clip it clip it', emotes: ['LOL'] },
  { login: 'itzalexpl', displayName: 'itzAlexPL', fallbackText: 'welcome in, raiders', emotes: ['ome32', 'catJam'] },
  { login: 'akaoutlaw', displayName: 'akaOutlaw', fallbackText: 'that clutch was actually crazy', emotes: ['OMEGALUL'] },
  { login: 'clipzy', displayName: 'clipzy', fallbackText: 'no way that actually worked', emotes: ['LOL'] },
  { login: 'magicnxtup', displayName: 'MagicNxtUp', fallbackText: 'who is staying up late tonight', emotes: ['catJam'] },
] as const satisfies readonly PreviewRosterEntry[];

/** Every community member's line (everyone except the owner), in roster order. */
export const PREVIEW_MESSAGES = PREVIEW_ROSTER
  .filter((entry) => entry.login !== PREVIEW_OWNER_LOGIN)
  .map((entry) => entry.fallbackText);

/** The line a roster entry says on a given page of the sample chat. Community
 *  members always say their own line; the owner rotates through the FlossChat
 *  lines. */
export function previewRosterLine(entry: PreviewRosterEntry, index: number, page: number): PreviewRosterLine {
  if (entry.login === PREVIEW_OWNER_LOGIN) {
    return PREVIEW_OWNER_LINES[(index + page) % PREVIEW_OWNER_LINES.length]!;
  }
  return { text: entry.fallbackText, emotes: entry.emotes ?? [] };
}

/*
 * One Preview Identity request has a fixed-provider admission cost of 8 while
 * the process-wide weighted ceiling is 32. Two concurrent roster requests use
 * 16 weighted units, leaving enough room for one previous two-request
 * generation to finish during a normal refresh without exceeding the ceiling.
 *
 * Preview Data still has deterministic fallback rows from first paint, so the
 * remaining identities can hydrate progressively without blocking the preview.
 */
export const PREVIEW_PLATFORM_SEQUENCE = [
  'twitch', 'youtube', 'kick', 'tiktok', 'youtube', 'twitch', 'kick',
  'youtube', 'tiktok', 'kick', 'twitch', 'tiktok', 'youtube', 'kick',
  'twitch', 'youtube', 'tiktok', 'kick', 'youtube', 'twitch', 'kick',
  'tiktok', 'youtube', 'tiktok', 'twitch', 'kick',
] as const satisfies readonly Platform[];

/*
 * Seasonal preview emotes: the Christmas versions from the 7TV "Winter 2026"
 * set. Same names as the everyday preview emotes,
 * different 7TV emote IDs. Served from the 7TV CDN like every other 7TV emote;
 * peepoSnow uses 2x because its 4x file is ~2.9 MB.
 */
const SEVENTV_CDN = 'https://cdn.7tv.app/emote';

export const PREVIEW_SEASONAL_SEVENTV_SET_ID =
  '01M6SD32WBWQTJ0KR394S97W2B';

export const PREVIEW_FEATURED_SEVENTV_SET_ID =
  '01M6SD32WBWQTJ0KR394S97W2B';

export const PREVIEW_FEATURED_SEVENTV_EMOTES = [
  {
    name: 'LOL',
    image: `${SEVENTV_CDN}/01JBZXQGFKS1C06WD5NV35XHRE/4x.webp`,
    width: 256,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'gg',
    image: `${SEVENTV_CDN}/01HGB1G0580005M8CT8N9Z3PPR/4x.webp`,
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'ome32',
    image: `${SEVENTV_CDN}/01JCRHQ9KSQQQJQRNRZCHNXT2M/4x.webp`,
    width: 384,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'sob',
    image: `${SEVENTV_CDN}/01GDCCD6CG000C0VZXRM1MVA0M/4x.webp`,
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'ome44',
    image: `${SEVENTV_CDN}/01JDB6HAV4Y3K1CREKHQRCW4ZT/4x.webp`,
    width: 384,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'RT',
    image: `${SEVENTV_CDN}/01J3KKQEYG0004BE3DN7Y1GQPZ/4x.webp`,
    width: 228,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
] as const satisfies readonly SevenTVEmote[];

export const PREVIEW_SEASONAL_SEVENTV_EMOTES = [
  {
    name: 'OMEGALUL',
    image: `${SEVENTV_CDN}/01FM7C29GR000B3TR3VAP7TG9C/4x.webp`,
    width: 124,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'catJam',
    image: `${SEVENTV_CDN}/01F6ME9FRG0005TFYTWP1H8R42/4x.webp`,
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'HUH',
    image: `${SEVENTV_CDN}/01FNVD0RN00001BCZZ99DVHCDB/4x.webp`,
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'peepoSnow',
    image: `${SEVENTV_CDN}/01GE7AA84G00077M44K0MYHDAM/2x.webp`,
    width: 172,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'Coldge',
    image: `${SEVENTV_CDN}/01HE4DR2Q00008YG0BRYZWVQAE/4x.webp`,
    width: 128,
    height: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: 'ANYGIFTERS',
    image: `${SEVENTV_CDN}/01F8B1AVE80009ZNKS3FYBE16M/4x.webp`,
    width: 128,
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
/* Append a line's Christmas 7TV emotes. Only names in the fixed Christmas set
   are used: the preview always has their artwork, so none shows up as text. */
const FIXED_EMOTE_NAMES = new Set<string>(PREVIEW_FIXED_SEVENTV_EMOTES.map((emote) => emote.name));

export function withChristmasEmotes(line: PreviewRosterLine): string {
  return [line.text.trim(), ...line.emotes.filter((name) => FIXED_EMOTE_NAMES.has(name))]
    .filter(Boolean)
    .join(' ');
}

function template(
  entry: PreviewRosterEntry,
  index: number,
  page: number,
  response: PreviewIdentityResponse | undefined,
  line: PreviewRosterLine,
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
    ...(response?.viewerBadgeLayout ? { viewerBadgeLayout: response.viewerBadgeLayout } : {}),
    ...(response?.jiltvPaint ? { jiltvPaint: response.jiltvPaint } : {}),
    text: withChristmasEmotes(line),
    emotes: [],
    kind: 'chat',
  };
}

export function fallbackRosterTemplate(
  entry: PreviewRosterEntry,
  index = 0,
  page = 0,
): PreviewIdentityTemplate {
  return template(entry, index, page, undefined, previewRosterLine(entry, index, page), '-fallback');
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
      previewRosterLine(entry, index, page),
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
