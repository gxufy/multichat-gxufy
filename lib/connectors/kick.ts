/* Kick connector — extracted from pages/index.tsx.
 *
 * Same behavior as before: Pusher ws (app key 32cbd69e4b950bf97679, us2),
 * chatrooms.{id}.v2 events, aggressive reconnect + watchdog.
 * Emits UnifiedMessage instead of React nodes; rendering (incl. 7TV)
 * happens in lib/render.tsx.
 */
import Pusher from 'pusher-js';
import { getKickChannel, type KickChannel } from '../kick';
import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';

const KICK_EMOTE_RE = /\[(?:emote|emoji):(\w+):([^\]]*)\]/g;

/** Replace [emote:id:name] tokens with `name`, recording char offsets (chatis/unified-chat-lite scheme). */
export function parseKickEmotes(content: string): { text: string; emotes: UnifiedEmote[] } {
  const emotes: UnifiedEmote[] = [];
  let text = '';
  let last = 0;
  for (const m of content.matchAll(KICK_EMOTE_RE)) {
    text += content.slice(last, m.index);
    const name = m[2] || 'emote';
    emotes.push({
      begin: [...text].length,
      end: [...text].length + [...name].length,
      text: name,
      url: `https://files.kick.com/emotes/${m[1]}/fullsize`,
    });
    text += name;
    last = m.index! + m[0].length;
  }
  text += content.slice(last);
  return { text, emotes };
}

function buildBadges(rawMsg: any): UnifiedBadge[] {
  const out: UnifiedBadge[] = [];
  for (const b of rawMsg.sender?.identity?.badges_v2 ?? []) {
    if (b.image_url && b.selected === true) out.push({ type: b.name ?? 'v2', url: b.image_url });
  }
  for (const b of rawMsg.sender?.identity?.badges ?? []) {
    out.push({ type: b.type, count: b.count ?? b.rank });
  }
  return out;
}

export function buildKickMessage(rawMsg: any): UnifiedMessage {
  const { text, emotes } = parseKickEmotes(rawMsg.content ?? '');
  return {
    platform: 'kick',
    id: rawMsg.id,
    senderId: rawMsg.sender?.id?.toString() ?? '',
    username: rawMsg.sender?.username ?? '',
    color: rawMsg.sender?.identity?.color || '#ffffff',
    badges: buildBadges(rawMsg),
    text,
    emotes,
    timestamp: Date.now(),
    kind: 'chat',
  };
}

export interface KickConnectorOpts extends ConnectorCallbacks {
  channel: string;
  onChannelInfo?(ch: KickChannel): void;
}

export function createKickConnector(opts: KickConnectorOpts): Connector {
  let pusher: Pusher | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function start() {
    opts.onStatus('connecting');
    const channel = await getKickChannel(opts.channel);
    if (!channel) {
      opts.onStatus('error', `Could not find Kick channel: "${opts.channel}"`);
      return;
    }
    if (stopped) return;
    opts.onChannelInfo?.(channel);

    pusher = new Pusher('32cbd69e4b950bf97679', {
      cluster: 'us2',
      disableStats: true,
      activityTimeout: 20000,
      pongTimeout: 8000,
    });
    const chatroomName = `chatrooms.${channel.chatroom.id}.v2`;
    const channelId = channel.id;

    function bindChannel() {
      const ch = pusher!.subscribe(chatroomName);
      ch.bind('App\\Events\\ChatMessageEvent', (data: any) => {
        opts.onMessage(buildKickMessage(data));
      });
      ch.bind('App\\Events\\MessageDeletedEvent', (data: any) => {
        opts.onDelete({ id: data.message?.id });
      });
      ch.bind('App\\Events\\UserBannedEvent', (data: any) => {
        opts.onDelete({ username: data.user?.username });
      });
      ch.bind('App\\Events\\ChatroomClearEvent', () => {
        opts.onDelete({});
      });
      ch.bind('App\\Events\\PinnedMessageCreatedEvent', (data: any) => {
        // Kick sometimes double-encodes payloads as JSON strings (StreamNook kick.rs:1145)
        const d = typeof data === 'string' ? JSON.parse(data) : data;
        if (d?.message) {
          opts.onPin({
            message: buildKickMessage(d.message),
            pinnedBy: d.pinnedBy?.username,
          });
        }
      });
      ch.bind('App\\Events\\PinnedMessageDeletedEvent', () => opts.onPin(null));

      /* System events → event cards (unified-chat-lite kick.py names) */
      function systemMsg(text: string, username: string, category: UnifiedMessage['category']) {
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
      ch.bind('App\\Events\\SubscriptionEvent', (data: any) => {
        const months = data.months ?? 0;
        systemMsg(`${data.username} subscribed!${months > 1 ? ` (${months} months)` : ''}`, data.username ?? '', 'subscription');
      });
      ch.bind('App\\Events\\GiftedSubscriptionsEvent', (data: any) => {
        const count = data.gifted_usernames?.length ?? 1;
        systemMsg(`${data.gifter_username} gifted ${count} subscription${count > 1 ? 's' : ''}!`, data.gifter_username ?? '', 'gift');
      });
      ch.bind('App\\Events\\StreamHostEvent', (data: any) => {
        systemMsg(`${data.host_username} is hosting with ${data.number_viewers ?? '?'} viewers!`, data.host_username ?? '', 'raid');
      });

      /* Kicks gifts ride the channel.{id} topic (unified-chat-lite kick.py) */
      const kicksHandler = (data: any) => {
        const d = typeof data === 'string' ? JSON.parse(data) : data;
        const sender = d?.sender?.username ?? 'Someone';
        const gift = d?.gift;
        if (!gift) return;
        systemMsg(`${sender} sent ${gift.name ?? 'a gift'} (${gift.amount ?? '?'} Kicks)`, sender, 'cheer');
      };
      pusher!.subscribe(`channel.${channelId}`).bind('KicksGifted', kicksHandler);
      pusher!.subscribe(`channel_${channelId}`).bind('KicksGifted', kicksHandler);
    }

    bindChannel();

    pusher.connection.bind('connected', () => {
      opts.onStatus('connected');
      if (!pusher!.channel(chatroomName)) bindChannel();
    });
    pusher.connection.bind('state_change', ({ current }: { current: string }) => {
      if (current === 'disconnected' && !stopped) {
        setTimeout(() => pusher?.connect(), 2000);
      }
    });
    watchdog = setInterval(() => {
      const state = pusher?.connection.state;
      if (state === 'unavailable' || state === 'failed') {
        pusher?.disconnect();
        setTimeout(() => pusher?.connect(), 2000);
      }
    }, 10000);
  }

  return {
    start() { start(); },
    stop() {
      stopped = true;
      if (watchdog) clearInterval(watchdog);
      pusher?.disconnect();
    },
  };
}
