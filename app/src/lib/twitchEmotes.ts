
import { getSevenTVGlobalEmotes, getSevenTVChannelEmotes, type SevenTVEmote } from './kick';

type SevenTVChannelResult = Awaited<ReturnType<typeof getSevenTVChannelEmotes>>;

const BTTV_ZERO_WIDTH = new Set([
  '5e76d338d6581c3724c0f0b2', '5e76d399d6581c3724c0f0b8',
  '567b5b520e984428652809b6', '567b5c080e984428652809ba',
  '567b5dc00e984428652809bd', '567b5d270e984428652809bb',
  '58487cc6f52be01a7ee5f205', '5849c9c8f52be01a7ee5f43a',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveNumber(value: unknown, fallback = 28): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function httpsUrl(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function ffzToEmote(value: unknown): SevenTVEmote | null {
  if (!isPlainObject(value) || !nonEmpty(value.code) || !isPlainObject(value.images)) return null;
  const image = value.images['4x'] ?? value.images['2x'] ?? value.images['1x'];
  if (!httpsUrl(image)) return null;
  return {
    name: value.code,
    image,
    height: positiveNumber(value.height),
    width: positiveNumber(value.width),
    zeroWidth: false,
    upscale: !httpsUrl(value.images['4x']),
  };
}

function bttvToEmote(value: unknown): SevenTVEmote | null {
  if (!isPlainObject(value) || !nonEmpty(value.id) || !nonEmpty(value.code)) return null;
  return {
    name: value.code,
    image: `https://cdn.betterttv.net/emote/${encodeURIComponent(value.id)}/3x`,
    height: positiveNumber(value.height),
    width: positiveNumber(value.width),
    zeroWidth: BTTV_ZERO_WIDTH.has(value.id),
    upscale: false,
  };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type TwitchEmoteResourceBundle =
  Record<string, unknown>;

/* The emote list and the FFZ room badges both read this bundle; share one
   request per channel (in flight, and for a minute after a good answer) so a
   page load asks the server once instead of twice. Failures are not kept. */
const RESOURCE_REUSE_MS = 60_000;
const resourceRequests = new Map<string, { at: number; promise: Promise<TwitchEmoteResourceBundle> }>();

/** Forget shared BTTV/FFZ answers (a manual emote refresh, and tests). */
export function clearTwitchEmoteResourceCache(): void {
  resourceRequests.clear();
}

async function loadTwitchEmoteResources(
  channelId: string,
  signal?: AbortSignal,
): Promise<TwitchEmoteResourceBundle> {
  if (signal) return requestTwitchEmoteResources(channelId, signal);
  const now = Date.now();
  const reused = resourceRequests.get(channelId);
  if (reused && now - reused.at < RESOURCE_REUSE_MS) return reused.promise;
  const promise = requestTwitchEmoteResources(channelId);
  resourceRequests.set(channelId, { at: now, promise });
  void promise.then((bundle) => {
    if (!Object.keys(bundle).length && resourceRequests.get(channelId)?.promise === promise) {
      resourceRequests.delete(channelId);
    }
  });
  return promise;
}

/* A busy or briefly failing server (502/503/504, e.g. many overlays loading
   at once after Refresh all) gets one more try a moment later, instead of the
   overlay going without BTTV/FFZ for the rest of the stream. */
export const TWITCH_EMOTE_RESOURCE_RETRY_MS = 2_000;
const RETRY_STATUSES = new Set([502, 503, 504]);

async function requestTwitchEmoteResources(
  channelId: string,
  signal?: AbortSignal,
): Promise<TwitchEmoteResourceBundle> {
  const url =
    '/api/twitch/emote-resources?channelId='
    + encodeURIComponent(channelId);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) {
        const body: unknown = await response.json();
        return isPlainObject(body) ? body : {};
      }
      if (attempt > 0 || !RETRY_STATUSES.has(response.status)) return {};
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      /*
       * BTTV/FFZ are supplemental. Their proxy being unavailable must not
       * suppress the independent 7TV catalog.
       */
      return {};
    }
    await new Promise((resolve) => setTimeout(resolve, TWITCH_EMOTE_RESOURCE_RETRY_MS));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  return {};
}

/**
 * Later providers override earlier providers by exact emote name.
 * FFZ global/channel -> BTTV global/channel -> 7TV global/channel.
 */
export async function loadTwitchEmotes(
  channelId: string,
  signal?: AbortSignal,
  strictSevenTV = false,
  /** A 7TV channel answer the caller already has (or is fetching), so the
   *  multi-MB channel request is not made twice. */
  sevenTVChannel?: SevenTVChannelResult | Promise<SevenTVChannelResult>,
): Promise<SevenTVEmote[]> {
  if (
    !/^\d+$/.test(
      channelId,
    )
  ) {
    return [];
  }

  const [
    providerResources,
    stvGlobal,
    stvChannel,
  ] =
    await Promise.all([
      loadTwitchEmoteResources(
        channelId,
        signal,
      ),

      strictSevenTV ? getSevenTVGlobalEmotes(true) : getSevenTVGlobalEmotes(),

      sevenTVChannel
        ?? (strictSevenTV
          ? getSevenTVChannelEmotes(channelId, 'twitch', true)
          : getSevenTVChannelEmotes(channelId, 'twitch')),
    ]);

  const ffzGlobal =
    providerResources.ffzGlobal;

  const ffzChannel =
    providerResources.ffzChannel;

  const bttvGlobal =
    providerResources.bttvGlobal;

  const bttvChannel =
    providerResources.bttvChannel;

  const map =
    new Map<
      string,
      SevenTVEmote
    >();

  const addFFZ =
    (
      value:
        unknown,
    ) => {
      const emote =
        ffzToEmote(
          value,
        );

      if (emote) {
        map.set(
          emote.name,
          emote,
        );
      }
    };

  const addBTTV =
    (
      value:
        unknown,
    ) => {
      const emote =
        bttvToEmote(
          value,
        );

      if (emote) {
        map.set(
          emote.name,
          emote,
        );
      }
    };

  array(
    ffzGlobal,
  ).forEach(
    addFFZ,
  );

  array(
    ffzChannel,
  ).forEach(
    addFFZ,
  );

  array(
    bttvGlobal,
  ).forEach(
    addBTTV,
  );

  const channel =
    isPlainObject(
      bttvChannel,
    )
      ? bttvChannel
      : {};

  [
    ...array(
      channel.channelEmotes,
    ),
    ...array(
      channel.sharedEmotes,
    ),
  ].forEach(
    addBTTV,
  );

  for (const emote of stvGlobal) {
    map.set(emote.name, emote);
  }

  for (
    const emote
    of stvChannel.emotes
  ) {
    map.set(
      emote.name,
      emote,
    );
  }

  return [
    ...map.values(),
  ];
}

/** Validated FFZ custom moderator/VIP room badge replacements. */
export async function loadFFZRoomBadges(
  channelId: string,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (
    !/^\d+$/.test(
      channelId,
    )
  ) {
    return {};
  }

  const resources =
    await loadTwitchEmoteResources(
      channelId,
      signal,
    );

  /*
   * Production uses the wrapped ffzRoom field.
   * Accepting the direct room shape keeps isolated unit fixtures simple.
   */
  const response =
    isPlainObject(
      resources.ffzRoom,
    )
      ? resources.ffzRoom
      : resources;

  if (
    !isPlainObject(
      response,
    )
    || !isPlainObject(
      response.room,
    )
  ) {
    return {};
  }

  const out:
    Record<
      string,
      string
    > = {};

  if (
    response.room
      .moderator_badge
  ) {
    out['moderator/1'] =
      'https://cdn.frankerfacez.com/room-badge/mod/id/'
      + channelId
      + '/4/rounded';
  }

  if (
    response.room
      .vip_badge
  ) {
    out['vip/1'] =
      'https://cdn.frankerfacez.com/room-badge/vip/id/'
      + channelId
      + '/4';
  }

  return out;
}

const FFZ_ROOM_BADGE_MAX_IDS = 32;
const FFZ_ROOM_BADGE_MAX_USERS = 2_000;

/**
 * Badges a channel gives to particular chatters through FFZ (for example the
 * Bot badge on a channel's own bots). The room lists them by login
 * (`user_badges`) and, in the full room answer, by Twitch id
 * (`user_badge_ids`). Keys are `id:<twitch id>` and `login:<lowercase login>`;
 * values are FFZ badge ids.
 */
export function parseFFZRoomUserBadges(value: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const room = isPlainObject(value) && isPlainObject(value.room)
    ? value.room
    : isPlainObject(value) && isPlainObject(value.ffzRoom) && isPlainObject(value.ffzRoom.room)
      ? value.ffzRoom.room
      : null;
  if (!room) return out;

  let users = 0;
  const add = (key: string, badgeId: string) => {
    const list = out.get(key);
    if (list?.includes(badgeId)) return;
    if (!list && users >= FFZ_ROOM_BADGE_MAX_USERS) return;
    if (!list) users += 1;
    out.set(key, [...(list ?? []), badgeId]);
  };
  const read = (field: unknown, kind: 'id' | 'login') => {
    if (!isPlainObject(field)) return;
    for (const [badgeId, holders] of Object.entries(field).slice(0, FFZ_ROOM_BADGE_MAX_IDS)) {
      if (!/^\d{1,9}$/.test(badgeId) || !Array.isArray(holders)) continue;
      for (const holder of holders.slice(0, FFZ_ROOM_BADGE_MAX_USERS)) {
        const text = kind === 'id' && typeof holder === 'number' && Number.isSafeInteger(holder) && holder > 0
          ? String(holder)
          : typeof holder === 'string' ? holder.trim().toLowerCase() : '';
        if (kind === 'id' && /^[1-9]\d{0,19}$/.test(text)) add(`id:${text}`, badgeId);
        if (kind === 'login' && /^[a-z0-9_]{1,25}$/.test(text)) add(`login:${text}`, badgeId);
      }
    }
  };
  read(room.user_badge_ids, 'id');
  read(room.user_badges, 'login');
  return out;
}

/** The channel's FFZ badge assignments, from the same room answer as the custom mod/VIP badges. */
export async function loadFFZRoomUserBadges(
  channelId: string,
  signal?: AbortSignal,
): Promise<Map<string, string[]>> {
  if (!/^\d+$/.test(channelId)) return new Map();
  return parseFFZRoomUserBadges(await loadTwitchEmoteResources(channelId, signal));
}
