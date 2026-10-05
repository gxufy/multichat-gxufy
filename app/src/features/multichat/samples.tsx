/* Deterministic sample chat for the generator's built-in preview.
 *
 * These are `UnifiedMessage` values — the normalized shape the four live
 * connectors produce, *before* rendering. That choice is load-bearing rather
 * than stylistic. Four of the twenty-four MultiChat settings are applied while a
 * message is converted to renderable form, not while ChatOverlay draws it:
 *
 *   sevenTVEmotesEnabled     whether third-party emotes are swapped into text
 *   sevenTVCosmeticsEnabled  whether a paint or 7TV badge is attached at all
 *   paintShadows             whether a paint contributes drop-shadows
 *   mentionColor             whether @tokens become coloured strongs
 *
 * Fixtures shipped as pre-rendered nodes could not respond to any of those four,
 * however faithfully they copied the markup. So the preview holds normalized
 * messages and runs them through lib/multichatMessageModel — the same conversion
 * the overlay route performs — and every setting reaches the screen through the
 * code that really implements it.
 *
 * Nothing here restates renderer output. Badges are declared as platform badge
 * *types* and resolved by the production `renderBadges` (so Twitch badge UUIDs,
 * Kick subscriber tiers, and YouTube role art come from the real lookups).
 * Emotes are declared as 7TV fixtures and swapped in by the production
 * word-swap. A fixture that hardcoded an <img> would keep rendering after those
 * lookups broke, which is the opposite of useful.
 *
 * DETERMINISM. No Date.now, no Math.random, no network, no clock-dependent ids.
 * Timestamps are fixed offsets from a constant epoch. Emote character offsets are
 * computed from the literal text by codepoint, so they cannot drift from it and
 * cannot be miscounted by hand.
 *
 * Emote and badge art is referenced by URL from the same CDNs the connectors use.
 * In a test environment those requests never resolve, which is fine: assertions
 * are about the elements the overlay emits, not about pixels.
 *
 * All content is deterministic and local to the generator preview.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import type {
  Entitlements,
  KickChannel,
  SevenTVBadge,
  SevenTVEmote,
  SevenTVPaint,
} from '@/lib/kick';
import type { MessageCosmetics } from '@/lib/multichatMessageModel';
import type {
  Platform,
  UnifiedEmote,
  UnifiedMessage,
  UnifiedPin,
} from '@/lib/types';
import {
  PREVIEW_EMOTE_CAT,
  PREVIEW_EMOTE_GRIN,
  PREVIEW_EMOTE_LAUGH,
  PREVIEW_EMOTE_NATIVE,
  PREVIEW_EMOTE_RAIN,
  PREVIEW_EMOTE_SMILE,
  PREVIEW_EMOTE_TOKENS,
  PREVIEW_SEVENTV_BADGE_IMAGE,
  PREVIEW_TIKTOK_MOD_BADGE,
  PREVIEW_TIKTOK_SUB_BADGE,
} from './previewAssets';

/* A fixed instant, so timestamps are stable across runs and machines.
   2026-01-01T00:00:00Z. Never Date.now(). */
export const SAMPLE_EPOCH = 1_767_225_600_000;

/** Sequential fixed timestamps, one second apart, in sample order. */
const at = (index: number) => SAMPLE_EPOCH + index * 1000;

/**
 * A native platform emote, located in the text by codepoint.
 *
 * `renderMessageText` slices the message with `Array.from`, so offsets are
 * codepoint indices, not UTF-16 code units. Computing them from the literal
 * rather than writing numbers means the unicode sample below can hold astral
 * characters ahead of its emote without a hand-counted offset silently landing
 * mid-surrogate — which is exactly the bug this sample exists to keep out.
 *
 * Throws rather than degrading: the inputs are two literals in this file, so a
 * miss is a broken fixture and a test asserting the emote renders will catch it
 * before it can reach a page.
 */
function nativeEmote(text: string, token: string, url: string): UnifiedEmote {
  const chars = Array.from(text);
  const tokenChars = Array.from(token);
  for (let i = 0; i <= chars.length - tokenChars.length; i++) {
    if (tokenChars.every((char, j) => chars[i + j] === char)) {
      /* `end` is exclusive — renderMessageText resumes its cursor there. */
      return { begin: i, end: i + tokenChars.length, text: token, url };
    }
  }
  throw new Error(`sample emote token ${token} is not present in its own text`);
}

/* ------------------------------------------------------------------ */
/* Cosmetics fixtures                                                  */
/* ------------------------------------------------------------------ */

/**
 * 7TV emotes the preview makes available for word-swapping.
 *
 * Only Kick and Twitch messages receive third-party swaps in production, so only
 * those samples reference these names. `RainTime` is zero-width: the renderer
 * overlays it on the emote before it, which is a distinctive 7TV behaviour worth
 * showing in a preview rather than discovering in OBS.
 */
export const SAMPLE_SEVENTV_EMOTES: readonly SevenTVEmote[] = [
  /* width/height mirror each fixture's declared intrinsic size rather than a
     uniform 32. The renderer sizes from CSS and never reads these, but a
     provider sends the real dimensions here, and a fixture that misreports them
     would be the wrong thing to test any future consumer of the field against.
     They vary because the art does — see previewAssets. */
  {
    name: PREVIEW_EMOTE_TOKENS.sevenTV,
    image: PREVIEW_EMOTE_LAUGH,
    height: 128,
    width: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: PREVIEW_EMOTE_TOKENS.sevenTVAlt,
    image: PREVIEW_EMOTE_GRIN,
    /* The wide one: 3:2, so a stretched render is visible. */
    height: 128,
    width: 192,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: PREVIEW_EMOTE_TOKENS.sevenTVZeroWidth,
    image: PREVIEW_EMOTE_RAIN,
    /* Wider than the base it overlays, which is how it shows that an overlay
       adds no width to the line no matter its own. */
    height: 144,
    width: 192,
    zeroWidth: true,
    upscale: false,
  },
  /* BTTV and FFZ contribute to the very same list in production —
     `loadTwitchEmotes` merges FFZ → BTTV → 7TV into one array and the renderer
     word-swaps them identically. So they are declared here as ordinary emote
     fixtures whose provider is carried by the token name alone, and they render
     through the same path behind the same `sevenTVEmotesEnabled` gate. */
  {
    name: PREVIEW_EMOTE_TOKENS.bttv,
    image: PREVIEW_EMOTE_CAT,
    height: 128,
    width: 128,
    zeroWidth: false,
    upscale: false,
  },
  {
    name: PREVIEW_EMOTE_TOKENS.ffz,
    image: PREVIEW_EMOTE_SMILE,
    /* Below the renderer's height cap on purpose — a provider 1x variant. The
       row shows it landing at the same height as its neighbours anyway. */
    height: 32,
    width: 32,
    zeroWidth: false,
    upscale: false,
  },
];

/** A 7TV badge, attached through an entitlement like a real one. */
export const SAMPLE_SEVENTV_BADGE: SevenTVBadge = {
  id: 'sample-7tv-badge',
  image: PREVIEW_SEVENTV_BADGE_IMAGE,
};

/**
 * A 7TV name paint: a five-stop linear gradient with two composed shadows.
 *
 * Colours are packed RGBA decimals, the form `decimalToRGBA` decodes, because
 * that is what the 7TV API returns and what the production paint builder
 * expects.
 *
 * Five stops rather than three, in hues far enough apart that the gradient
 * cannot be mistaken for a flat username colour at overlay size. Three
 * neighbouring warm tones could be — and a paint that reads as one colour proves
 * nothing about a paint renderer.
 *
 * Two shadows rather than one, because the filter is a composed chain and one
 * shadow cannot show that the chain is built correctly. They are also chosen for
 * different backgrounds: the violet glow carries the name against a dark or
 * transparent scene, the tight dark shadow gives it an edge against a light one.
 * Both disappear together when paintShadows is off, and the gradient must
 * survive that untouched.
 */
export const SAMPLE_SEVENTV_PAINT: SevenTVPaint = {
  id: 'sample-7tv-paint',
  func: 'LINEAR_GRADIENT',
  angle: 90,
  repeat: false,
  /* Alpha lives in the low byte: 217 → 0.851, 140 → 0.549. */
  shadows: [
    { color: 2824206297, x_offset: 0, y_offset: 0, radius: 4 }, // #a855f7 glow
    { color: 140, x_offset: 1, y_offset: 1, radius: 2 }, // near-black edge
  ],
  stops: [
    { color: 4282084351, at: 0 }, // #ff3b6b
    { color: 4289739519, at: 0.25 }, // #ffb03a
    { color: 1256095999, at: 0.5 }, // #4ade80
    { color: 951974143, at: 0.75 }, // #38bdf8
    { color: 2824206335, at: 1 }, // #a855f7
  ],
};

/**
 * Which sample chatter owns which cosmetics, keyed as the fetcher keys them.
 *
 * `${platform}:${senderId}`, so the conversion's own lookup applies them. Two
 * senders, deliberately asymmetric, because `badge` and `paint` are independent
 * fields of one entitlement and a single sample carrying both could not show
 * that:
 *
 *   sample-paint-sender  badge *and* paint — the full 7TV cosmetic set
 *   sample-roles-sender  badge only — a 7TV badge sitting beside three official
 *                        Twitch badges, which is what proves the two resolvers
 *                        compose rather than replace one another
 *
 * Both are entitled only while sevenTVCosmeticsEnabled is on, so the toggle
 * removes a badge here and a badge-plus-gradient there while every official
 * badge in the same lines stays put.
 */
export const SAMPLE_ENTITLEMENTS: Entitlements = {
  'twitch:sample-paint-sender': {
    badge: SAMPLE_SEVENTV_BADGE.id,
    paint: SAMPLE_SEVENTV_PAINT.id,
  },
  'twitch:sample-roles-sender': {
    badge: SAMPLE_SEVENTV_BADGE.id,
  },
};

/**
 * A Kick channel, present only for its subscriber badge tiers.
 *
 * The Kick subscriber badge resolves by picking the highest tier a chatter's
 * month count reaches, so a preview without tiers would fall back to the generic
 * art and never exercise that lookup.
 */
export const SAMPLE_KICK_CHANNEL: KickChannel = {
  id: 1,
  user_id: 1,
  slug: 'sample-channel',
  chatroom: { id: 1 },
  subscriber_badges: [
    { id: 1, months: 1, badge_image: { src: '/badges/subscriber.svg' } },
    { id: 2, months: 6, badge_image: { src: '/badges/subscriber.svg' } },
  ],
  user: { id: 1, username: 'sample-channel' },
};

/** Everything the conversion reads, assembled once. */
export const SAMPLE_COSMETICS: MessageCosmetics = {
  emotes: {
    kick: [...SAMPLE_SEVENTV_EMOTES],
    twitch: [...SAMPLE_SEVENTV_EMOTES],
  },
  badges: [SAMPLE_SEVENTV_BADGE],
  paints: [SAMPLE_SEVENTV_PAINT],
  entitlements: SAMPLE_ENTITLEMENTS,
  channel: SAMPLE_KICK_CHANNEL,
};

/* ------------------------------------------------------------------ */
/* Samples                                                             */
/* ------------------------------------------------------------------ */

/**
 * The sample categories, each demonstrating one renderer capability.
 *
 * A union rather than free-form strings, so the preview and its tests share one
 * list and cannot fall out of step.
 */
export const SAMPLE_GROUPS = [
  'plain',
  'bot',
  'badges',
  'roles',
  'mention',
  'emotes',
  'paint',
  'moderation',
  'event',
  'unicode',
  'owner',
  'pin',
] as const;

/* Which of those groups the default six-row showcase spends its viewport on. The
   rest are real fixtures with real tests; they are simply not what a visitor
   should be looking at when the page paints. See SAMPLE_LIBRARY_MESSAGES. */

export type SampleGroup = (typeof SAMPLE_GROUPS)[number];

/** A sample plus the capability it exists to demonstrate. */
export type SampleMessage = {
  readonly group: SampleGroup;
  /** Describes the sample for a maintainer. Never overlay content. */
  readonly label: string;
  readonly message: UnifiedMessage;
};

/* The Kick author's raw colour, reused by the mention sample's text so the
   mention resolves against a chatter who has actually spoken. */
const KICK_GREEN = '#53fc18';

/** The unicode sample's text, named so its emote offset is computed from it. */
const UNICODE_TEXT = 'ありがとう! спасибо! شكرا! ¡qué buena racha! 🎉🐉 é Kappa';

/**
 * The default showcase: six rows, and six is a measurement rather than a taste.
 *
 * THE VIEWPORT IS THE SPECIFICATION. The sample frame lays out at 899×370 internal
 * CSS pixels before its 0.75 transform (674×278 as drawn), and one single-line
 * chat row occupies 55 of those 370. Six rows are 330, which fits with room over
 * the top; a seventh is 385 and ChatOverlay's #chat_container — `position:
 * absolute; bottom: 0; overflow: hidden` — would clip it mid-line. So the row
 * budget is six *complete* rows, and every entry below has to earn one.
 *
 * That constraint is why this array is short and why each line is dense. Every row
 * carries several capabilities at once, the way a real chatter does: a moderator
 * who is also a founder and a subscriber and wears a 7TV badge is one believable
 * line and four demonstrations. Splitting those apart would spend the viewport on
 * a test matrix, and the seventh row does not exist to spend.
 *
 * WHAT IS DELIBERATELY NOT HERE. No event card, no pin, no long wrapping post, no
 * unbadged filler. Each of those is a real fixture with real tests, and each costs
 * either the whole of the top of the frame (an opaque pin banner) or two rows of
 * six (anything that wraps). They live in {@link SAMPLE_LIBRARY_MESSAGES}.
 *
 * Two ordering rules still bind. Mention colouring only applies to a chatter
 * already seen, exactly as in a live stream, so the mention sits after the Twitch
 * author it names — moving it above would silently stop demonstrating mentions.
 * And consecutive rows come from different platforms, which is what makes the
 * source-tag setting visibly meaningful.
 *
 * Every body is short enough to stay on one line at the default width and
 * settings. A row that wrapped would evict one of the six, which is exactly how an
 * earlier revision lost its broadcaster and VIP badges off the top.
 */
export const SAMPLE_MESSAGES: readonly SampleMessage[] = [
  {
    group: 'badges',
    label: 'Twitch broadcaster who also subscribes, with a 7TV and a native emote',
    message: {
      platform: 'twitch',
      id: 'sample-badges',
      senderId: 'sample-badges-sender',
      username: 'purplereign',
      color: '#a970ff',
      /* Declared as types, resolved by the production Twitch badge table into
         real CDN art. Two badges rather than one, because badge *order* and the
         spacing between them are only visible when more than one is drawn. */
      badges: [{ type: 'broadcaster' }, { type: 'subscriber' }],
      /* Two emotes from two different mechanisms in one short line. OMEGALUL is a
         word the production third-party swap replaces; Kappa arrives as a native
         platform emote at a character offset, which is a different code path and
         the one the sevenTVEmotesEnabled setting must *not* touch. Having both
         here means the difference between them is visible in a single row.
         First in the array as well as first on screen: this is the chatter the
         mention row below names, and a mention only colours for someone the
         conversion has already seen. */
      text: 'clip that OMEGALUL Kappa',
      emotes: [nativeEmote('clip that OMEGALUL Kappa', PREVIEW_EMOTE_TOKENS.nativeTwitch, PREVIEW_EMOTE_NATIVE)],
      timestamp: at(0),
      kind: 'chat',
    },
  },
  {
    group: 'emotes',
    label: 'Kick moderator and subscriber whose reaction carries every provider emote path',
    message: {
      platform: 'kick',
      id: 'sample-emotes',
      senderId: 'sample-emotes-sender',
      username: 'emotefiend',
      color: '#b6ff6f',
      /* Both Kick badge kinds on one believable line — a mod who also subscribes.
         count 8 clears the 6-month tier, so the Kick highest-tier-reached lookup
         has to actually choose rather than fall through to generic art. */
      badges: [{ type: 'moderator' }, { type: 'subscriber', count: 8 }],
      /* Bare tokens, never <img> — the production word-swap turns each into an
         image and leaves them as readable text when third-party emotes are off.
         RainTime follows OMEGALUL because it is the zero-width fixture: the
         renderer layers it over the emote *before* it, so it needs a base to sit
         on or the behaviour it exists to show never happens. The remaining tokens
         name BTTV and FFZ, which production merges into this same list and swaps
         through this same path — one row, four providers, one code path. */
      text: 'no chance OMEGALUL RainTime KEKW catJAM PepeLaugh',
      emotes: [],
      timestamp: at(1),
      kind: 'chat',
    },
  },
  {
    group: 'roles',
    label: 'Twitch moderator with three official badges and a 7TV badge beside them',
    message: {
      platform: 'twitch',
      id: 'sample-roles',
      /* Entitled to the 7TV badge but no paint. The 7TV badge is appended after
         the official ones by the conversion, so this line is what shows the two
         resolvers composing — official art from the Twitch table, cosmetic art
         from the entitlement, side by side in one row. */
      senderId: 'sample-roles-sender',
      username: 'emberwatch',
      color: '#ff7b54',
      /* founder is the extra official badge beyond the four role badges, and
         subscriber carries a month count so the tier lookup runs here too. */
      badges: [{ type: 'moderator' }, { type: 'founder' }, { type: 'subscriber', count: 24 }],
      text: 'two years now',
      emotes: [],
      timestamp: at(2),
      kind: 'chat',
    },
  },
  {
    group: 'mention',
    label: 'YouTube moderator and verified viewer mentioning the Twitch broadcaster',
    message: {
      platform: 'youtube',
      id: 'sample-mention',
      senderId: 'sample-mention-sender',
      username: 'RedButtonRadio',
      color: '',
      /* Deliberately out of YT_BADGE_ORDER (verified sorts ahead of moderator).
         A fixture already in the right order could not tell a working sort from
         a missing one. */
      badges: [{ type: 'moderator' }, { type: 'verified' }],
      avatar: 'https://yt3.ggpht.com/sample-mod=s64-c-k-c0x00ffffff-no-rj',
      /* Resolves to purplereign's colour, which only works because that row is
         first — mentions colour from chatters already seen. No punctuation
         directly after the token: renderMentions strips a trailing comma to *look
         up* the chatter but colours the word as written, so '@purplereign,' would
         put the comma inside the coloured strong. */
      text: 'welcome @purplereign',
      emotes: [],
      timestamp: at(3),
      kind: 'chat',
    },
  },
  {
    group: 'moderation',
    label: 'TikTok moderator and subscriber, both badges pre-resolved art',
    message: {
      platform: 'tiktok',
      id: 'sample-moderation',
      senderId: 'sample-moderation-sender',
      username: 'tiktokmod',
      color: '#25f4ee',
      /* Both badges carry a url, which is how TikTok delivers them: there is no
         TikTok lookup table because the connector sends finished art. That is
         also the branch that adds ck-badge-wide, so non-square art is not
         squished — and a type without a url here would fall through to the
         YouTube table and draw the wrong icon entirely. */
      badges: [
        { type: 'moderator', url: PREVIEW_TIKTOK_MOD_BADGE },
        { type: 'subscriber', url: PREVIEW_TIKTOK_SUB_BADGE },
      ],
      avatar: 'https://p16-sign-va.tiktokcdn.com/sample-avatar~c5_100x100.jpeg',
      text: 'keep it civil in here please',
      emotes: [],
      timestamp: at(4),
      kind: 'chat',
    },
  },
  {
    group: 'paint',
    label: 'Twitch VIP entitled to a 7TV paint and badge',
    message: {
      platform: 'twitch',
      id: 'sample-paint',
      /* Matches SAMPLE_ENTITLEMENTS, which is how the paint is attached — the
         same senderId lookup the live cosmetics fetcher uses. Last of the six on
         purpose: the gradient is the least self-evident thing here, and the last
         row is the one the bottom-anchored container can never clip. */
      senderId: 'sample-paint-sender',
      username: 'paintedname',
      color: '#ffffff',
      /* VIP completes the four Twitch role badges across the showcase —
         broadcaster and subscriber on the first row, moderator on the third. */
      badges: [{ type: 'vip' }, { type: 'subscriber' }],
      text: 'that transition is so clean',
      emotes: [],
      timestamp: at(5),
      kind: 'chat',
    },
  },
];

/**
 * The fixtures that are real but must not occupy the default viewport.
 *
 * Everything here is exercised by tests, available to explicit demonstrations, and
 * excluded from what the generator paints on arrival — because each one costs more
 * than the row it would take. An event card and a long bot post are two rows of
 * six. The pinned banner is opaque, top-anchored and about three rows tall, so it
 * covers the showcase rather than joining it. An unbadged greeting spends a row
 * demonstrating the absence of a feature.
 *
 * They are not lesser fixtures. The Unicode line is the only place a native emote
 * sits after an astral-plane pair, the owner line is the only gold name pill, and
 * the two event cards are the only proof that a card takes its border colour from
 * its platform. `sampleAllMessages()` returns the showcase followed by these, and
 * that is what a test asserting on any of the above should mount.
 *
 * Timestamps continue the showcase's sequence, so the concatenation is still
 * strictly ascending and one second apart.
 */
export const SAMPLE_LIBRARY_MESSAGES: readonly SampleMessage[] = [
  {
    group: 'plain',
    label: 'Plain Kick message, the only unbadged line',
    message: {
      platform: 'kick',
      id: 'sample-plain',
      senderId: 'sample-plain-sender',
      username: 'greenscreen',
      color: KICK_GREEN,
      badges: [],
      text: 'first time catching the stream live, this is sick',
      emotes: [],
      timestamp: at(6),
      kind: 'chat',
    },
  },
  {
    group: 'bot',
    label: 'Twitch bot command response, long enough to wrap onto several lines',
    message: {
      platform: 'twitch',
      id: 'sample-bot',
      senderId: 'sample-bot-sender',
      username: 'overlaybot',
      color: '#8f8f9d',
      /* Channel bots are almost always moderators, so this doubles as the
         simplest possible badge case: one official badge, resolved from a type. */
      badges: [{ type: 'moderator' }],
      /* Deliberately one long run rather than an embedded newline. The overlay's
         message body sets wordBreak but never white-space: pre-wrap, so a '\n'
         would collapse to a space and render as a single line — a fixture built
         that way would claim to demonstrate wrapping while demonstrating
         nothing. Length is what exercises the multi-line path: line height, the
         indent under the name, and how stroke and shadow look on a second line.
         Four rows of the six-row budget on its own, which is why it is a library
         fixture rather than a showcase one.

         A '!' command is also the honest thing to put behind prefixBL — that
         setting exists to hide bot chatter, and the field's own placeholder
         suggests a prefix like this one. */
      text:
        '!setup — one browser source for chat and a second for the counter, both sized to the ' +
        'scene, so they move independently and the counter never inherits the chat font',
      emotes: [],
      timestamp: at(7),
      kind: 'chat',
    },
  },
  {
    group: 'event',
    label: 'YouTube super chat event card',
    message: {
      platform: 'youtube',
      id: 'sample-event',
      senderId: 'sample-event-sender',
      username: 'GoldTierViewer',
      color: '',
      badges: [],
      /* kind 'system' with a category renders as an event card: provider-coloured
         left border, gradient wash, no name colon. 'cheer' is the category the
         YouTube connector emits for a super chat — not this file's decision. */
      text: 'GoldTierViewer sent a $20.00 Super Chat',
      emotes: [],
      timestamp: at(8),
      kind: 'system',
      category: 'cheer',
    },
  },
  {
    group: 'event',
    label: 'TikTok gift event card, on a second platform',
    message: {
      platform: 'tiktok',
      id: 'sample-gift',
      senderId: 'sample-gift-sender',
      username: 'giftgiver',
      color: '#25f4ee',
      badges: [],
      avatar: 'https://p16-sign-va.tiktokcdn.com/sample-gifter~c5_100x100.jpeg',
      /* A second event card on a different platform: the card takes its border
         colour from the provider, so one example cannot show that the colour
         actually follows the platform. */
      text: 'giftgiver sent Rose ×10',
      emotes: [],
      timestamp: at(9),
      kind: 'system',
      category: 'gift',
    },
  },
  {
    group: 'owner',
    label: 'YouTube channel owner, whose name renders as a gold pill',
    message: {
      platform: 'youtube',
      id: 'sample-owner',
      senderId: 'sample-owner-sender',
      username: 'StreamOwner',
      color: '',
      /* An 'owner' badge is deliberately not drawn as a badge: the production
         rule turns the whole name into a gold pill instead, and that rule is
         only exercised by a sample that actually carries the badge. */
      badges: [{ type: 'owner' }],
      avatar: 'https://yt3.ggpht.com/sample-owner=s64-c-k-c0x00ffffff-no-rj',
      text: 'welcome in, plenty of clips to get through today',
      emotes: [],
      timestamp: at(10),
      kind: 'chat',
    },
  },
  {
    group: 'unicode',
    label: 'Twitch message in mixed scripts, with an emote after astral characters',
    message: {
      platform: 'twitch',
      id: 'sample-unicode',
      senderId: 'sample-unicode-sender',
      /* A non-Latin display name as well as non-Latin body text: the name and
         the body take different paths (a name can be a pill, can be painted, and
         can be hidden by hideNames), so testing only one leaves the other
         unproven. */
      username: 'ユキ_yuki',
      color: '#ff9edb',
      /* premium is an official Twitch badge that is not a role, so it shows the
         non-role category without spending a line on it. */
      badges: [{ type: 'premium' }],
      text: UNICODE_TEXT,
      /* The emote sits *after* an astral-plane pair and a combining accent, so
         its offsets are only correct under codepoint indexing. A renderer that
         sliced by UTF-16 code unit would tear the text here — which is the whole
         reason this sample carries a native emote at all. */
      emotes: [nativeEmote(UNICODE_TEXT, PREVIEW_EMOTE_TOKENS.nativeTwitch, PREVIEW_EMOTE_NATIVE)],
      timestamp: at(11),
      kind: 'chat',
    },
  },
  {
    group: 'pin',
    label: 'TikTok message designated as the pinned one',
    message: {
      /* A library fixture, never part of the default six. The banner is opaque and
         top-anchored and stays for the whole five-second pin window, so it does
         not sit beside the showcase — it covers roughly half of it, leaving a
         ~180px readable band. It is offered once the feed is generating, where a
         pin arriving and retiring is the behaviour worth watching.

         TikTok rather than Twitch: the default pinPlatforms are kick/youtube/tiktok, and
         syncMultichatStyle strips twitch until an account is connected, so a
         Twitch pin fixture would silently render as an ordinary list row instead
         of a banner. Badges here resolve through renderBadges like anywhere else,
         which for TikTok means they must carry url art. */
      platform: 'tiktok',
      id: 'sample-pin',
      senderId: 'sample-pin-sender',
      username: 'pinnedviewer',
      color: '#ff5c8d',
      badges: [
        { type: 'moderator', url: PREVIEW_TIKTOK_MOD_BADGE },
        { type: 'subscriber', url: PREVIEW_TIKTOK_SUB_BADGE },
      ],
      text: 'read the pinned message before asking, thanks',
      emotes: [],
      timestamp: at(12),
      kind: 'chat',
    },
  },
];

/** Showcase then library — every fixture this module defines, in one order. */
export const SAMPLE_ALL_MESSAGES: readonly SampleMessage[] = [
  ...SAMPLE_MESSAGES,
  ...SAMPLE_LIBRARY_MESSAGES,
];

/* ------------------------------------------------------------------ */
/* Accessors                                                           */
/* ------------------------------------------------------------------ */

/**
 * The sample the preview pins, and who pinned it.
 *
 * Data rather than view logic, so "which message is pinned" is not a decision
 * the UI makes. The overlay takes a pin separately from the message list, so
 * this is deliberately *not* spliced into SAMPLE_MESSAGES — doing so would
 * render the same line twice.
 */
export const SAMPLE_PIN_ID = 'sample-pin';
/* The broadcaster pinning a moderator's message — the ordinary way a pin happens,
   and it names a chatter the preview actually shows rather than inventing one. */
export const SAMPLE_PIN_BY = 'purplereign';

/**
 * The default showcase, as messages — what the generator paints on arrival.
 *
 * Deliberately not the whole catalog. Six rows is what the frame can draw without
 * clipping one, so this is the set that fits, and it is what the preview receives
 * unless something explicitly asks for more.
 */
export function sampleMessages(): UnifiedMessage[] {
  return SAMPLE_MESSAGES.map((sample) => sample.message);
}

/**
 * Every fixture, showcase and library alike.
 *
 * For tests and explicit demonstrations that need the event cards, the wrapping
 * bot post, the Unicode line, the owner pill or the pin. Rendering this in the
 * default preview would overflow the frame, which is the reason for the split.
 */
export function sampleAllMessages(): UnifiedMessage[] {
  return SAMPLE_ALL_MESSAGES.map((sample) => sample.message);
}

/** The library fixture the preview pins, for a caller offering the banner. */
export function samplePinMessage(): UnifiedMessage | null {
  const found = SAMPLE_ALL_MESSAGES.find((sample) => sample.message.id === SAMPLE_PIN_ID);
  return found ? found.message : null;
}

/** The sample designated as pinned, or null if the id ever stops matching. */
export function samplePin(): UnifiedPin | null {
  const message = samplePinMessage();
  return message ? { message, pinnedBy: SAMPLE_PIN_BY } : null;
}

/** Platforms represented across every fixture, in first-appearance order. */
export function samplePlatforms(): Platform[] {
  const seen: Platform[] = [];
  for (const { message } of SAMPLE_ALL_MESSAGES) {
    if (!seen.includes(message.platform)) seen.push(message.platform);
  }
  return seen;
}

/** Platforms the default six-row showcase reaches, in first-appearance order. */
export function showcasePlatforms(): Platform[] {
  const seen: Platform[] = [];
  for (const { message } of SAMPLE_MESSAGES) {
    if (!seen.includes(message.platform)) seen.push(message.platform);
  }
  return seen;
}
