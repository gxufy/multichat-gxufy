
import { getSevenTVGlobalEmotes, getSevenTVChannelEmotes, type SevenTVEmote } from './kick';

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

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal });
    return response.ok ? await response.json() : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return null;
  }
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

async function loadTwitchEmoteResources(
  channelId: string,
  signal?: AbortSignal,
): Promise<TwitchEmoteResourceBundle> {
  try {
    const response =
      await fetchJson(
        '/api/twitch/emote-resources?channelId='
          + encodeURIComponent(
            channelId,
          ),
        signal,
      );

    return isPlainObject(
      response,
    )
      ? response
      : {};
  } catch (error) {
    if (
      error
        instanceof DOMException
      && error.name
        === 'AbortError'
    ) {
      throw error;
    }

    /*
     * BTTV/FFZ are supplemental. Their proxy being unavailable must not
     * suppress the independent 7TV catalog.
     */
    return {};
  }
}

/**
 * FFZ global/channel -> BTTV global/channel -> 7TV global/channel.
 * Later providers retain the existing exact-name precedence.
 */
export async function loadTwitchEmotes(
  channelId: string,
  signal?: AbortSignal,
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

      getSevenTVGlobalEmotes(),

      getSevenTVChannelEmotes(
        channelId,
        'twitch',
      ),
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

  for (
    const emote
    of stvGlobal
  ) {
    map.set(
      emote.name,
      emote,
    );
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
