/* The by-id cache imports fetchSevenTVEmoteSet from here, and this module
   calls resolveSevenTVEmoteSet from there — a deliberate cycle. It is safe
   because neither side touches the other at module-evaluation time; both
   references are dereferenced only inside functions, by which point both
   modules have finished initializing. */
import { resolveSevenTVEmoteSet } from './sevenTVEmoteSetCache';
import type { TwitchSourceChannel } from './types';

export interface KickChannel {
  id: number;
  user_id: number;
  slug: string;
  chatroom: { id: number };
  subscriber_badges: Array<{
    id: number;
    months: number;
    badge_image: { src: string };
  }>;
  user: { id: number; username: string };
}

export interface SevenTVEmote {
  name: string;
  image: string;
  height: number;
  width: number;
  zeroWidth: boolean;
  upscale: boolean;
}

export interface SevenTVPaint {
  id: string;
  func: string;
  angle?: number;
  color?: number;
  repeat: boolean;
  shadows: Array<{ color: number; x_offset: number; y_offset: number; radius: number }>;
  stops: Array<{ color: number; at: number }>;
  image_url?: string;
  shape?: string;
}

export interface SevenTVBadge {
  id: string;
  image: string;
}

export interface Entitlements {
  [userId: string]: { badge?: string; paint?: string };
}

export interface ParsedMessage {
  id: string;
  /** Restored/history rows must not replay any entrance presentation. */
  suppressEntryAnimation?: boolean;
  platform?: 'kick' | 'twitch' | 'youtube' | 'tiktok';
  /** Preview-only visual source mark; identity and cosmetics still use platform. */
  displayPlatform?: 'kick' | 'twitch' | 'youtube' | 'tiktok';
  /** platform sender id — enables ban-by-author deletion (yt) */
  senderId?: string;
  /** event card category for kind === 'system' */
  category?: string;
  /** redeem/highlighted message — truthy = highlight; string = reward title */
  redeem?: boolean | string;
  /** avatar URL (yt/tiktok) */
  avatar?: string;
  /** Twitch Shared Chat source streamer, distinct from the author. */
  sourceChannel?: TwitchSourceChannel;
  /** Provider-native reply preview. */
  reply?: { username: string; text: string; messageId?: string; senderId?: string };
  /** original UnifiedMessage — kept so late-arriving 7TV cosmetics can rebuild the rendered line */
  raw?: unknown;
  /** system events (gifts, subs, superchats) render without name colon */
  kind?: 'chat' | 'system';
  timestamp?: number;
  identity: {
    username: string;
    color: string;
    background: string;
    filter: string;
    badges: React.ReactNode[];
    /** render name as a colored pill (yt owner gold) — 'bg|fg' */
    namePill?: string;
  };
  message: React.ReactNode[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeImageUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate the subset of Kick's channel response consumed by chat resources. */
export function parseKickChannel(value: unknown): KickChannel | null {
  if (!isPlainObject(value) || !positiveInteger(value.id) || !positiveInteger(value.user_id)) return null;
  if (!nonEmptyString(value.slug) || !isPlainObject(value.chatroom) || !positiveInteger(value.chatroom.id)) return null;
  if (!isPlainObject(value.user) || !positiveInteger(value.user.id) || !nonEmptyString(value.user.username)) return null;
  if (!Array.isArray(value.subscriber_badges)) return null;

  const subscriberBadges: KickChannel['subscriber_badges'] = [];
  for (const raw of value.subscriber_badges) {
    if (!isPlainObject(raw) || !positiveInteger(raw.id) || !positiveInteger(raw.months)) continue;
    if (!isPlainObject(raw.badge_image) || !safeImageUrl(raw.badge_image.src)) continue;
    subscriberBadges.push({
      id: raw.id,
      months: raw.months,
      badge_image: { src: raw.badge_image.src },
    });
  }

  return {
    id: value.id,
    user_id: value.user_id,
    slug: value.slug,
    chatroom: { id: value.chatroom.id },
    subscriber_badges: subscriberBadges,
    user: { id: value.user.id, username: value.user.username },
  };
}

export async function getKickChannel(channel: string, signal?: AbortSignal): Promise<KickChannel | null> {
  const clean = channel.replace(/^@/, '').trim();
  const urls = [
    `/api/kick/channel?channel=${encodeURIComponent(clean)}`,
    `https://kick.com/api/v2/channels/${encodeURIComponent(clean)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal, cache: 'no-store' });
      if (!res.ok) continue;
      const parsed = parseKickChannel(await res.json());
      if (parsed) return parsed;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
  }
  return null;
}

/* One 7TV ActiveEmote → our SevenTVEmote. Shared by every set source
   (the global set, a connection's inline set, and the by-id set fetch) so
   an emote is shaped identically no matter which request delivered it —
   the "one parser" the v3 split fetch feeds. */
function mapSevenTVEmote(e: any): SevenTVEmote {
  return {
    name: e.name,
    image: `https://cdn.7tv.app/emote/${e.id}/4x.webp`,
    height: e.data?.host?.files?.[3]?.height ?? e.data?.host?.files?.[1]?.height ?? 28,
    width: e.data?.host?.files?.[3]?.width ?? e.data?.host?.files?.[1]?.width ?? 28,
    zeroWidth: (e.data?.flags & 256) === 256,
    upscale: (e.data?.flags & 128) === 128,
  };
}

/* An emote set's `emotes` array (from any endpoint) → our shape, dropping
   malformed entries that lack a name or id. `emotes` is not a guaranteed
   field on EmoteSetModel, so a missing array degrades to empty, not throw. */
function mapEmoteSet(set: any): SevenTVEmote[] {
  return (set?.emotes ?? [])
    .filter((e: any) => e && e.name && e.id)
    .map(mapSevenTVEmote);
}

export async function getSevenTVGlobalEmotes(): Promise<SevenTVEmote[]> {
  try {
    const res = await fetch('https://7tv.io/v3/emote-sets/global');
    if (!res.ok) return [];
    return mapEmoteSet(await res.json());
  } catch {
    return [];
  }
}

/* The outcome of a by-id set fetch, kept richer than SevenTVEmote[] so a
   cache can tell the three cases apart. Swallowing every failure into [] (as
   the callers below still do for their own use) loses the distinction between
   "the set is genuinely empty", "the set does not exist", and "the request
   failed transiently" — and a cache that can't tell those apart either
   poisons itself on a blip or retries forever on a 404. */
export type EmoteSetOutcome =
  /** HTTP 200 — emotes is authoritative, even when empty. */
  | { status: 'ok'; emotes: SevenTVEmote[] }
  /** HTTP 404 — the set id does not resolve. Safe to cache negatively. */
  | { status: 'missing' }
  /** Network error, abort, 429, or 5xx — transient; must not be cached. */
  | { status: 'error' };

/* Fetch a 7TV emote set by id — the v3 follow-up request. 7TV's documented
   "Adapt to upcoming 7TV API change" makes GET /v3/users/:platform/:id able
   to return emote_set: null while emote_set_id is still populated; the full
   set then comes from GET /v3/emote-sets/:id. Returns a discriminated outcome
   so the cache layer can decide what is safe to remember. */
export async function fetchSevenTVEmoteSet(setId: string, signal?: AbortSignal): Promise<EmoteSetOutcome> {
  try {
    const res = await fetch(`https://7tv.io/v3/emote-sets/${setId}`, signal ? { signal } : undefined);
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) return { status: 'error' }; // 429 / 5xx / anything else transient
    return { status: 'ok', emotes: mapEmoteSet(await res.json()) };
  } catch {
    return { status: 'error' }; // network failure or abort
  }
}

/* Thin wrapper preserving the SevenTVEmote[] contract for direct callers that
   only care about the emote list; every non-ok outcome degrades to empty. */
export async function getSevenTVEmoteSet(setId: string): Promise<SevenTVEmote[]> {
  const outcome = await fetchSevenTVEmoteSet(setId);
  return outcome.status === 'ok' ? outcome.emotes : [];
}

export async function getSevenTVChannelEmotes(userId: string, platform: 'kick' | 'twitch' | 'youtube' = 'kick'): Promise<{ emotes: SevenTVEmote[]; setId: string | null; stvUserId: string | null }> {
  try {
    // 7TV's public platform name for YouTube accounts is GOOGLE.
    const endpointPlatform = platform === 'youtube' ? 'google' : platform;
    const res = await fetch(`https://7tv.io/v3/users/${endpointPlatform}/${userId}`);
    if (!res.ok) return { emotes: [], setId: null, stvUserId: null };
    const data = await res.json();
    // NOTE: root `id` is the PLATFORM connection id; the actual 7TV
    // user id (needed for the presence POST) is `user.id`.
    const stvUserId = data?.user?.id ?? null;
    const emoteSet = data?.emote_set;
    // v3: emote_set may be null/omitted while emote_set_id is populated.
    // The id is authoritative for both the emote list and the SSE
    // subscription, so prefer it and fall back to the inline set's id.
    const setId: string | null = data?.emote_set_id ?? emoteSet?.id ?? null;

    // Legacy fast path: the connection already carries its set's emotes.
    const inline = mapEmoteSet(emoteSet);
    if (inline.length) return { emotes: inline, setId, stvUserId };

    // v3 path: no inline emotes, but a set id — fetch the full set through the
    // by-id cache so a refresh, or a set shared across connectors, dedupes to
    // one request rather than refetching the whole set each time.
    if (setId) return { emotes: await resolveSevenTVEmoteSet(setId), setId, stvUserId };

    // Unregistered user, or a connection with no set at all.
    return { emotes: [], setId, stvUserId };
  } catch {
    return { emotes: [], setId: null, stvUserId: null };
  }
}

export function decimalToRGBA(decimal: number): string {
  const r = (decimal >>> 24) & 255;
  const g = (decimal >>> 16) & 255;
  const b = (decimal >>> 8) & 255;
  const a = ((decimal & 255) / 255).toFixed(3);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
