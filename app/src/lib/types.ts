import type { JilTVPaintView } from './jiltvCosmeticsContract';


export type Platform = 'kick' | 'twitch' | 'youtube' | 'tiktok';


export type EventCategory =
  | 'subscription'
  | 'gift'
  | 'raid'
  | 'cheer'
  | 'milestone'
  | 'follow'
  | 'announcement'
  | 'hypetrain';

/** A level-up (or a train that just started) the Hype Train card plays once. */
export interface HypeTrainCelebration {
  kind: 'level' | 'kickoff';
  /** The level it announces. */
  level: number;
  words: string;
  /** How long the words take to cross the card; the celebration lasts this long. */
  ms: number;
  /** When it began (ms since the epoch, on this viewer's clock). */
  at: number;
}

/** The kind of Hype Train Twitch runs (its `hypeTrainType`). */
export type HypeTrainKind = 'regular' | 'golden-kappa' | 'treasure' | 'mythic' | 'community' | 'pinata';

export interface HypeTrainEventData {
  phase: 'progress' | 'end';
  level: number;
  progress: number;
  goal: number;
  hideAfterMs?: number;
  /** When the level's countdown runs out (ms since the epoch, on this viewer's clock). */
  endsAt?: number;
  /** When the train started (ms since the epoch, on this viewer's clock). */
  startedAt?: number;
  /** Unset: a regular train. */
  kind?: HypeTrainKind;
  /** Shared across several channels. */
  shared?: boolean;
  /** The channel's biggest train ever. */
  record?: boolean;
  /** A treasure train's gift-sub discount, unlocked at `level`. */
  treasure?: { percent: number; level: number };
  /** Set by the overlay runtime: the celebration this update started (or one still playing). */
  celebration?: HypeTrainCelebration;
  /** Set by the overlay runtime: the percentage the bar showed before this update. */
  fromPercent?: number;
}

export interface TwitchCheermoteVisual {
  prefix: string;
  bits: number;
  tierMinBits: number;
  color: string;
  animatedUrl?: string;
  staticUrl?: string;
}

export interface TwitchAnnouncementEventData {
  /** Twitch /announce color name such as PRIMARY, BLUE, GREEN, ORANGE, PURPLE. */
  color: string;
  systemMessage?: string;
}

export interface TwitchMilestoneEventData {
  type:
    | 'watch-streak'
    | 'bits-badge'
    | 'modiversary';
  /** Consecutive streams, Bits threshold, or moderator months. */
  value: number;
  /** IRC may provide channel-points awarded for viewer milestones. */
  channelPoints?: number;
  systemMessage?: string;
}

export interface TwitchRaidEventData {
  raiderLogin?: string;
  raiderDisplayName: string;
  viewers: number;
  profileImageUrl?: string;
  systemMessage?: string;
}

export interface TwitchGiftRecipient {
  userId?: string;
  username?: string;
  displayName: string;
}

export interface TwitchGiftEventData {
  type: 'gift' | 'community';
  anonymous: boolean;
  plan: string;
  count: number;
  recipient?: TwitchGiftRecipient;
  /** Lifetime/channel total supplied by Twitch when available. */
  senderCount?: number;
  /** Community-gift id shared by the bomb announcement and child gifts. */
  originId?: string;
  /** Recipients discovered from child subgift notices. */
  recipients?: TwitchGiftRecipient[];
}

export interface TwitchSubscriptionTransitionEventData {
  type:
    | 'prime-paid-upgrade'
    | 'gift-paid-upgrade'
    | 'anonymous-gift-paid-upgrade'
    | 'standard-pay-forward'
    | 'community-pay-forward';

  /** Present when Twitch supplied a destination subscription tier. */
  plan?: string;

  /** Original gifter for gift upgrades / pay-forward events when known. */
  priorGifterDisplayName?: string;

  /** Whether Twitch identified the original gifter as anonymous. */
  priorGifterAnonymous?: boolean;

  /** Standard pay-forward target; community pay-forward has no single target. */
  recipientDisplayName?: string;

  /** Historic gift-upgrade promotion metadata, when Twitch supplies it. */
  promoName?: string;
  promoGiftTotal?: number;

  systemMessage?: string;
}

export interface TwitchSubscriptionEventData {
  type: 'sub' | 'resub';
  /** Twitch IRC msg-param-sub-plan: Prime, 1000, 2000, or 3000. */
  plan: string;
  /** Total/cumulative subscribed months where Twitch supplied it. */
  months: number;
  /** Shared streak only when msg-param-should-share-streak is 1. */
  streakMonths?: number;
  /** Original human-readable Twitch system-msg, retained as fallback context. */
  systemMessage?: string;
}

export interface TwitchCheerEventData {
  /** Authoritative IRC bits tag total. */
  bits: number;
  /** Cheermote tokens actually found in the chat body. */
  cheermotes: TwitchCheermoteVisual[];
}

export interface UnifiedEmote {
  
  begin: number;
  end: number;
  /** the literal token in the text, e.g. emote name */
  text: string;
  /** resolved image URL */
  url: string;
  /** Twitch Bits artwork uses the normal native-emote rendering path. */
  kind?: 'cheermote';
}

export interface UnifiedBadge {
  /** platform badge type, lowercase: broadcaster/moderator/subscriber/... */
  type: string;
  /** Provider-facing accessible label for badge art, when supplied. */
  title?: string;
  /** Exact provider version. Twitch versions are opaque strings, not numbers. */
  version?: string;
  /** kick: sub months / gift count; used to pick badge art */
  count?: number;
  /** pre-resolved image URL (youtube member badges, kick badges_v2) */
  url?: string;
  /** One-shot still fallback for optional animated community badge art. */
  fallbackUrl?: string;
  /** Provider-defined tile/background color for transparent badge art (notably FFZ). */
  backgroundColor?: string;
}

export interface UnifiedReply {
  /** Provider message id of the parent, when available. */
  messageId?: string;
  /** Provider user id of the parent author, when available. */
  senderId?: string;
  username: string;
  text: string;
  /** Native emote offsets captured from the parent message when available. */
  emotes?: UnifiedEmote[];
}

export interface TwitchSourceChannel {
  /** Canonical source-room-id from Twitch IRC Shared Chat. */
  roomId: string;
  displayName?: string;
  profileImageUrl?: string;
}

export interface TwitchGifAsset {
  /** Inclusive code-point offset supplied by Twitch. */
  start: number;
  /** Exclusive code-point offset used by the renderer. */
  end: number;
  id: string;
  url: string;
}

/**
 * A chatter's own badge layout, chosen in their chat client (Moltorino v2's
 * badge layout): badge kinds as slot keys (`ta` Twitch role, `ts` Twitch
 * subscriber, `tv` other Twitch badge, `tp` Twitch prediction, `c`
 * Chatterino, `ff` FFZ, `fa` FFZ:AP, `bt` BTTV, `m` Moltorino, `bl`
 * Bluzyrino, `jc` JilChat, `wy` Wydios, `bh` BadgeHQ, `7` 7TV, `hc` Homies
 * custom, `hs` Homies supporter).
 */
export interface ViewerBadgeLayout {
  /** The order they chose (empty: the overlay's own order). */
  readonly order: readonly string[];
  /** Badge kinds they hid. */
  readonly hidden: readonly string[];
}

export interface UnifiedMessage {
  platform: Platform;
  /** Preview-only visual source mark. Production connectors leave this absent. */
  displayPlatform?: Platform;
  id: string;
  /** platform sender id — keys 7TV entitlements for kick */
  senderId: string;
  /** Provider-controlled login, slug, handle, or uniqueId when available. */
  senderUsername?: string;
  /** Provider-controlled display name, retained separately from visible formatting. */
  senderDisplayName?: string;
  /** Display-facing name or nickname used by the renderer. */
  username: string;
  /** hex color or '' (yt/tiktok have none) */
  color: string;
  badges: UnifiedBadge[];
  text: string;
  emotes: UnifiedEmote[];
  timestamp: number;
  /** system events (gifts, subs, superchats) render as event cards */
  kind: 'chat' | 'system';
  /** event card category (system only) */
  category?: EventCategory;
  /** Structured Twitch Hype Train state for the dedicated event row. */
  hypeTrain?: HypeTrainEventData;
  /** Structured Twitch Bits/Cheermote data for the dedicated cheer row. */
  twitchCheer?: TwitchCheerEventData;
  /** Structured anonymous-IRC Twitch subscription/resub event data. */
  twitchSubscription?: TwitchSubscriptionEventData;
  /** Structured Twitch paid-upgrade / pay-forward subscription notice data. */
  twitchSubscriptionTransition?: TwitchSubscriptionTransitionEventData;
  /** Structured anonymous-IRC Twitch gift/community-gift data. */
  twitchGift?: TwitchGiftEventData;
  /** Structured anonymous-IRC Twitch raid data. */
  twitchRaid?: TwitchRaidEventData;
  /** Structured Twitch /announce data. */
  twitchAnnouncement?: TwitchAnnouncementEventData;
  /** Structured Twitch viewer/Bits/moderator milestone data. */
  twitchMilestone?: TwitchMilestoneEventData;
  /** channel-point redeem / highlighted message (twitch tags, kick reward event) */
  redeem?: boolean | string;
  /** Provider says this is the chatter's first message (currently Twitch first-msg). */
  firstMessage?: boolean;
  /** Twitch "Gigantify an Emote" power-up: the message's last emote is shown big. */
  gigantifiedEmote?: boolean;
  /** JilTV paint the sender wears (only filled while the JilTV cosmetics gate is on). */
  jiltvPaint?: JilTVPaintView;
  /** The sender's own badge layout from their chat client (Moltorino), Twitch
   *  only: see lib/viewerBadgeLayout. */
  viewerBadgeLayout?: ViewerBadgeLayout;
  /** Structured Twitch native GIF assets extracted from the provider's `gifs` IRC tag. */
  twitchGifs?: TwitchGifAsset[];
  /** Legacy whole-message Twitch GIF asset retained for restored-message compatibility. */
  gifUrl?: string;
  
  avatar?: string;
  /** Provider-native reply preview (currently Kick + Twitch). */
  reply?: UnifiedReply;
  /** Twitch source streamer identity used when Shared Chat display is enabled. */
  sourceChannel?: TwitchSourceChannel;
  /** True only when this message originated in a partner room via Twitch Shared Chat. */
  sharedChat?: boolean;
}

export interface ConnectorCallbacks {
  onMessage(msg: UnifiedMessage): void;
  /** Same-ID metadata enrichment; never delays original message delivery. */
  onMessageUpdate?(msg: UnifiedMessage): void;
  /** id: delete one message; username: delete all from user; senderId: delete by platform user id; none: clear all (for this platform) */
  onDelete(opts: { id?: string; username?: string; senderId?: string }): void;
  onStatus(status: 'connecting' | 'connected' | 'offline' | 'error', detail?: string): void;
}

export interface Connector {
  start(): void;
  stop(): void;
}
