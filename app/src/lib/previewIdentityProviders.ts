import type {
  BTTVIdentityResources,
  FFZIdentityResources,
  PreviewIdentityEmote,
  PreviewProviderOutcome,
  SevenTVIdentityResources,
  TwitchIdentityResources,
  TwitchPreviewIdentity,
} from '@/features/multichat/previewIdentity';
import type { SevenTVBadge, SevenTVPaint } from './kick';
import {
  parseCosmeticBadge,
  parseSevenTVBadge,
  parseSevenTVPaint,
} from './cosmeticMetadata';
import { readBoundedFixedProviderJson } from './server/fixedProviderProxy';

const TWITCH_GQL_URL = 'https://gql.twitch.tv/gql';
const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
export const PREVIEW_IDENTITY_PROVIDER_TIMEOUT_MS = 15_000;
export const PREVIEW_IDENTITY_PROVIDER_MAX_BYTES = 4 * 1024 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function httpsUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function positiveNumber(value: unknown, fallback = 28): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function requestJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_IDENTITY_PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await readBoundedFixedProviderJson(
      response,
      PREVIEW_IDENTITY_PROVIDER_MAX_BYTES,
    );
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

type BadgeNode = { setID: string; version: string; imageURL: string };

function parseBadgeNodes(value: unknown): BadgeNode[] | null {
  if (!Array.isArray(value)) return null;
  const nodes: BadgeNode[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry) || !nonEmptyString(entry.setID) || !nonEmptyString(entry.version) || !httpsUrl(entry.imageURL)) continue;
    if (entry.setID.includes('/') || entry.version.includes('/')) continue;
    nodes.push({ setID: entry.setID, version: entry.version, imageURL: entry.imageURL });
  }
  return nodes;
}

export type TwitchIdentityLookup = {
  identity: TwitchPreviewIdentity;
  outcome: PreviewProviderOutcome<TwitchIdentityResources>;
} | null;

export async function loadTwitchPreviewIdentity(login: string): Promise<TwitchIdentityLookup> {
  const { status, body } = await requestJson(TWITCH_GQL_URL, {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_GQL_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($login: String!) {
        badges { setID version imageURL(size: DOUBLE) }
        user(login: $login) {
          id login displayName
          broadcastBadges { setID version imageURL(size: DOUBLE) }
        }
      }`,
      variables: { login },
    }),
  });
  if (status < 200 || status >= 300 || !isPlainObject(body) || !isPlainObject(body.data)) throw new Error('identity lookup failed');
  const global = parseBadgeNodes(body.data.badges);
  if (global === null) throw new Error('identity lookup failed');
  if (body.data.user === null) return null;
  if (!isPlainObject(body.data.user)) throw new Error('identity lookup failed');
  const user = body.data.user;
  const channel = parseBadgeNodes(user.broadcastBadges);
  if (!nonEmptyString(user.id) || !/^\d+$/.test(user.id) || !nonEmptyString(user.login) || user.login.toLowerCase() !== login || !nonEmptyString(user.displayName) || channel === null) {
    throw new Error('identity lookup failed');
  }
  const toMap = (nodes: readonly BadgeNode[]) => Object.fromEntries(nodes.map((node) => [`${node.setID}/${node.version}`, node.imageURL]));
  return {
    identity: { userId: user.id, login: user.login.toLowerCase(), displayName: user.displayName },
    outcome: {
      status: 'loaded',
      resources: { globalBadges: toMap(global), channelBadges: toMap(channel) },
    },
  };
}

function ffzEmote(value: unknown, scope: 'global' | 'room'): PreviewIdentityEmote | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.code) || !isPlainObject(value.images)) return null;
  const image = value.images['4x'] ?? value.images['2x'] ?? value.images['1x'];
  if (!httpsUrl(image)) return null;
  return { id: value.id, name: value.code, image, height: positiveNumber(value.height), width: positiveNumber(value.width), zeroWidth: false, upscale: !httpsUrl(value.images['4x']), provider: 'FFZ', scope };
}

function parseFFZArray(value: unknown, scope: 'global' | 'room'): PreviewIdentityEmote[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => { const parsed = ffzEmote(entry, scope); return parsed ? [parsed] : []; });
}

function parseFFZOwnedBadges(value: unknown, userId: string): SevenTVBadge[] | null {
  if (!isPlainObject(value) || !Array.isArray(value.badges) || !isPlainObject(value.users)) return null;
  const badges: SevenTVBadge[] = [];
  for (const entry of value.badges) {
    if (!isPlainObject(entry) || !nonEmptyString(String(entry.id)) || !isPlainObject(entry.urls)) continue;
    const owners = value.users[String(entry.id)];
    if (!Array.isArray(owners) || !owners.some((owner) => String(owner) === userId)) continue;
    const image = entry.urls['4'] ?? entry.urls['2'] ?? entry.urls['1'];
    if (!nonEmptyString(image)) continue;
    const url = image.startsWith('//') ? `https:${image}` : image;
    const badge = parseCosmeticBadge({ id: `ffz-${String(entry.id)}`, image: url }, 'ffz');
    if (badge) badges.push(badge);
  }
  return badges;
}

export async function loadFFZPreviewResources(userId: string): Promise<PreviewProviderOutcome<FFZIdentityResources>> {
  const [globalResult, roomResult, badgeResult, ownedBadgeResult] = await Promise.allSettled([
    requestJson('https://api.betterttv.net/3/cached/frankerfacez/emotes/global'),
    requestJson(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${userId}`),
    requestJson(`https://api.frankerfacez.com/v1/_room/id/${userId}`),
    requestJson('https://api.frankerfacez.com/v1/badges'),
  ]);
  let failed = false;
  let globalEmotes: PreviewIdentityEmote[] = [];
  let roomEmotes: PreviewIdentityEmote[] = [];
  const badgeOverrides: Record<string, string> = {};
  let ownedBadges: SevenTVBadge[] = [];
  if (globalResult.status === 'fulfilled' && globalResult.value.status >= 200 && globalResult.value.status < 300) {
    const parsed = parseFFZArray(globalResult.value.body, 'global');
    if (parsed) globalEmotes = parsed; else failed = true;
  } else failed = true;
  if (roomResult.status === 'fulfilled' && roomResult.value.status >= 200 && roomResult.value.status < 300) {
    const body = roomResult.value.body;
    if (Array.isArray(body)) {
      const parsed = parseFFZArray(body, 'room');
      if (parsed) roomEmotes = parsed; else failed = true;
    } else if (isPlainObject(body)) {
      const candidate = Array.isArray(body.emotes) ? body.emotes : [];
      const parsed = parseFFZArray(candidate, 'room');
      if (parsed) roomEmotes = parsed; else failed = true;
    } else failed = true;
  } else if (roomResult.status === 'fulfilled' && roomResult.value.status === 404) {
    // A room emote set is optional; globals remain usable.
  } else failed = true;
  if (badgeResult.status === 'fulfilled' && badgeResult.value.status >= 200 && badgeResult.value.status < 300 && isPlainObject(badgeResult.value.body) && isPlainObject(badgeResult.value.body.room)) {
    if (badgeResult.value.body.room.moderator_badge) badgeOverrides['moderator/1'] = `https://cdn.frankerfacez.com/room-badge/mod/id/${userId}/4/rounded`;
    if (badgeResult.value.body.room.vip_badge) badgeOverrides['vip/1'] = `https://cdn.frankerfacez.com/room-badge/vip/id/${userId}/4`;
  } else if (!(badgeResult.status === 'fulfilled' && badgeResult.value.status === 404)) failed = true;
  if (ownedBadgeResult.status === 'fulfilled' && ownedBadgeResult.value.status >= 200 && ownedBadgeResult.value.status < 300) {
    const parsed = parseFFZOwnedBadges(ownedBadgeResult.value.body, userId);
    if (parsed) ownedBadges = parsed; else failed = true;
  } else failed = true;
  return { status: failed ? 'failed' : 'loaded', resources: { globalEmotes, roomEmotes, badgeOverrides, ownedBadges } };
}

const BTTV_ZERO_WIDTH = new Set([
  '5e76d338d6581c3724c0f0b2', '5e76d399d6581c3724c0f0b8',
  '567b5b520e984428652809b6', '567b5c080e984428652809ba',
  '567b5dc00e984428652809bd', '567b5d270e984428652809bb',
  '58487cc6f52be01a7ee5f205', '5849c9c8f52be01a7ee5f43a',
]);

function bttvEmote(value: unknown, scope: 'global' | 'channel' | 'shared'): PreviewIdentityEmote | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.code)) return null;
  return { id: value.id, name: value.code, image: `https://cdn.betterttv.net/emote/${encodeURIComponent(value.id)}/3x`, height: positiveNumber(value.height), width: positiveNumber(value.width), zeroWidth: BTTV_ZERO_WIDTH.has(value.id), upscale: false, provider: 'BTTV', scope };
}

function parseBTTVArray(value: unknown, scope: 'global' | 'channel' | 'shared'): PreviewIdentityEmote[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => { const parsed = bttvEmote(entry, scope); return parsed ? [parsed] : []; });
}

function parseBTTVOwnedBadges(value: unknown, userId: string): SevenTVBadge[] | null {
  if (!Array.isArray(value)) return null;
  const badges = new Map<string, SevenTVBadge>();
  for (const entry of value) {
    if (!isPlainObject(entry) || String(entry.providerId) !== userId || !isPlainObject(entry.badge)) continue;
    if (!nonEmptyString(entry.badge.description)) continue;
    const suffix = String(entry.badge.type ?? entry.badge.description)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
    const badge = parseCosmeticBadge({ id: `bttv-${suffix}`, image: entry.badge.svg }, 'bttv');
    if (badge) badges.set(badge.id, badge);
  }
  return [...badges.values()];
}

export async function loadBTTVPreviewResources(userId: string): Promise<PreviewProviderOutcome<BTTVIdentityResources>> {
  const [globalResult, channelResult, badgeResult] = await Promise.allSettled([
    requestJson('https://api.betterttv.net/3/cached/emotes/global'),
    requestJson(`https://api.betterttv.net/3/cached/users/twitch/${userId}`),
    requestJson('https://api.betterttv.net/3/cached/badges/twitch'),
  ]);
  let failed = false;
  let unavailable = false;
  let globalEmotes: PreviewIdentityEmote[] = [];
  let channelEmotes: PreviewIdentityEmote[] = [];
  let sharedEmotes: PreviewIdentityEmote[] = [];
  let ownedBadges: SevenTVBadge[] = [];
  if (globalResult.status === 'fulfilled' && globalResult.value.status >= 200 && globalResult.value.status < 300) {
    const parsed = parseBTTVArray(globalResult.value.body, 'global');
    if (parsed) globalEmotes = parsed; else failed = true;
  } else failed = true;
  if (channelResult.status === 'fulfilled' && channelResult.value.status === 404) unavailable = true;
  else if (channelResult.status === 'fulfilled' && channelResult.value.status >= 200 && channelResult.value.status < 300 && isPlainObject(channelResult.value.body)) {
    const channel = parseBTTVArray(channelResult.value.body.channelEmotes, 'channel');
    const shared = parseBTTVArray(channelResult.value.body.sharedEmotes, 'shared');
    if (channel && shared) { channelEmotes = channel; sharedEmotes = shared; } else failed = true;
  } else failed = true;
  if (badgeResult.status === 'fulfilled' && badgeResult.value.status >= 200 && badgeResult.value.status < 300) {
    const parsed = parseBTTVOwnedBadges(badgeResult.value.body, userId);
    if (parsed) ownedBadges = parsed; else failed = true;
  } else failed = true;
  return { status: failed ? 'failed' : unavailable ? 'unavailable' : 'loaded', resources: { globalEmotes, channelEmotes, sharedEmotes, ownedBadges } };
}

function sevenTVEmote(value: unknown, scope: 'global' | 'channel' | 'personal'): PreviewIdentityEmote | null {
  if (!isPlainObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) return null;
  const data = isPlainObject(value.data) ? value.data : {};
  const host = isPlainObject(data.host) ? data.host : {};
  const files = Array.isArray(host.files) ? host.files : [];
  const file = [...files].reverse().find((entry) => isPlainObject(entry) && positiveNumber(entry.height) && positiveNumber(entry.width));
  const flags = typeof data.flags === 'number' ? data.flags : 0;
  const fileHeight = isPlainObject(file) ? file.height : undefined;
  const fileWidth = isPlainObject(file) ? file.width : undefined;
  const height = positiveNumber(fileHeight) ? Number(fileHeight) : 28;
  const width = positiveNumber(fileWidth) ? Number(fileWidth) : 28;
  return { id: value.id, name: value.name, image: `https://cdn.7tv.app/emote/${value.id}/4x.webp`, height, width, zeroWidth: (flags & 256) === 256, upscale: (flags & 128) === 128, provider: '7TV', scope };
}

function parseSevenTVSet(value: unknown, scope: 'global' | 'channel' | 'personal'): PreviewIdentityEmote[] | null {
  if (!isPlainObject(value) || !Array.isArray(value.emotes)) return null;
  return value.emotes.flatMap((entry) => { const parsed = sevenTVEmote(entry, scope); return parsed ? [parsed] : []; });
}

export async function loadSevenTVPreviewResources(userId: string): Promise<PreviewProviderOutcome<SevenTVIdentityResources>> {
  const [globalResult, userResult, cosmeticsResult] = await Promise.allSettled([
    requestJson('https://7tv.io/v3/emote-sets/global'),
    requestJson(`https://7tv.io/v3/users/twitch/${userId}`),
    requestJson('https://7tv.io/v3/gql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `query { userByConnection(platform: TWITCH, id: ${JSON.stringify(userId)}) { style { paint { id function color angle shape image_url repeat stops { at color } shadows { x_offset y_offset radius color } } badge { id host { url } } } } }` }) }),
  ]);
  let failed = false;
  let unavailable = false;
  let globalEmotes: PreviewIdentityEmote[] = [];
  let channelEmotes: PreviewIdentityEmote[] = [];
  let personalEmotes: PreviewIdentityEmote[] = [];
  let paint: SevenTVPaint | null = null;
  let badge: SevenTVBadge | null = null;
  if (globalResult.status === 'fulfilled' && globalResult.value.status >= 200 && globalResult.value.status < 300) {
    const parsed = parseSevenTVSet(globalResult.value.body, 'global');
    if (parsed) globalEmotes = parsed; else failed = true;
  } else failed = true;
  if (userResult.status === 'fulfilled' && userResult.value.status === 404) unavailable = true;
  else if (userResult.status === 'fulfilled' && userResult.value.status >= 200 && userResult.value.status < 300 && isPlainObject(userResult.value.body)) {
    const body = userResult.value.body;
    const channel = body.emote_set === null || body.emote_set === undefined ? [] : parseSevenTVSet(body.emote_set, 'channel');
    if (channel === null) failed = true; else channelEmotes = channel;
    if (isPlainObject(body.user) && Array.isArray(body.user.personal_emotes)) {
      personalEmotes = body.user.personal_emotes.flatMap((entry) => { const parsed = sevenTVEmote(entry, 'personal'); return parsed ? [parsed] : []; });
    }
    const setId = nonEmptyString(body.emote_set_id)
      ? body.emote_set_id
      : isPlainObject(body.emote_set) && nonEmptyString(body.emote_set.id)
        ? body.emote_set.id
        : null;
    if (channelEmotes.length === 0 && setId) {
      try {
        const setResult = await requestJson(`https://7tv.io/v3/emote-sets/${encodeURIComponent(setId)}`);
        if (setResult.status >= 200 && setResult.status < 300) {
          const parsed = parseSevenTVSet(setResult.body, 'channel');
          if (parsed) channelEmotes = parsed; else failed = true;
        } else if (setResult.status !== 404) failed = true;
      } catch {
        failed = true;
      }
    }
  } else failed = true;
  if (cosmeticsResult.status === 'fulfilled' && cosmeticsResult.value.status >= 200 && cosmeticsResult.value.status < 300 && isPlainObject(cosmeticsResult.value.body) && isPlainObject(cosmeticsResult.value.body.data)) {
    const user = cosmeticsResult.value.body.data.userByConnection;
    if (user !== null && isPlainObject(user) && isPlainObject(user.style)) {
      paint = user.style.paint === null ? null : parseSevenTVPaint(user.style.paint);
      badge = user.style.badge === null ? null : parseSevenTVBadge(user.style.badge);
      if (user.style.paint !== null && !paint) failed = true;
      if (user.style.badge !== null && !badge) failed = true;
    }
  } else failed = true;
  return { status: failed ? 'failed' : unavailable ? 'unavailable' : 'loaded', resources: { globalEmotes, channelEmotes, personalEmotes, paint, badge } };
}
