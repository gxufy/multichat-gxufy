
import type { Platform, UnifiedBadge, UnifiedMessage } from '@/lib/types';
import { SAMPLE_EPOCH } from './samples';
import {
  PREVIEW_EMOTE_TOKENS,
  PREVIEW_FFZ_MOD_BADGE,
  PREVIEW_FFZ_VIP_BADGE,
  PREVIEW_TIKTOK_MOD_BADGE,
} from './previewAssets';

/* ------------------------------------------------------------------ */
/* Random source                                                       */
/* ------------------------------------------------------------------ */

/* The randomness primitives and the named speeds are shared with the Viewer
   Counter simulator and live in lib/tools/previewRandom.ts. They are re-exported
   here so this module stays the one import site for everything the chat feed
   needs — a caller should not have to know which of two files a helper came
   from. */
import {
  intBetween,
  pick,
  speedBounds,
  speedDelay,
  type PreviewSpeed,
  type RandomSource,
} from '@/lib/tools/previewRandom';

export {
  PREVIEW_SPEEDS,
  seededRandom,
  type PreviewSpeed,
  type RandomSource,
} from '@/lib/tools/previewRandom';

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The Normal band, in milliseconds.
 *
 * The lower bound is load-bearing beyond pacing: three existing suites mount the
 * whole generator on *real* timers and assert synchronously. A feed whose first
 * message could arrive in a few milliseconds would update those trees after
 * their assertions — or after unmount — and produce act() warnings in suites
 * that have nothing to do with this feature. A first delay of at least a second
 * means the scheduled message never arrives within a synchronous test, and
 * cleanup clears it.
 */
export const CHAT_INTERVAL_MIN_MS = 1200;
export const CHAT_INTERVAL_MAX_MS = 3500;

/* NO FIRST-TICK HOLD, AND NO AUTOSTART TO NEED ONE. An earlier revision held the
   first generated message back so the curated fixtures could be read before the
   feed began pushing them off the top. That treated a symptom: the overlay is
   bottom-anchored and clips at the top, so *any* generated message evicts a
   curated row, and a hold only chose when the showcase started degrading. The feed
   is now off until someone turns it on (see useChatPreviewSimulator), so the
   curated set holds the screen indefinitely and every delay this module produces
   is an ordinary drawn one. */

/** A randomized delay for the next message, in the given speed's band. */
export function nextChatDelay(random: RandomSource, speed: PreviewSpeed): number {
  return speedDelay(random, speed, CHAT_INTERVAL_MIN_MS, CHAT_INTERVAL_MAX_MS);
}

/** The band a speed draws from, for controls and tests to state exactly. */
export function chatDelayBounds(speed: PreviewSpeed): { min: number; max: number } {
  return speedBounds(speed, CHAT_INTERVAL_MIN_MS, CHAT_INTERVAL_MAX_MS);
}

/* ------------------------------------------------------------------ */
/* Fixture sources                                                    */
/* ------------------------------------------------------------------ */

/**
 * The preview fixture identities a generated message may draw on.
 *
 * Every member is something the production renderer genuinely implements, and
 * the list deliberately stops there. `lib/render.tsx` resolves platform badge
 * types per platform, `lib/multichatMessageModel.tsx` attaches 7TV badges and
 * paints through entitlements, and `lib/twitchEmotes.ts` loads FFZ and BTTV
 * emotes into the same `SevenTVEmote` shape the 7TV loader fills — FFZ
 * additionally overriding mod/vip badge art as a `url` on the badge, which
 * `renderBadges` draws directly. Nothing here claims a capability the renderer
 * would not honour.
 */
export const PREVIEW_SOURCES = [
  'platformBadges',
  'twitchBadges',
  'kickBadges',
  'youtubeBadges',
  'tiktokSource',
  'sevenTVCosmetics',
  'sevenTVPaints',
  'bttvEmotes',
  'ffzBadges',
] as const;

export type PreviewSource = (typeof PREVIEW_SOURCES)[number];

/** Which sources are on. A plain record, so it round-trips through state. */
export type PreviewSourceState = Record<PreviewSource, boolean>;

/** Everything on — the default, so the preview shows what it can out of the box. */
export function allSourcesEnabled(): PreviewSourceState {
  const state = {} as PreviewSourceState;
  for (const source of PREVIEW_SOURCES) state[source] = true;
  return state;
}

/** Everything off, for the Disable all action. */
export function noSourcesEnabled(): PreviewSourceState {
  const state = {} as PreviewSourceState;
  for (const source of PREVIEW_SOURCES) state[source] = false;
  return state;
}

/** A random subset, for Randomize. At least one, so the preview is never bare. */
export function randomSources(random: RandomSource): PreviewSourceState {
  const state = {} as PreviewSourceState;
  for (const source of PREVIEW_SOURCES) state[source] = random() < 0.5;
  if (!PREVIEW_SOURCES.some((source) => state[source])) {
    state[pick(random, PREVIEW_SOURCES)] = true;
  }
  return state;
}

/** A short human label per source, for the chips. */
export const PREVIEW_SOURCE_LABEL: Record<PreviewSource, string> = {
  platformBadges: 'Platform badges',
  twitchBadges: 'Twitch badges',
  kickBadges: 'Kick badges',
  youtubeBadges: 'YouTube badges',
  tiktokSource: 'TikTok markers',
  sevenTVCosmetics: '7TV badges',
  sevenTVPaints: '7TV paints',
  bttvEmotes: 'BTTV / FFZ emotes',
  ffzBadges: 'FFZ room badges',
};

/**
 * What each source actually does, in the renderer's terms.
 *
 * Shown as the chip's title and its accessible description, because a picker
 * that says "7TV paints" without saying the Chat settings still gate them
 * invites the reasonable conclusion that the chip is broken.
 */
export const PREVIEW_SOURCE_HINT: Record<PreviewSource, string> = {
  platformBadges: 'Generic broadcaster, moderator and VIP badge art.',
  twitchBadges: 'Twitch badge types, resolved from the official badge table.',
  kickBadges: 'Kick badge art, including subscriber tiers and gifter ranks.',
  youtubeBadges: 'YouTube moderator and verified art, plus the owner name pill.',
  tiktokSource: 'TikTok badges delivered as pre-resolved wide art.',
  sevenTVCosmetics: '7TV badges, attached by entitlement. Needs 7TV cosmetics on.',
  sevenTVPaints: '7TV username paints. Needs 7TV cosmetics on.',
  bttvEmotes: 'Third-party emote word-swaps. Needs 7TV emotes on.',
  ffzBadges: 'FFZ room-badge overrides for moderator and VIP art.',
};

/* The FFZ room-badge override art now lives in the shared preview asset catalog
   (lib/tools/multichat/previewAssets.ts), so the simulator and the static
   fixtures draw the same local art from one typed place rather than each keeping
   its own copy. Production still receives these as a `url` on a mod or VIP badge
   resolved from the FFZ CDN at runtime; the fixture supplies its own through the
   same field, and `renderBadges` draws any badge carrying a `url` directly. */
const FFZ_MOD_BADGE = PREVIEW_FFZ_MOD_BADGE;
const FFZ_VIP_BADGE = PREVIEW_FFZ_VIP_BADGE;

/* ------------------------------------------------------------------ */
/* Message pool                                                       */
/* ------------------------------------------------------------------ */

/**
 * One entry in the generated pool.
 *
 * Text and badges are declared, never pre-rendered: the conversion in
 * `lib/multichatMessageModel.tsx` is what turns a badge *type* into art and a
 * word into an emote, and a pool of pre-built nodes would keep rendering after
 * those lookups broke.
 */
type PoolEntry = {
  readonly platform: Platform;
  readonly username: string;
  readonly color: string;
  readonly text: string;
  /** Which sources this entry needs. Skipped when any is off. */
  readonly needs?: readonly PreviewSource[];
  readonly badges?: readonly UnifiedBadge[];
  /** A system event card rather than a chat line. */
  readonly category?: UnifiedMessage['category'];
  /** Entitled to the 7TV paint fixture, via the shared senderId. */
  readonly painted?: boolean;
  /**
   * Claims a reserved loaded-badge sender slot (an index into
   * {@link PREVIEW_BADGE_SENDERS}), so a badge from the loaded catalog attaches
   * through the entitlement path rather than being drawn as a native badge.
   */
  readonly badgeSlot?: number;
  /** FFZ override art on the first badge. */
  readonly ffz?: 'moderator' | 'vip';
};

/* The senderId the 7TV paint and badge fixtures are entitled to. Shared with
   lib/tools/multichat/samples.tsx deliberately — the entitlement map is keyed
   `${platform}:${senderId}`, so a painted generated message must claim the same
   identity the fixture entitlement names or the paint silently will not attach. */
const PAINTED_SENDER = 'sample-paint-sender';

/**
 * Reserved sender identities for the loaded preview-badge catalog.
 *
 * Like {@link PAINTED_SENDER}, these are stable ids a generated line claims so
 * that a loaded catalog badge can be attached to it through the production
 * entitlement path — `buildParsedMessage` finds an entitlement keyed
 * `${platform}:${senderId}` and renders the badge exactly as the live overlay
 * would, never a decorative component beside the name. The mapping from a slot to
 * a concrete loaded badge id lives in `lib/tools/multichat/previewCosmetics.ts`,
 * because only the generator knows which badges have loaded; the simulator stays
 * a pure function that merely stamps the identity.
 *
 * Every entry claiming a slot is a Twitch line, so the entitlement the cosmetics
 * builder writes is keyed on {@link PREVIEW_BADGE_SENDER_PLATFORM}. 7TV cosmetics
 * attach for Kick and Twitch alike; Twitch is the platform the entitled paint
 * sample already uses, so the two demonstrations sit on the same footing.
 */
export const PREVIEW_BADGE_SENDERS = [
  'sample-badge-sender-1',
  'sample-badge-sender-2',
  'sample-badge-sender-3',
] as const;

/** The platform the badge-slot entitlements are keyed under. */
export const PREVIEW_BADGE_SENDER_PLATFORM: Platform = 'twitch';

/* Names are ordinary invented handles. Nothing is taken from another overlay's
   fixtures, and no real chatter is named. */
const POOL: readonly PoolEntry[] = [
  /* Plain lines, one per platform, so the feed works with every source off. */
  { platform: 'kick', username: 'nightgraph', color: '#53fc18', text: 'stream quality looks crisp tonight' },
  { platform: 'twitch', username: 'violetkey', color: '#a970ff', text: 'just got here, what did I miss' },
  { platform: 'youtube', username: 'RedShelfRadio', color: '', text: 'the audio balance is much better now' },
  { platform: 'tiktok', username: 'sidequestsam', color: '#25f4ee', text: 'first stream I have caught live' },
  { platform: 'kick', username: 'brightpixel', color: '#7ae2ff', text: 'that transition was clean' },
  { platform: 'twitch', username: 'quietstorm', color: '#ff7f50', text: 'chat is flying today' },

  /* Short lines, for density. */
  { platform: 'kick', username: 'onewordandy', color: '#b6ff6f', text: 'sick' },
  { platform: 'twitch', username: 'terseterry', color: '#9acd32', text: 'same' },
  { platform: 'youtube', username: 'BriefBenny', color: '', text: 'agreed' },
  { platform: 'tiktok', username: 'shortsam', color: '#fe2c55', text: 'no way' },

  /* Mentions. The names refer to pool entries above, so a mention lands on a
     chatter the mention context has plausibly already seen. */
  { platform: 'twitch', username: 'echochamber', color: '#ffb86c', text: '@nightgraph exactly what I was going to say' },
  { platform: 'youtube', username: 'ThreadReply', color: '', text: '@violetkey the vod should be up later' },

  /* Multiline: one long run, never an embedded newline. The overlay body sets
     wordBreak but not white-space: pre-wrap, so a '\n' collapses to a space and
     a fixture built that way would demonstrate nothing about wrapping. */
  {
    platform: 'kick',
    username: 'setuptalker',
    color: '#53fc18',
    text:
      'the thing that finally fixed it for me was giving chat and the counter their own browser sources, ' +
      'because then the counter stops inheriting the chat font and I can nudge either one without touching ' +
      'the other, which is obvious in hindsight and took me an entire evening to work out',
  },

  /* Unicode, including astral characters. */
  { platform: 'twitch', username: 'ユキ_yuki', color: '#ff9edb', text: 'おつかれさま! 🎉🐉 great run' },
  { platform: 'youtube', username: 'ÁrvoreAzul', color: '', text: '¡qué buena racha! спасибо 🙌' },

  /* Badge combinations, gated on their platform's source. */
  {
    platform: 'twitch',
    username: 'castironchris',
    color: '#a970ff',
    text: 'mods are up, behave yourselves',
    needs: ['twitchBadges'],
    badges: [{ type: 'broadcaster' }, { type: 'subscriber', count: 24 }],
  },
  {
    platform: 'twitch',
    username: 'primepatty',
    color: '#5c16c5',
    text: 'resubbed with prime again',
    needs: ['twitchBadges'],
    badges: [{ type: 'premium' }, { type: 'turbo' }],
  },
  {
    platform: 'twitch',
    username: 'vipvera',
    color: '#e005b9',
    text: 'happy to be back in here',
    needs: ['twitchBadges'],
    badges: [{ type: 'vip' }, { type: 'sub-gifter', count: 5 }],
  },
  {
    platform: 'kick',
    username: 'greenroom',
    color: '#53fc18',
    text: 'six months on this channel now',
    needs: ['kickBadges'],
    badges: [{ type: 'subscriber', count: 6 }, { type: 'og' }],
  },
  {
    platform: 'kick',
    username: 'generousgus',
    color: '#b6ff6f',
    text: 'happy to keep the subs going',
    needs: ['kickBadges'],
    badges: [{ type: 'sub_gifter', count: 12 }, { type: 'gift_rank', count: 2 }],
  },
  {
    platform: 'kick',
    username: 'kickerkaty',
    color: '#7ae2ff',
    text: 'verified and everything',
    needs: ['kickBadges'],
    badges: [{ type: 'verified' }, { type: 'kicks_rank', count: 3 }],
  },
  {
    platform: 'youtube',
    username: 'CheckMarkChloe',
    color: '',
    text: 'the timestamps in the description help a lot',
    needs: ['youtubeBadges'],
    badges: [{ type: 'verified' }, { type: 'subscriber', count: 3 }],
  },
  {
    platform: 'youtube',
    username: 'ShieldedSteve',
    color: '',
    text: 'keeping an eye on chat, carry on',
    needs: ['youtubeBadges'],
    badges: [{ type: 'moderator' }],
  },
  {
    platform: 'youtube',
    username: 'ChannelHost',
    color: '',
    text: 'thanks for hanging out everyone',
    needs: ['youtubeBadges'],
    /* Not drawn as a badge: production turns an owner into a gold name pill. */
    badges: [{ type: 'owner' }],
  },
  {
    platform: 'tiktok',
    username: 'tiktokterry',
    color: '#25f4ee',
    text: 'keep it friendly in here please',
    needs: ['tiktokSource'],
    badges: [{ type: 'moderator', url: PREVIEW_TIKTOK_MOD_BADGE }],
  },
  /* Generic art, available whenever platform badges are on at all. */
  {
    platform: 'kick',
    username: 'plainmod',
    color: '#53fc18',
    text: 'slowing chat down for a moment',
    needs: ['platformBadges'],
    badges: [{ type: 'moderator' }],
  },

  /* FFZ room-badge overrides: the same mod and VIP badges carrying custom art. */
  {
    platform: 'twitch',
    username: 'roombadgerob',
    color: '#5c16c5',
    text: 'channel has its own mod art now',
    needs: ['ffzBadges'],
    badges: [{ type: 'moderator' }],
    ffz: 'moderator',
  },
  {
    platform: 'twitch',
    username: 'customvip',
    color: '#e005b9',
    text: 'the new vip badge looks great',
    needs: ['ffzBadges'],
    badges: [{ type: 'vip' }],
    ffz: 'vip',
  },

  /* Third-party emote word-swaps, including the zero-width overlay. Only Kick
     and Twitch receive swaps in production, so only those platforms appear. The
     tokens name a provider apiece — OMEGALUL/KEKW/RainTime are 7TV, catJAM is
     BTTV, PepeLaugh is FFZ — but all merge into one emote list and swap by one
     path in production, so all sit behind the single `sevenTVEmotesEnabled`
     gate the `bttvEmotes` source stands in for. */
  {
    platform: 'twitch',
    username: 'emotedelia',
    color: '#ffb86c',
    text: `that ending had me ${PREVIEW_EMOTE_TOKENS.sevenTV}`,
    needs: ['bttvEmotes'],
  },
  {
    platform: 'kick',
    username: 'laughtrack',
    color: '#53fc18',
    text: `${PREVIEW_EMOTE_TOKENS.sevenTVAlt} every single time`,
    needs: ['bttvEmotes'],
  },
  {
    platform: 'kick',
    username: 'overlayolly',
    color: '#7ae2ff',
    text: `watch this ${PREVIEW_EMOTE_TOKENS.sevenTV} ${PREVIEW_EMOTE_TOKENS.sevenTVZeroWidth} stack`,
    needs: ['bttvEmotes'],
  },
  {
    platform: 'twitch',
    username: 'bttvbrady',
    color: '#3ea6ff',
    text: `${PREVIEW_EMOTE_TOKENS.bttv} to that beat drop`,
    needs: ['bttvEmotes'],
  },
  {
    platform: 'kick',
    username: 'ffzfelix',
    color: '#b6ff6f',
    text: `${PREVIEW_EMOTE_TOKENS.ffz} that was the whole stream`,
    needs: ['bttvEmotes'],
  },

  /* 7TV paint and badge, through the fixture entitlement. */
  {
    platform: 'twitch',
    username: 'paintedpip',
    color: '#ffffff',
    text: 'gradient name still looks great',
    needs: ['sevenTVPaints'],
    painted: true,
  },
  {
    platform: 'twitch',
    username: 'paintedquinn',
    color: '#ffffff',
    text: 'shadows on the name are a nice touch',
    needs: ['sevenTVPaints'],
    painted: true,
  },
  {
    platform: 'twitch',
    username: 'cosmeticcass',
    color: '#ffffff',
    text: 'badge came through as well',
    needs: ['sevenTVCosmetics'],
    painted: true,
  },

  /* Loaded-catalog 7TV badges, attached through the entitlement path. Each claims
     a reserved sender slot the cosmetics builder entitles to a concrete loaded
     badge id; before any catalog has loaded the slot resolves to the sample 7TV
     badge, so these render a real 7TV badge either way. Gated on 7TV cosmetics,
     the same setting that gates every other 7TV badge. */
  {
    platform: PREVIEW_BADGE_SENDER_PLATFORM,
    username: 'catalogcarl',
    color: '#8ce6ff',
    text: 'that new badge in the set looks sharp',
    needs: ['sevenTVCosmetics'],
    badgeSlot: 0,
  },
  {
    platform: PREVIEW_BADGE_SENDER_PLATFORM,
    username: 'badgebecca',
    color: '#ffd39b',
    text: 'picked up the badge earlier today',
    needs: ['sevenTVCosmetics'],
    badgeSlot: 1,
  },
  {
    platform: PREVIEW_BADGE_SENDER_PLATFORM,
    username: 'setsienna',
    color: '#c8a2ff',
    text: 'love how the whole set turned out',
    needs: ['sevenTVCosmetics'],
    badgeSlot: 2,
  },

  /* Event cards. Categories are the ones the connectors really emit. */
  { platform: 'twitch', username: 'subsam', color: '#a970ff', text: 'subsam subscribed at Tier 1', category: 'subscription' },
  { platform: 'youtube', username: 'SuperChatSue', color: '', text: 'SuperChatSue sent a $10.00 Super Chat', category: 'cheer' },
  { platform: 'tiktok', username: 'rosegiver', color: '#25f4ee', text: 'rosegiver sent Rose ×25', category: 'gift' },
  { platform: 'kick', username: 'raidleader', color: '#53fc18', text: 'raidleader is raiding with 42 viewers', category: 'raid' },
  { platform: 'twitch', username: 'followfrank', color: '#a970ff', text: 'followfrank is now following', category: 'follow' },
];

/** Whether every source an entry needs is currently on. */
function entryAvailable(entry: PoolEntry, sources: PreviewSourceState): boolean {
  return (entry.needs ?? []).every((source) => sources[source]);
}

/** The entries currently drawable. Never empty — plain lines need nothing. */
export function availablePool(sources: PreviewSourceState): readonly PoolEntry[] {
  const available = POOL.filter((entry) => entryAvailable(entry, sources));
  return available.length > 0 ? available : POOL.filter((entry) => !entry.needs);
}

/* ------------------------------------------------------------------ */
/* Provider showcase                                                  */
/* ------------------------------------------------------------------ */

/**
 * The ordered cosmetic/emote showcase the feed opens with.
 *
 * The static fixtures already show native badges, a paint and an emote the
 * instant the preview paints, so the moving feed's job is to demonstrate the
 * provider-gated cosmetics in a fixed, legible order rather than leaving them to
 * a random draw that might not surface a 7TV badge for a dozen messages. Each
 * step names the pool entry (by its unique username) that demonstrates one
 * capability; `generateMessage` plays them in order for the first
 * `SHOWCASE.length` sequence numbers, then falls to the random pool.
 *
 * A step is only played when the source it needs is on. With a source off its
 * entry is not drawable, so that sequence number takes a random pick instead —
 * the showcase never forces an entry the settings have switched off.
 *
 * The order is deliberate: 7TV cosmetic badge, 7TV paint, then one emote per
 * provider (7TV, BTTV, FFZ). Consecutive steps are distinct identities, so the
 * showcase itself never repeats a line back to back.
 */
const SHOWCASE: readonly string[] = [
  'catalogcarl', // 7TV cosmetic badge, via entitlement
  'paintedpip', // 7TV username paint
  'emotedelia', // 7TV emote word-swap
  'bttvbrady', // BTTV emote word-swap
  'ffzfelix', // FFZ emote word-swap
];

/** How many opening messages the showcase governs. */
export const SHOWCASE_LENGTH = SHOWCASE.length;

/** The showcase entry for a 1-based sequence position, if it is drawable now. */
function showcaseEntry(
  sequence: number,
  sources: PreviewSourceState,
): PoolEntry | null {
  if (sequence < 1 || sequence > SHOWCASE.length) return null;
  const username = SHOWCASE[sequence - 1];
  const entry = POOL.find((candidate) => candidate.username === username);
  return entry && entryAvailable(entry, sources) ? entry : null;
}

/**
 * Choose the pool entry for a message: the showcase step if one applies, else a
 * random draw that never repeats the previous line's identity.
 *
 * NON-MUTATING. The pool is never sorted or spliced in place; the candidate list
 * is a filtered copy and `pick` only reads from it. The dedup excludes the prior
 * entry by its unique username, and only when doing so leaves something to draw —
 * with a single plain line reachable (every source off), repetition is preferred
 * to an empty feed.
 */
function selectEntry(
  sequence: number,
  sources: PreviewSourceState,
  random: RandomSource,
  previous?: UnifiedMessage | null,
): PoolEntry {
  const showcase = showcaseEntry(sequence, sources);
  if (showcase) return showcase;

  const available = availablePool(sources);
  const withoutPrevious = previous
    ? available.filter((entry) => entry.username !== previous.username)
    : available;
  return pick(random, withoutPrevious.length > 0 ? withoutPrevious : available);
}

/**
 * Build one generated message.
 *
 * `sequence` is the caller's monotonic counter, and it alone decides the id — so
 * two messages are never keyed alike however the random source behaves. The
 * timestamp is derived from the same counter rather than from `Date.now()`,
 * which keeps the module clock-free and lets a test assert exact values.
 *
 * `previous`, when supplied, is the line just emitted: the next draw will not
 * repeat its identity, so the feed never shows the same fixture twice in a row.
 * Optional so existing callers and the deterministic showcase are unaffected.
 */
export function generateMessage(
  sequence: number,
  sources: PreviewSourceState,
  random: RandomSource,
  previous?: UnifiedMessage | null,
): UnifiedMessage {
  const entry = selectEntry(sequence, sources, random, previous);
  const badges: UnifiedBadge[] = (entry.badges ?? []).map((badge) => ({ ...badge }));
  if (entry.ffz && badges.length > 0) {
    badges[0] = {
      ...badges[0],
      url: entry.ffz === 'moderator' ? FFZ_MOD_BADGE : FFZ_VIP_BADGE,
    };
  }
  /* A painted entry claims the entitled paint senderId, and a badge-slot entry
     claims its reserved slot sender so the cosmetics builder's entitlement
     attaches a loaded badge; everything else gets its own id, so the fallback
     colour palette stays varied. */
  const senderId =
    entry.painted
      ? PAINTED_SENDER
      : entry.badgeSlot !== undefined
        ? PREVIEW_BADGE_SENDERS[entry.badgeSlot]
        : `sim-${sequence}-sender`;
  return {
    platform: entry.platform,
    id: `sim-${sequence}`,
    senderId,
    username: entry.username,
    color: entry.color,
    badges,
    text: entry.text,
    emotes: [],
    /* Offset from the fixtures' epoch, so generated lines sort after them. */
    timestamp: SAMPLE_EPOCH + 60_000 + sequence * 1000,
    kind: entry.category ? 'system' : 'chat',
    ...(entry.category ? { category: entry.category } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* History bound                                                      */
/* ------------------------------------------------------------------ */

/**
 * How many generated messages are kept.
 *
 * The overlay fades and drops its own lines in production; the preview has no
 * such lifecycle, so without a bound this array would grow for as long as the
 * tab stayed open. Thirty is enough to fill the frame at every preview scale
 * and small enough that dropping the oldest is imperceptible.
 */
export const CHAT_HISTORY_MAX = 30;

/** Append, then trim from the front. Never mutates the input. */
export function appendBounded(
  current: readonly UnifiedMessage[],
  next: UnifiedMessage,
  max: number = CHAT_HISTORY_MAX,
): readonly UnifiedMessage[] {
  const appended = [...current, next];
  return appended.length <= max ? appended : appended.slice(appended.length - max);
}

/* ------------------------------------------------------------------ */
/* Pin cadence                                                        */
/* ------------------------------------------------------------------ */

/**
 * How many generated messages pass between pin appearances.
 *
 * A pin that changed with every message would be unreadable and would never sit
 * still long enough to judge, so the pin is deliberately rare. The production
 * `PinBanner` retires itself after five seconds, which is what bounds how long
 * one stays on screen — this only decides how often one is offered.
 */
export const PIN_EVERY_MIN = 8;
export const PIN_EVERY_MAX = 14;

/** How many messages until the next pin should be offered. */
export function nextPinGap(random: RandomSource): number {
  return intBetween(random, PIN_EVERY_MIN, PIN_EVERY_MAX);
}
