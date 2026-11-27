/*
 * JilTV emotes for a Twitch channel, from JilTV's public chat-client API
 * (https://jiltv.app/docs/chat-clients):
 *   GET https://api.jiltv.app/v1/sets/global          -> { sets: [{ emotes }], cdn }
 *   GET https://api.jiltv.app/v1/channels/twitch/{id}/bootstrap
 *                                                    -> { channel, set: { emotes }, cdn }
 * A compact emote is { id, name, v, w, h, f } (f: 1 animated, 2 zero-width,
 * 4 NSFW, 8 AVIF stored); its image is {cdn}/{id}/{v}/{scale}x.webp (1x-4x).
 * No key and no sign-in; a channel JilTV doesn't know answers 404.
 * NSFW emotes are left out, and images only ever come from cdn.jiltv.app.
 *
 * Off unless the overlay URL carries jiltvEmotesEnabled=true.
 */
import type { SevenTVEmote } from './kick';

const API = 'https://api.jiltv.app/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_KEYS = 50;
const MAX_EMOTES = 2_000;
const FLAG_ZERO_WIDTH = 2;
const FLAG_NSFW = 4;
const ID_RE = /^[0-9A-Za-z]{10,40}$/;
const NAME_RE = /^[^\s\u0000-\u001f\u007f]{1,100}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cdnBase(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.jiltv.app' || url.port || url.username || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** True for an emote image served by JilTV's CDN. */
export function isJilTVEmoteImage(image: string): boolean {
  return image.startsWith('https://cdn.jiltv.app/');
}

/** Compact JilTV emotes -> the emote shape the overlay already renders. */
export function parseJilTVEmotes(list: unknown, cdn: unknown): SevenTVEmote[] {
  const base = cdnBase(cdn);
  if (!base || !Array.isArray(list)) return [];
  const out: SevenTVEmote[] = [];
  for (const raw of list.slice(0, MAX_EMOTES)) {
    if (!isRecord(raw)) continue;
    const { id, name, v, w, h, f } = raw;
    if (typeof id !== 'string' || !ID_RE.test(id)) continue;
    if (typeof name !== 'string' || !NAME_RE.test(name)) continue;
    const version = Number(v);
    const width = Number(w);
    const height = Number(h);
    const flags = Number(f ?? 0);
    if (!Number.isSafeInteger(version) || version < 0) continue;
    if (!(width > 0 && width <= 1000 && height > 0 && height <= 1000)) continue;
    if (!Number.isSafeInteger(flags) || flags < 0 || (flags & FLAG_NSFW)) continue;
    out.push({
      name,
      image: `${base}/${id}/${version}/2x.webp`,
      width,
      height,
      zeroWidth: (flags & FLAG_ZERO_WIDTH) !== 0,
      upscale: false,
    });
  }
  return out;
}

/** The answer's body, `undefined` for a definite "not here" (404), or null
 *  when JilTV couldn't be reached (worth asking again soon). */
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
    if (response.status === 404) return undefined;
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const cache = new Map<string, { at: number; value: SevenTVEmote[] }>();

export function __resetJilTVEmotesForTests(): void {
  cache.clear();
}

/* A failed request is not kept, so the next load asks again. */
async function cached(
  key: string,
  load: () => Promise<SevenTVEmote[] | null>,
  fresh: boolean,
): Promise<SevenTVEmote[]> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load();
  if (value === null) return hit?.value ?? [];
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > CACHE_MAX_KEYS) cache.delete(cache.keys().next().value as string);
  return value;
}

/** Global + channel JilTV emotes for a Twitch channel (channel wins). Never throws. */
export async function loadJilTVTwitchEmotes(
  channelId: string,
  signal?: AbortSignal,
  fresh = false,
): Promise<SevenTVEmote[]> {
  if (!/^\d{1,20}$/.test(channelId)) return [];
  const [global, channel] = await Promise.all([
    cached('global', async () => {
      const body = await getJson(`${API}/sets/global`, signal);
      if (body === null) return null;
      if (!isRecord(body) || !Array.isArray(body.sets)) return [];
      return body.sets.flatMap((set) => (isRecord(set) ? parseJilTVEmotes(set.emotes, body.cdn) : []));
    }, fresh),
    cached(`twitch:${channelId}`, async () => {
      const body = await getJson(`${API}/channels/twitch/${channelId}/bootstrap`, signal);
      if (body === null) return null;
      if (!isRecord(body) || !isRecord(body.set)) return [];
      return parseJilTVEmotes(body.set.emotes, body.cdn);
    }, fresh),
  ]);
  const byName = new Map<string, SevenTVEmote>();
  for (const emote of [...global, ...channel]) byName.set(emote.name, emote);
  return [...byName.values()];
}
