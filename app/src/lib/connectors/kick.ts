import { getKickChannel, type KickChannel } from '../kick';
import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';
import { isMessageFromCurrentOverlaySession } from '../startupMessageBaseline';

const KICK_EMOTE_RE = /\[(?:emote|emoji):(\w+):([^\]]*)\]/g;
export const KICK_HISTORY_MAX = 40;
const KICK_HISTORY_TIMEOUT_MS = 2_500;
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
  let es: EventSource | null = null;
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

    /*
     * History is only a startup race-closure source. Messages already
     * present before this overlay instance started never enter the render
     * or command pipeline.
     */
    if (
      !isMessageFromCurrentOverlaySession(
        message.timestamp,
        startedAt,
      )
    ) {
      return;
    }

    opts.onMessage(message);
  }

  function deliverLive(message: UnifiedMessage): void {
    if (bootstrappingHistory) {
      pendingLive.push(message);
    } else {
      deliver(message);
    }
  }

  function systemMessage(
    text: string,
    username: string,
    category: UnifiedMessage['category'],
  ): void {
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

  function handleRealtimeEvent(
    event: string,
    data: unknown,
  ): void {
    const raw = decodeKickPayload(data);

    switch (event) {
      case 'App\\Events\\ChatMessageEvent': {
        const message = buildKickMessage(raw);

        if (
          raw.type === 'celebration' ||
          raw.metadata?.celebration ||
          raw.metadata?.reward
        ) {
          message.redeem =
            raw.metadata?.reward?.title ??
            'celebration';
        }

        deliverLive(message);
        return;
      }

      case 'App\\Events\\RewardRedeemedEvent':
      case 'RewardRedeemedEvent': {
        const d = raw;

        opts.onMessage({
          platform: 'kick',
          id:
            d?.id != null
              ? String(d.id)
              : `redeem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          senderId:
            d?.user_id?.toString() ??
            d?.user?.id?.toString() ??
            '',
          username:
            d?.username ??
            d?.user?.username ??
            'Someone',
          color: '',
          badges: [],
          emotes: [],
          timestamp: kickTimestamp(
            d?.created_at ??
            d?.timestamp,
          ),
          kind: 'chat',
          text: d?.user_input
            ? `${d?.reward_title ?? d?.reward?.title ?? 'Reward'}: ${d.user_input}`
            : (
                d?.reward_title ??
                d?.reward?.title ??
                'redeemed a reward'
              ),
          redeem:
            d?.reward_title ??
            d?.reward?.title ??
            'reward',
        });

        return;
      }

      case 'App\\Events\\MessageDeletedEvent': {
        const d = raw;

        const id =
          d?.message?.id ??
          d?.message_id ??
          d?.id;

        if (id) {
          opts.onDelete({
            id: String(id),
          });
        }

        return;
      }

      case 'App\\Events\\UserBannedEvent': {
        const d = raw;

        const senderId =
          d?.user?.id?.toString() ??
          d?.user_id?.toString();

        const username =
          d?.user?.username ??
          d?.username;

        opts.onDelete({
          ...(senderId
            ? { senderId }
            : {}),
          ...(username
            ? { username }
            : {}),
        });

        return;
      }

      case 'App\\Events\\ChatroomClearEvent':
        opts.onDelete({});
        return;

      case 'App\\Events\\PinnedMessageCreatedEvent': {
        const d = raw;

        if (d?.message) {
          opts.onPin({
            message:
              buildKickMessage(
                d.message,
              ),
            pinnedBy:
              d?.pinnedBy?.username ??
              d?.pinned_by?.username,
          });
        }

        return;
      }

      case 'App\\Events\\PinnedMessageDeletedEvent':
        opts.onPin(null);
        return;

      case 'App\\Events\\SubscriptionEvent': {
        const d = raw;

        const months =
          Number(
            d?.months ??
            d?.duration ??
            0,
          );

        const username =
          d?.username ??
          d?.user?.username ??
          '';

        systemMessage(
          `${username} subscribed!${
            months > 1
              ? ` (${months} months)`
              : ''
          }`,
          username,
          'subscription',
        );

        return;
      }

      case 'App\\Events\\GiftedSubscriptionsEvent':
      case 'GiftedSubscriptionsEvent': {
        const d = raw;

        const count =
          Array.isArray(
            d?.gifted_usernames,
          )
            ? d.gifted_usernames.length
            : Array.isArray(d?.giftees)
              ? d.giftees.length
              : Number(
                  d?.count ??
                  1,
                );

        const username =
          d?.gifter_username ??
          d?.gifter?.username ??
          '';

        systemMessage(
          `${username} gifted ${count} subscription${
            count === 1 ? '' : 's'
          }!`,
          username,
          'gift',
        );

        return;
      }

      case 'App\\Events\\StreamHostEvent': {
        const d = raw;

        const username =
          d?.host_username ??
          d?.host?.username ??
          '';

        systemMessage(
          `${username} is hosting with ${
            d?.number_viewers ??
            d?.host?.viewers_count ??
            '?'
          } viewers!`,
          username,
          'raid',
        );

        return;
      }

      case 'KicksGifted':
      case 'App\\Events\\KicksGifted': {
        const d = raw;

        const sender =
          d?.sender?.username ??
          d?.username ??
          'Someone';

        const gift = d?.gift;

        if (!gift) return;

        systemMessage(
          `${sender} sent ${
            gift.name ??
            'a gift'
          } (${
            gift.amount ??
            '?'
          } Kicks)`,
          sender,
          'cheer',
        );

        return;
      }
    }
  }

  function connectRealtime(
    channel: KickChannel,
  ): void {
    if (stopped) return;

    const query =
      new URLSearchParams({
        channelId:
          String(channel.id),
        chatroomId:
          String(
            channel.chatroom.id,
          ),
      });

    const active =
      new EventSource(
        `/api/kick/realtime?${query.toString()}`,
      );

    es = active;

    active.onmessage = (messageEvent) => {
      if (
        stopped ||
        es !== active
      ) {
        return;
      }

      let envelope: any;

      try {
        envelope =
          JSON.parse(
            messageEvent.data,
          );
      } catch {
        return;
      }

      if (
        envelope?.type === 'status'
      ) {
        opts.onStatus(
          envelope.status,
          envelope.detail,
        );

        return;
      }

      if (
        envelope?.type !== 'event' ||
        typeof envelope.event !==
          'string'
      ) {
        return;
      }

      handleRealtimeEvent(
        envelope.event,
        envelope.data,
      );
    };

    active.onerror = () => {
      if (
        stopped ||
        es !== active
      ) {
        return;
      }

      /*
       * Do not close/recreate EventSource here. Native EventSource retry
       * preserves Last-Event-ID, allowing the server hub to replay only
       * events missed during the transport gap.
       */
      opts.onStatus(
        'connecting',
        'Kick chat reconnecting',
      );
    };
  }

  async function bootstrapHistory(
    channel: KickChannel,
  ): Promise<void> {
    historyAbort =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          historyAbort?.abort(),
        KICK_HISTORY_TIMEOUT_MS,
      );

    try {
      const history =
        await fetchKickHistory(
          channel,
          historyAbort.signal,
        );

      if (!stopped) {
        history.forEach(deliver);
      }
    } catch {
      /*
       * History is optional race closure. Live realtime traffic remains
       * authoritative.
       */
    } finally {
      clearTimeout(timeout);

      historyAbort = null;
      bootstrappingHistory = false;

      if (!stopped) {
        pendingLive
          .splice(0)
          .forEach(deliver);
      }
    }
  }

  async function start(): Promise<void> {
    if (stopped) return;

    opts.onStatus(
      'connecting',
    );

    const channel =
      await getKickChannel(
        opts.channel,
      );

    if (!channel) {
      opts.onStatus(
        'error',
        `Could not find Kick channel: "${opts.channel}"`,
      );

      return;
    }

    if (stopped) return;

    opts.onChannelInfo?.(
      channel,
    );

    connectRealtime(channel);

    await bootstrapHistory(
      channel,
    );
  }

  return {
    start() {
      if (
        stopped ||
        starting ||
        es
      ) {
        return;
      }

      starting = true;

      void start().finally(
        () => {
          starting = false;
        },
      );
    },

    stop() {
      if (stopped) return;

      stopped = true;

      historyAbort?.abort();
      historyAbort = null;

      const active = es;
      es = null;

      active?.close();

      pendingLive.length = 0;
    },
  };
}
