/*
 * The last emote list each channel's overlay used, kept in the browser's
 * storage (OBS keeps it between restarts), so emotes show the moment an
 * overlay reloads instead of after 7TV answers (1.7-4 s for big channels).
 *
 * It is only a stand-in: the overlay still loads the list the normal way and
 * replaces the stored one as soon as that arrives (same merge order, same
 * active-set rules), then stores the fresh list for next time. A list is kept
 * at most STORED_EMOTES_MAX_AGE_MS; only the most recent
 * STORED_EMOTES_MAX_CHANNELS channels are kept; a list too big for storage is
 * skipped. Storage that is blocked or full just means no stand-in.
 */
import type { SevenTVEmote } from './kick';

export type StoredEmotePlatform = 'twitch' | 'kick' | 'youtube';

export const STORED_EMOTES_PREFIX = 'flosschat:emotes:v1:';
export const STORED_EMOTES_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const STORED_EMOTES_MAX_CHANNELS = 4;
export const STORED_EMOTES_MAX_CHARS = 2_000_000;
const MAX_EMOTES = 5_000;
const INDEX_KEY = `${STORED_EMOTES_PREFIX}index`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function keyFor(platform: StoredEmotePlatform, channelId: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(channelId) ? `${STORED_EMOTES_PREFIX}${platform}:${channelId}` : null;
}

const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const httpsUrl = (value: unknown): value is string => (
  typeof value === 'string' && value.length <= 600 && /^https:\/\/[^\s"'<>]+$/.test(value)
);

/** One stored emote, checked field by field; anything odd drops it. */
function parseEmote(value: unknown): SevenTVEmote | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== 'string' || !raw.name || raw.name.length > 100) return null;
  if (!httpsUrl(raw.image) || !finitePositive(raw.width) || !finitePositive(raw.height)) return null;
  if (typeof raw.zeroWidth !== 'boolean' || typeof raw.upscale !== 'boolean') return null;
  const emote: SevenTVEmote = {
    name: raw.name,
    image: raw.image,
    width: raw.width,
    height: raw.height,
    zeroWidth: raw.zeroWidth,
    upscale: raw.upscale,
  };
  if (typeof raw.activeFlags === 'number' && Number.isSafeInteger(raw.activeFlags)) emote.activeFlags = raw.activeFlags;
  if (typeof raw.host === 'string' && /^\/\/cdn\.7tv\.app\/emote\/[A-Za-z0-9_-]+$/.test(raw.host)) emote.host = raw.host;
  if (Array.isArray(raw.files)) {
    const files = raw.files.flatMap((file) => {
      if (!file || typeof file !== 'object') return [];
      const { name, width, height } = file as Record<string, unknown>;
      return typeof name === 'string' && /^[1-4]x\.webp$/.test(name) && finitePositive(width) && finitePositive(height)
        ? [{ name, width, height }]
        : [];
    });
    if (files.length) emote.files = files;
  }
  return emote;
}

type IndexEntry = { key: string; at: number };

function readIndex(storage: StorageLike): IndexEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is IndexEntry => (
      !!entry && typeof entry === 'object'
      && typeof (entry as IndexEntry).key === 'string' && (entry as IndexEntry).key.startsWith(STORED_EMOTES_PREFIX)
      && typeof (entry as IndexEntry).at === 'number'
    ));
  } catch {
    return [];
  }
}

/** The stored list for this channel, or null (none, too old, unreadable). */
export function readStoredEmotes(
  platform: StoredEmotePlatform,
  channelId: string,
  now = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): SevenTVEmote[] | null {
  const key = keyFor(platform, channelId);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; emotes?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > STORED_EMOTES_MAX_AGE_MS || now < parsed.at - 60_000) {
      storage.removeItem(key);
      return null;
    }
    if (!Array.isArray(parsed.emotes)) return null;
    const emotes = parsed.emotes.slice(0, MAX_EMOTES).flatMap((emote) => {
      const checked = parseEmote(emote);
      return checked ? [checked] : [];
    });
    return emotes.length ? emotes : null;
  } catch {
    return null;
  }
}

/** Keep this channel's freshly loaded list for the next reload. */
export function storeEmotes(
  platform: StoredEmotePlatform,
  channelId: string,
  emotes: readonly SevenTVEmote[],
  now = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const key = keyFor(platform, channelId);
  if (!key || !storage || !emotes.length || emotes.length > MAX_EMOTES) return false;
  const body = JSON.stringify({ at: now, emotes });
  if (body.length > STORED_EMOTES_MAX_CHARS) return false;
  const index = readIndex(storage).filter((entry) => entry.key !== key);
  index.push({ key, at: now });
  index.sort((a, b) => b.at - a.at);
  const keep = index.slice(0, STORED_EMOTES_MAX_CHANNELS);
  try {
    for (const old of index.slice(STORED_EMOTES_MAX_CHANNELS)) storage.removeItem(old.key);
    storage.setItem(key, body);
    storage.setItem(INDEX_KEY, JSON.stringify(keep));
    return true;
  } catch {
    /* Full or blocked: drop this channel's entry rather than leave half a list. */
    try { storage.removeItem(key); } catch { /* nothing more to do */ }
    return false;
  }
}
