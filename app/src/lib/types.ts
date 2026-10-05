

export type Platform = 'kick' | 'twitch' | 'youtube' | 'tiktok';


export type EventCategory = 'subscription' | 'gift' | 'raid' | 'cheer' | 'milestone' | 'follow' | 'announcement';

export interface UnifiedEmote {
  
  begin: number;
  end: number;
  /** the literal token in the text, e.g. emote name */
  text: string;
  /** resolved image URL */
  url: string;
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
}

export interface TwitchSourceChannel {
  /** Canonical source-room-id from Twitch IRC Shared Chat. */
  roomId: string;
  displayName?: string;
  profileImageUrl?: string;
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
  /** channel-point redeem / highlighted message (twitch tags, kick reward event) */
  redeem?: boolean | string;
  /** Provider says this is the chatter's first message (currently Twitch first-msg). */
  firstMessage?: boolean;
  /** Twitch native GIF asset extracted from the provider's `gifs` IRC tag. */
  gifUrl?: string;
  
  avatar?: string;
  /** Provider-native reply preview (currently Kick + Twitch). */
  reply?: UnifiedReply;
  /** Twitch source streamer identity used when Shared Chat display is enabled. */
  sourceChannel?: TwitchSourceChannel;
  /** True only when this message originated in a partner room via Twitch Shared Chat. */
  sharedChat?: boolean;
}

export interface UnifiedPin {
  message: UnifiedMessage;
  /** who pinned it, if the platform tells us (kick: pinnedBy) */
  pinnedBy?: string;
}

export interface ConnectorCallbacks {
  onMessage(msg: UnifiedMessage): void;
  /** Same-ID metadata enrichment; never delays original message delivery. */
  onMessageUpdate?(msg: UnifiedMessage): void;
  /** id: delete one message; username: delete all from user; senderId: delete by platform user id; none: clear all (for this platform) */
  onDelete(opts: { id?: string; username?: string; senderId?: string }): void;
  onPin(pin: UnifiedPin | null): void;
  onStatus(status: 'connecting' | 'connected' | 'offline' | 'error', detail?: string): void;
}

export interface Connector {
  start(): void;
  stop(): void;
}
