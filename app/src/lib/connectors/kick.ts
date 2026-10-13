import Pusher from 'pusher-js';
import { getKickChannel, type KickChannel } from '../kick';
import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';
import { isMessageFromCurrentOverlaySession } from '../startupMessageBaseline';

const KICK_EMOTE_RE = /\[(?:emote|emoji):(\w+):([^\]]*)\]/g;
export const KICK_HISTORY_MAX = 40;
const KICK_HISTORY_TIMEOUT_MS = 2_500;
const KICK_RECONNECT_DELAY_MS = 2_000;
const KICK_SEEN_MAX = 512;

function decodeKickPayload(value: any): any {
  if (typeof value !== 'string') return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
}

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function safeImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Count Unicode code points without allocating the array that Array.from creates. */
function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length++;
  return length;
}

/** Replace Kick's native emote tokens while recording codepoint offsets. */
export function parseKickEmotes(content: string): { text: string; emotes: UnifiedEmote[] } {
  const emotes: UnifiedEmote[] = [];
  let text = '';
  let last = 0;
  let textCodePoints = 0;
  for (const match of content.matchAll(KICK_EMOTE_RE)) {
    const prefix = content.slice(last, match.index);
    text += prefix;
    textCodePoints += codePointLength(prefix);

    const name = match[2] || 'emote';
    const nameCodePoints = codePointLength(name);
    const begin = textCodePoints;
    emotes.push({
      begin,
      end: begin + nameCodePoints,
      text: name,
      url: `https://files.kick.com/emotes/${match[1]}/fullsize`,
    });
    text += name;
    textCodePoints += nameCodePoints;
    last = match.index! + match[0].length;
  }
  text += content.slice(last);
  return { text, emotes };
}

function plainKickText(content: unknown): string {
  return parseKickEmotes(typeof content === 'string' ? content : '').text;
}

/** Merge legacy role badges and image-backed badges by Kick's own sort_order. */
export function buildKickBadges(rawMsg: any): UnifiedBadge[] {
  const identity = rawMsg?.sender?.identity ?? {};
  const ordered: Array<{ order: number; index: number; badge: UnifiedBadge }> = [];
  let index = 0;

  for (const badge of Array.isArray(identity.badges) ? identity.badges : []) {
    if (typeof badge?.type !== 'string' || !badge.type) continue;
    const count = finiteNumber(badge.count ?? badge.rank);
    const order = finiteNumber(badge.sort_order) ?? 1_000;
    ordered.push({
      order,
      index: index++,
      badge: {
        type: badge.type,
        ...(count !== undefined ? { count, version: String(count) } : {}),
      },
    });
  }

  for (const badge of Array.isArray(identity.badges_v2) ? identity.badges_v2 : []) {
    const url = safeImage(badge?.image_url);
    if (!url) continue;
    const level = finiteNumber(badge?.metadata?.level);
    const order = finiteNumber(badge?.sort_order) ?? 1_000;
    ordered.push({
      order,
      index: index++,
      badge: {
        type: typeof badge?.name === 'string' && badge.name ? badge.name : 'v2',
        url,
        ...(level !== undefined ? { count: level, version: String(level) } : {}),
      },
    });
  }

  ordered.sort((a, b) => a.order - b.order || a.index - b.index);
  return ordered.map((entry) => entry.badge);
}

function kickTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function buildKickMessage(input: any): UnifiedMessage {
  const rawMsg = decodeKickPayload(input);
  const { text, emotes } = parseKickEmotes(typeof rawMsg.content === 'string' ? rawMsg.content : '');
  const sender = rawMsg.sender ?? {};
  const metadata = rawMsg.type === 'reply' ? rawMsg.metadata : null;
  const parentSender = metadata?.original_sender;
  const parentMessage = metadata?.original_message;
  const senderUsername = typeof sender.slug === 'string' && sender.slug.trim()
    ? sender.slug
    : typeof sender.username === 'string' && sender.username.trim()
      ? sender.username
      : undefined;
  const reply = metadata && parentSender && parentMessage
    ? {
        username: String(parentSender.username ?? parentSender.slug ?? 'Unknown'),
        text: plainKickText(parentMessage.content),
        ...(parentMessage.id ? { messageId: String(parentMessage.id) } : {}),
        ...(parentSender.id !== undefined ? { senderId: String(parentSender.id) } : {}),
      }
    : undefined;

  return {
    platform: 'kick',
    id: String(rawMsg.id ?? `kick-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    senderId: sender.id?.toString() ?? '',
    ...(senderUsername ? { senderUsername } : {}),
    username: sender.username ?? sender.slug ?? '',
    color: sender.identity?.color || '#ffffff',
    badges: buildKickBadges(rawMsg),
    text,
    emotes,
    timestamp: kickTimestamp(rawMsg.created_at ?? rawMsg.timestamp),
    kind: 'chat',
    ...(reply ? { reply } : {}),
  };
}

async function historyResponse(channelId: number, signal?: AbortSignal): Promise<any | null> {
  const urls = [
    `/api/kick/history?channelId=${encodeURIComponent(String(channelId))}`,
    `https://kick.com/api/v2/channels/${channelId}/messages`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal,
        cache: 'no-store',
      });
      if (response.ok) return await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
  }
  return null;
}

/** Seed recent Kick context oldest-to-newest using the same parser as live rows. */
export async function fetchKickHistory(channel: KickChannel, signal?: AbortSignal): Promise<UnifiedMessage[]> {
  const body = await historyResponse(channel.id, signal);
  const rows = body?.data?.messages;
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, KICK_HISTORY_MAX)
    .reverse()
    .map(buildKickMessage)
    .filter((message) => Boolean(message.id));
}

export interface KickConnectorOpts extends ConnectorCallbacks {
  channel: string;
  onChannelInfo?(channel: KickChannel): void;
}

export function createKickConnector(opts: KickConnectorOpts): Connector {
  let pusher: Pusher | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let historyAbort: AbortController | null = null;
  let starting = false;
  let stopped = false;
  const startedAt = Date.now();
  let bootstrappingHistory = true;
  const pendingLive: UnifiedMessage[] = [];
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  function remember(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    seenOrder.push(id);
    while (seenOrder.length > KICK_SEEN_MAX) {
      const old = seenOrder.shift();
      if (old) seen.delete(old);
    }
    return true;
  }

  function deliver(message: UnifiedMessage): void {
    if (!message.id || !remember(message.id)) return;
    /* Kick's history endpoint is only a race-closure source now. Rows that were
     * already present when this overlay instance started establish the baseline
     * but never enter the render/command pipeline. A message that arrives during
     * bootstrap still survives because its provider timestamp is >= startedAt. */
    if (!isMessageFromCurrentOverlaySession(message.timestamp, startedAt)) return;
    opts.onMessage(message);
  }

  function deliverLive(message: UnifiedMessage): void {
    if (bootstrappingHistory) pendingLive.push(message);
    else deliver(message);
  }

  function systemMessage(text: string, username: string, category: UnifiedMessage['category']) {
    opts.onMessage({
      platform: 'kick',
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderId: '',
      username,
      color: '',
      badges: [],
      text,
      emotes: [],
      timestamp: Date.now(),
      kind: 'system',
      category,
    });
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(owner: Pusher): void {
    if (stopped || pusher !== owner || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped || pusher !== owner) return;
      owner.connect();
    }, KICK_RECONNECT_DELAY_MS);
  }

  async function start() {
    if (stopped) return;
    opts.onStatus('connecting');
    const channel = await getKickChannel(opts.channel);
    if (!channel) {
      opts.onStatus('error', `Could not find Kick channel: "${opts.channel}"`);
      return;
    }
    if (stopped) return;
    opts.onChannelInfo?.(channel);

    const activePusher = new Pusher('32cbd69e4b950bf97679', {
      cluster: 'us2',
      disableStats: true,
      activityTimeout: 20_000,
      pongTimeout: 8_000,
    });
    pusher = activePusher;

    const chatroomName = `chatrooms.${channel.chatroom.id}.v2`;
    const channelId = channel.id;

    function bindChannel() {
      if (stopped || pusher !== activePusher) return;
      const chat = activePusher.subscribe(chatroomName);
      chat.bind('App\\Events\\ChatMessageEvent', (data: any) => {
        const raw = decodeKickPayload(data);
        const message = buildKickMessage(raw);
        if (raw.type === 'celebration' || raw.metadata?.celebration || raw.metadata?.reward) {
          message.redeem = raw.metadata?.reward?.title ?? 'celebration';
        }
        deliverLive(message);
      });
      chat.bind('App\\Events\\RewardRedeemedEvent', (data: any) => {
        const d = decodeKickPayload(data);
        opts.onMessage({
          platform: 'kick',
          id: `redeem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          senderId: d.user_id?.toString() ?? '',
          username: d.username ?? 'Someone',
          color: '', badges: [], emotes: [], timestamp: Date.now(), kind: 'chat',
          text: d.user_input ? `${d.reward_title}: ${d.user_input}` : (d.reward_title ?? 'redeemed a reward'),
          redeem: d.reward_title ?? 'reward',
        });
      });
      chat.bind('App\\Events\\MessageDeletedEvent', (data: any) => {
        const d = decodeKickPayload(data);
        const id = d.message?.id ?? d.message_id;
        if (id) opts.onDelete({ id: String(id) });
      });
      chat.bind('App\\Events\\UserBannedEvent', (data: any) => {
        const d = decodeKickPayload(data);
        const senderId = d.user?.id?.toString();
        const username = d.user?.username;
        opts.onDelete({ ...(senderId ? { senderId } : {}), ...(username ? { username } : {}) });
      });
      chat.bind('App\\Events\\ChatroomClearEvent', () => opts.onDelete({}));
      chat.bind('App\\Events\\PinnedMessageCreatedEvent', (data: any) => {
        const d = decodeKickPayload(data);
        if (d?.message) opts.onPin({ message: buildKickMessage(d.message), pinnedBy: d.pinnedBy?.username });
      });
      chat.bind('App\\Events\\PinnedMessageDeletedEvent', () => opts.onPin(null));
      chat.bind('App\\Events\\SubscriptionEvent', (data: any) => {
        const d = decodeKickPayload(data);
        const months = Number(d.months ?? 0);
        const username = d.username ?? d.user?.username ?? '';
        systemMessage(`${username} subscribed!${months > 1 ? ` (${months} months)` : ''}`, username, 'subscription');
      });
      chat.bind('App\\Events\\GiftedSubscriptionsEvent', (data: any) => {
        const d = decodeKickPayload(data);
        const count = Array.isArray(d.gifted_usernames) ? d.gifted_usernames.length : Number(d.count ?? 1);
        const username = d.gifter_username ?? d.gifter?.username ?? '';
        systemMessage(`${username} gifted ${count} subscription${count === 1 ? '' : 's'}!`, username, 'gift');
      });
      chat.bind('App\\Events\\StreamHostEvent', (data: any) => {
        const d = decodeKickPayload(data);
        const username = d.host_username ?? d.host?.username ?? '';
        systemMessage(`${username} is hosting with ${d.number_viewers ?? '?'} viewers!`, username, 'raid');
      });

      const kicksHandler = (data: any) => {
        const d = decodeKickPayload(data);
        const sender = d?.sender?.username ?? 'Someone';
        const gift = d?.gift;
        if (!gift) return;
        systemMessage(`${sender} sent ${gift.name ?? 'a gift'} (${gift.amount ?? '?'} Kicks)`, sender, 'cheer');
      };
      activePusher.subscribe(`channel.${channelId}`).bind('KicksGifted', kicksHandler);
      activePusher.subscribe(`channel_${channelId}`).bind('KicksGifted', kicksHandler);
    }

    bindChannel();

    activePusher.connection.bind('connected', () => {
      if (stopped || pusher !== activePusher) return;
      clearReconnectTimer();
      opts.onStatus('connected');
      if (!activePusher.channel(chatroomName)) bindChannel();
    });
    activePusher.connection.bind('state_change', ({ current }: { current: string }) => {
      if (current === 'disconnected') scheduleReconnect(activePusher);
    });
    watchdog = setInterval(() => {
      if (stopped || pusher !== activePusher) return;
      const state = activePusher.connection.state;
      if (state === 'unavailable' || state === 'failed') {
        activePusher.disconnect();
        scheduleReconnect(activePusher);
      }
    }, 10_000);

    historyAbort = new AbortController();
    const historyTimeout = setTimeout(() => historyAbort?.abort(), KICK_HISTORY_TIMEOUT_MS);
    try {
      const history = await fetchKickHistory(channel, historyAbort.signal);
      if (!stopped) history.forEach(deliver);
    } catch {
      // History is optional race closure; live Pusher traffic remains authoritative.
    } finally {
      clearTimeout(historyTimeout);
      historyAbort = null;
      bootstrappingHistory = false;
      if (!stopped) pendingLive.splice(0).forEach(deliver);
    }
  }

  return {
    start() {
      if (stopped || starting || pusher) return;
      starting = true;
      void start().finally(() => {
        starting = false;
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      historyAbort?.abort();
      historyAbort = null;
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      clearReconnectTimer();
      const activePusher = pusher;
      pusher = null;
      activePusher?.disconnect();
      pendingLive.length = 0;
    },
  };
}
