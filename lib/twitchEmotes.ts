/* Twitch third-party emotes — exact ChatIS-v2 pipeline (script.js loadEmotes).
 *
 * Load order FFZ → BTTV → 7TV, later wins on name collision (Map.set).
 * Twitch native emotes from the IRC tag always take precedence at render
 * time because they arrive as char-offset emotes, not word-swaps.
 * Reuses the SevenTVEmote shape so render7TVSegment handles all three.
 */
import { getSevenTVGlobalEmotes, getSevenTVChannelEmotes, type SevenTVEmote } from './kick';

/* BTTV zero-width allowlist — hardcoded ids from chatis script.js:1156 */
const BTTV_ZERO_WIDTH = new Set([
  '5e76d338d6581c3724c0f0b2', // cvMask
  '5e76d399d6581c3724c0f0b8', // cvHazmat
  '567b5b520e984428652809b6', // SoSnowy
  '567b5c080e984428652809ba', // IceCold
  '567b5dc00e984428652809bd', // CandyCane
  '567b5d270e984428652809bb', // ReinDeer
  '58487cc6f52be01a7ee5f205', // TopHat
  '5849c9c8f52be01a7ee5f43a', // SantaHat
]);

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/* FFZ via BTTV's cache (chatis script.js:1122) — images['4x'] preferred,
   upscale:true when only smaller sizes exist */
function ffzToEmote(e: any): SevenTVEmote {
  const img = e.images?.['4x'] || e.images?.['2x'] || e.images?.['1x'];
  return {
    name: e.code,
    image: img,
    height: e.height ?? 28,
    width: e.width ?? 28,
    zeroWidth: false,
    upscale: !e.images?.['4x'],
  };
}

function bttvToEmote(e: any): SevenTVEmote {
  return {
    name: e.code,
    image: `https://cdn.betterttv.net/emote/${e.id}/3x`,
    height: e.height ?? 28,
    width: e.width ?? 28,
    zeroWidth: BTTV_ZERO_WIDTH.has(e.id),
    upscale: false,
  };
}

/** FFZ → BTTV → 7TV for a Twitch channel; later wins on collision. */
export async function loadTwitchEmotes(channelId: string): Promise<SevenTVEmote[]> {
  const map = new Map<string, SevenTVEmote>();

  const [ffzGlobal, ffzChannel, bttvGlobal, bttvChannel, stvGlobal, stvChannel] = await Promise.all([
    fetchJson('https://api.betterttv.net/3/cached/frankerfacez/emotes/global'),
    fetchJson(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${channelId}`),
    fetchJson('https://api.betterttv.net/3/cached/emotes/global'),
    fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`),
    getSevenTVGlobalEmotes(),
    getSevenTVChannelEmotes(channelId, 'twitch'),
  ]);

  for (const e of ffzGlobal ?? []) map.set(e.code, ffzToEmote(e));
  for (const e of ffzChannel ?? []) map.set(e.code, ffzToEmote(e));
  for (const e of bttvGlobal ?? []) map.set(e.code, bttvToEmote(e));
  // channel BTTV: channelEmotes + sharedEmotes (chatis script.js:1176)
  for (const e of [...(bttvChannel?.channelEmotes ?? []), ...(bttvChannel?.sharedEmotes ?? [])]) {
    map.set(e.code, bttvToEmote(e));
  }
  for (const e of stvGlobal) map.set(e.name, e);
  for (const e of stvChannel.emotes) map.set(e.name, e);

  return [...map.values()];
}

/* FFZ custom room badges (chatis script.js:1416): channels can override
   the stock mod/vip badge art. Returns overrides for the badge map. */
export async function loadFFZRoomBadges(channelId: string): Promise<Record<string, string>> {
  const res = await fetchJson(`https://api.frankerfacez.com/v1/_room/id/${channelId}`);
  const out: Record<string, string> = {};
  if (res?.room?.moderator_badge) {
    out['moderator/1'] = `https://cdn.frankerfacez.com/room-badge/mod/id/${channelId}/4/rounded`;
  }
  if (res?.room?.vip_badge) {
    out['vip/1'] = `https://cdn.frankerfacez.com/room-badge/vip/id/${channelId}/4`;
  }
  return out;
}
