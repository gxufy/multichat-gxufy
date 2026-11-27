/*
 * The chat overlay corpus: every sample message plus edge cases, and every
 * Twitch event fed as raw IRC lines through the real connector, with the
 * configurations they are drawn under. Shared by the overlay's snapshots
 * (web/src/lib/overlay/chat/ChatOverlay.svelte.spec.ts), the preview frames'
 * (PreviewFrames.svelte.spec.ts) and domPartsUpdate.test.ts.
 */
import { vi } from 'vitest';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { buildMessageFilter, buildParsedMessage } from '@/lib/multichatMessageModel';
import { SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL, type ParsedMessage } from '@/lib/kick';
import type { MentionPaint } from '@/lib/renderCore';
import type { UnifiedMessage } from '@/lib/types';
import { createTwitchConnector } from '@/lib/connectors/twitch';
import { SAMPLE_COSMETICS, sampleAllMessages } from '@/features/multichat/samples';

const base = (over: Partial<UnifiedMessage> & Pick<UnifiedMessage, 'id' | 'text'>): UnifiedMessage => ({
  platform: 'twitch',
  senderId: `s-${over.id}`,
  username: `user_${over.id}`,
  color: '#8a2be2',
  badges: [],
  emotes: [],
  timestamp: 1_767_225_600_000,
  kind: 'chat',
  ...over,
});

const sevenTV = SAMPLE_COSMETICS.emotes.twitch ?? [];
const regular = sevenTV.find((emote) => !emote.zeroWidth)?.name ?? 'OMEGALUL';
const zeroWidth = sevenTV.find((emote) => emote.zeroWidth)?.name;

/* Edge cases the samples don't all reach. Names first so later mentions resolve. */
export const EXTRA: UnifiedMessage[] = [
  base({ id: 'x1', username: 'PaintedPal', text: `hi ${regular} ffzSpin and w! ${regular}` }),
  base({ id: 'x2', text: `@PaintedPal @user_x1, @nobody look ${regular} ${zeroWidth ?? ''} ${zeroWidth ?? ''} end` }),
  base({
    id: 'x3',
    text: 'Kappa Kappa and ' + regular,
    emotes: [
      { begin: 0, end: 5, text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0' },
      { begin: 6, end: 11, text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0' },
    ],
  }),
  base({
    id: 'x4',
    platform: 'kick',
    color: '',
    text: '[emote:1:a][emote:2:b] hey',
    emotes: [
      { begin: 0, end: 11, text: 'a', url: 'https://files.kick.com/emotes/1/fullsize' },
      { begin: 11, end: 22, text: 'b', url: 'https://files.kick.com/emotes/2/fullsize' },
    ],
    badges: [
      { type: 'sub_gifter', count: 260 } as UnifiedMessage['badges'][number],
      { type: 'subscriber', count: 7 } as UnifiedMessage['badges'][number],
      { type: 'moderator' } as UnifiedMessage['badges'][number],
    ],
  }),
  base({
    id: 'x5',
    platform: 'youtube',
    username: '@OwnerPerson',
    color: '',
    text: 'owner here 🎉 ✨',
    badges: [{ type: 'owner' }, { type: 'moderator' }, { type: 'verified' }] as UnifiedMessage['badges'],
  }),
  base({
    id: 'x6',
    text: `@PaintedPal right ${regular}`,
    reply: { id: 'p', username: 'PaintedPal', text: `original ${regular} words` } as UnifiedMessage['reply'],
  }),
  base({ id: 'x7', platform: 'tiktok', color: '', text: 'tiktok viewer 😂', badges: [] }),
  base({
    id: 'x8',
    text: 'subbed badges',
    badges: [
      { type: 'broadcaster', version: '1' },
      { type: 'subscriber', version: '12' },
      { type: 'moderator', version: '1' },
    ] as UnifiedMessage['badges'],
  }),
];

/* PaintedPal wears the sample 7TV paint and badge; a 7TV "Kappa" set to
   override Twitch's own. */
export const COSMETICS = {
  ...SAMPLE_COSMETICS,
  emotes: {
    ...SAMPLE_COSMETICS.emotes,
    twitch: [
      ...sevenTV,
      { ...sevenTV.find((emote) => !emote.zeroWidth)!, name: 'Kappa', activeFlags: SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL },
    ],
  },
  entitlements: {
    ...SAMPLE_COSMETICS.entitlements,
    'twitch:s-x1': Object.values(SAMPLE_COSMETICS.entitlements)[0],
  },
};

export function parsedFor(query: Record<string, string>): { config: ReturnType<typeof MultichatQuerySchema.parse>; parsed: ParsedMessage[] } {
  const config = MultichatQuerySchema.parse(query);
  const shouldDisplay = buildMessageFilter(config);
  const mentions = { enabled: config.mentionColor, colors: new Map<string, string>(), paints: new Map<string, MentionPaint>() };
  const parsed: ParsedMessage[] = [];
  for (const message of [...sampleAllMessages(), ...EXTRA]) {
    if (shouldDisplay(message)) parsed.push(buildParsedMessage(message, config, COSMETICS, mentions, message.timestamp));
  }
  return { config, parsed };
}

/**
 * One row per line, so a snapshot diff points at the row that changed. Spaces
 * at line ends (only ever inside the overlay's CSS text) are dropped so the
 * files stay clean for `git diff --check`.
 */
export const CHANNELS = { twitch: 'gxufy', kick: 'gxufy', youtube: 'gxufy', tiktok: 'gxufy' };
export const CONFIGS: Record<string, Record<string, string>> = {
  default: { ...CHANNELS, animation: 'none' },
  'entry-left-scaled': { ...CHANNELS, entryAnimation: 'slideLeft', emoteScale: '1.5', textSizePx: '30', fade: '20' },
  'large-stroke-label': { ...CHANNELS, animation: 'none', textSize: 'large', stroke: 'thick', textShadow: 'small', sourceTag: 'label', msgCaps: 'true' },
  'dot-no-mentions-reply-mention': { ...CHANNELS, animation: 'none', sourceTag: 'dot', mentionColor: 'false', replyStyle: 'mention', paintShadows: 'false' },
  'hide-badges-custom-font': { ...CHANNELS, animation: 'none', hideBadges: 'true', font: 'geist', fontWeight: '400', fontItalic: 'true', bgColor: '191919' },
  'no-7tv-avatars': { ...CHANNELS, animation: 'none', sevenTVEmotesEnabled: 'false', sevenTVCosmeticsEnabled: 'false', showAvatars: 'true', sourceTag: 'none' },
};

/* ------------------------------------------------------------------ */
/* Twitch events, from raw IRC lines through the real connector         */
/* ------------------------------------------------------------------ */

export const EVENT_LINES = [
  '@badges=subscriber/1;color=#FF7F50;display-name=Viewer;id=sub-1;login=viewer;msg-id=sub;msg-param-cumulative-months=1;msg-param-sub-plan=1000;system-msg=Viewer\\ssubscribed\\sat\\sTier\\s1.;tmi-sent-ts=1;user-id=9 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=subscriber/8;color=#A970FF;display-name=LongTimeViewer;emotes=;id=resub-1;login=longtimeviewer;msg-id=resub;msg-param-cumulative-months=8;msg-param-should-share-streak=1;msg-param-streak-months=3;msg-param-sub-plan=Prime;system-msg=LongTimeViewer\\ssubscribed\\sfor\\s8\\smonths!;tmi-sent-ts=2;user-id=10 :tmi.twitch.tv USERNOTICE #streamer :still here after all this time',
  '@badges=sub-gifter/1;color=#FF7F50;display-name=GiftKing;id=gift-1;login=giftking;msg-id=subgift;msg-param-recipient-display-name=LuckyViewer;msg-param-recipient-id=55;msg-param-recipient-user-name=luckyviewer;msg-param-sub-plan=1000;tmi-sent-ts=3;user-id=11 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=sub-gifter/10;color=#A970FF;display-name=GiftBoss;id=bomb-1;login=giftboss;msg-id=submysterygift;msg-param-mass-gift-count=5;msg-param-origin-id=origin-1;msg-param-sender-count=120;msg-param-sub-plan=1000;tmi-sent-ts=4;user-id=12 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=sub-gifter/10;color=#A970FF;display-name=GiftBoss;id=child-1;login=giftboss;msg-id=subgift;msg-param-origin-id=origin-1;msg-param-recipient-display-name=ViewerOne;msg-param-recipient-id=20;msg-param-recipient-user-name=viewerone;msg-param-sub-plan=1000;tmi-sent-ts=5;user-id=12 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=;color=;id=anon-1;msg-id=anonsubgift;msg-param-recipient-display-name=Viewer;msg-param-recipient-id=44;msg-param-recipient-user-name=viewer;msg-param-sub-plan=Prime;tmi-sent-ts=6 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=;color=#FF4F91;display-name=RaidBoss;id=raid-1;login=raidboss;msg-id=raid;msg-param-displayName=RaidBoss;msg-param-login=raidboss;msg-param-profileImageURL=https://cdn.example/raidboss.png;msg-param-viewerCount=420;system-msg=420\\sraiders\\sfrom\\sRaidBoss\\sare\\shere!;tmi-sent-ts=7;user-id=55 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=;color=;display-name=SmallRaider;id=raid-2;login=smallraider;msg-id=raid;msg-param-displayName=SmallRaider;msg-param-login=smallraider;msg-param-viewerCount=7;tmi-sent-ts=8 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=subscriber/1;color=#A970FF;display-name=PrimeViewer;id=u1;login=primeviewer;msg-id=primepaidupgrade;msg-param-sub-plan=1000;system-msg=PrimeViewer\\sconverted\\sfrom\\sa\\sPrime\\ssub\\sto\\sa\\sTier\\s1\\ssub!;tmi-sent-ts=9;user-id=1 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=subscriber/1;color=#FF7F50;display-name=GiftReceiver;id=u2;login=giftreceiver;msg-id=giftpaidupgrade;msg-param-sender-login=giftboss;msg-param-sender-name=GiftBoss;msg-param-promo-name=Subtember;msg-param-promo-gift-total=5;tmi-sent-ts=10;user-id=2 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=subscriber/1;color=#53FC18;display-name=PayForwarder;id=u3;login=payforwarder;msg-id=standardpayforward;msg-param-prior-gifter-anonymous=false;msg-param-prior-gifter-display-name=OriginalGifter;msg-param-prior-gifter-id=20;msg-param-recipient-display-name=NextViewer;msg-param-recipient-id=21;tmi-sent-ts=11;user-id=3 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=subscriber/1;color=#38BDF8;display-name=CommunityForwarder;id=u4;login=communityforwarder;msg-id=communitypayforward;msg-param-prior-gifter-anonymous=true;msg-param-prior-gifter-display-name=ShouldNotShow;tmi-sent-ts=12;user-id=4 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=broadcaster/1;color=#A970FF;display-name=Streamer;emotes=;id=a1;login=streamer;msg-id=announcement;msg-param-color=PURPLE;tmi-sent-ts=13;user-id=1 :tmi.twitch.tv USERNOTICE #streamer :Big announcement tonight!',
  '@badges=;color=#1E90FF;display-name=Viewer;id=m1;login=viewer;msg-id=viewermilestone;msg-param-category=watch-streak;msg-param-value=7;msg-param-copoReward=450;tmi-sent-ts=14;user-id=2 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=bits/10000;color=#38BDF8;display-name=Cheerer;id=m2;login=cheerer;msg-id=bitsbadgetier;msg-param-threshold=10000;tmi-sent-ts=15;user-id=3 :tmi.twitch.tv USERNOTICE #streamer',
  '@badges=moderator/1;color=#22C55E;display-name=ModHero;emotes=;id=m3;login=modhero;msg-id=modiversary;msg-param-months=36;tmi-sent-ts=16;user-id=4 :tmi.twitch.tv USERNOTICE #streamer :three years already!',
  '@badges=;bits=1000;color=#FF7F50;display-name=BigCheerer;emotes=;id=c1;tmi-sent-ts=17;user-id=7 :bigcheerer!bigcheerer@bigcheerer.tmi.twitch.tv PRIVMSG #streamer :Cheer1000 lets go',
  '@badges=;bits=100;color=;display-name=SmallCheerer;emotes=;id=c2;tmi-sent-ts=18;user-id=8 :smallcheerer!smallcheerer@smallcheerer.tmi.twitch.tv PRIVMSG #streamer :Kappa Cheer100',
];

class EventSocket {
  static last: EventSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { EventSocket.last = this; }
  send() {}
  close() {}
}

/** The Twitch events the connector makes of EVENT_LINES, plus a Hype Train in progress and complete. */
export async function twitchEventMessages(): Promise<UnifiedMessage[]> {
  vi.stubGlobal('WebSocket', EventSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response));
  const out: UnifiedMessage[] = [];
  const connector = createTwitchConnector({ channel: 'streamer', onMessage: (m) => out.push(m), onDelete: () => {}, onStatus: () => {} });
  try {
    connector.start();
    EventSocket.last!.onopen?.();
    for (const line of EVENT_LINES) EventSocket.last!.onmessage?.({ data: `${line}\r\n` });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    connector.stop();
    vi.unstubAllGlobals();
  }
  for (const [phase, level, progress, goal] of [['progress', 3, 1200, 2000], ['end', 5, 0, 0]] as const) {
    out.push(base({
      id: `hype-${phase}`, senderId: 'twitch-hype-train', username: 'Twitch', color: '#9147ff', kind: 'system',
      category: 'hypetrain', text: 'Hype Train', hypeTrain: { phase, level, progress, goal, hideAfterMs: 5000 },
    } as Partial<UnifiedMessage> & Pick<UnifiedMessage, 'id' | 'text'>));
  }
  return out;
}

export const EVENT_CONFIGS: Record<string, Record<string, string>> = {
  'events-default': { twitch: 'streamer', animation: 'none' },
  'events-multi-large-hidenames': { ...CHANNELS, animation: 'none', textSize: 'large', hideNames: 'true', stroke: 'medium', textShadow: 'large' },
  /* Every event's person wears the sample 7TV paint (see paintEveryone). */
  'events-painted': { twitch: 'streamer', animation: 'none', stroke: 'thin', paintEveryone: 'true' },
};

/** Cosmetics in which everyone named in these messages wears the sample paint. */
export function paintedCosmeticsFor(messages: readonly UnifiedMessage[]) {
  const paint = SAMPLE_COSMETICS.paints[0]!.id;
  const entitlements: Record<string, { badge?: string; paint?: string }> = { ...COSMETICS.entitlements };
  for (const message of messages) {
    if (message.senderId) entitlements[`${message.platform}:${message.senderId}`] = { paint };
  }
  return { ...COSMETICS, entitlements };
}

/** Twitch event messages parsed for one configuration (`paintEveryone: 'true'` paints them all). */
export async function parsedEvents(query: Record<string, string>) {
  const events = await twitchEventMessages();
  const config = MultichatQuerySchema.parse(query);
  const cosmetics = query.paintEveryone === 'true' ? paintedCosmeticsFor(events) : COSMETICS;
  const mentions = { enabled: config.mentionColor, colors: new Map<string, string>(), paints: new Map<string, MentionPaint>() };
  return { config, events, parsed: events.map((message) => buildParsedMessage(message, config, cosmetics, mentions, message.timestamp)) };
}
