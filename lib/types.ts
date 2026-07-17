/* Unified multi-platform chat model.
 *
 * Connectors (kick/youtube/tiktok) emit UnifiedMessage — a plain-data,
 * platform-agnostic message (modelled after unified-chat-lite's Message
 * dataclass: text + emote char-offsets, not pre-rendered nodes).
 * The renderer in pages/index.tsx converts UnifiedMessage → ParsedMessage
 * (React nodes), applying 7TV emotes/cosmetics for Kick.
 */

export type Platform = 'kick' | 'twitch' | 'youtube' | 'tiktok';

/** StreamNook event categories — drive event-card icon + tint */
export type EventCategory = 'subscription' | 'gift' | 'raid' | 'cheer' | 'milestone' | 'follow' | 'announcement';

export interface UnifiedEmote {
  /** char offsets into `text` (codepoint-safe, like unified-chat-lite) */
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
  /** kick: sub months / gift count; used to pick badge art */
  count?: number;
  /** pre-resolved image URL (youtube member badges, kick badges_v2) */
  url?: string;
}

export interface UnifiedMessage {
  platform: Platform;
  id: string;
  /** platform sender id — keys 7TV entitlements for kick */
  senderId: string;
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
  /** avatar URL — yt/tiktok only (StreamNook: other platforms don't carry one) */
  avatar?: string;
}

export interface UnifiedPin {
  message: UnifiedMessage;
  /** who pinned it, if the platform tells us (kick: pinnedBy) */
  pinnedBy?: string;
}

export interface ConnectorCallbacks {
  onMessage(msg: UnifiedMessage): void;
  /** id: delete one message; username: delete all from user; senderId: delete by platform user id; none: clear all (for this platform) */
  onDelete(opts: { id?: string; username?: string; senderId?: string }): void;
  onPin(pin: UnifiedPin | null): void;
  onStatus(status: 'connecting' | 'connected' | 'offline' | 'error', detail?: string): void;
}

export interface Connector {
  start(): void;
  stop(): void;
}
