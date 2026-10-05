/* TikTok Live connector — thin EventSource client over /api/tiktok/chat SSE.
 * The persistent upstream lives server-side (tiktok-live-connector), one per
 * channel, while browser overlays subscribe to that shared feed.
 */
import type { Connector, ConnectorCallbacks, UnifiedMessage } from '../types';
import { isMessageFromCurrentOverlaySession } from '../startupMessageBaseline';

const TIKTOK_SEEN_MAX = 512;
const RECONNECT_START_MS = 5_000;
const RECONNECT_MAX_MS = 120_000;

export interface TikTokConnectorOpts extends ConnectorCallbacks {
  channel: string;
}

export function createTikTokConnector(opts: TikTokConnectorOpts): Connector {
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let reconnectDelay = RECONNECT_START_MS;
  const startedAt = Date.now();
  const seen = new Set<string>();
  const seenOrder: string[] = [];

  function remember(id: unknown): boolean {
    if (id === null || id === undefined || id === '') return true;
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    seenOrder.push(key);
    while (seenOrder.length > TIKTOK_SEEN_MAX) {
      const oldest = seenOrder.shift();
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  }

  function toMessage(d: any, kind: 'chat' | 'system'): UnifiedMessage {
    const badges: UnifiedMessage['badges'] = [];
    for (const url of d.badgeUrls ?? []) badges.push({ type: 'tiktok', url });
    if (d.moderator) badges.push({ type: 'moderator' });
    if (d.subscriber && !(d.badgeUrls?.length)) badges.push({ type: 'subscriber' });

    let text: string = d.text ?? '';
    const emotes: UnifiedMessage['emotes'] = [];
    if (d.giftIcon) {
      const token = 'gift';
      const begin = Array.from(text).length + 1;
      emotes.push({ begin, end: begin + token.length, text: token, url: d.giftIcon });
      text = `${text} ${token}`;
    }
    return {
      platform: 'tiktok',
      id: d.id === null || d.id === undefined ? '' : String(d.id),
      senderId: d.senderId === null || d.senderId === undefined ? '' : String(d.senderId),
      ...(typeof d.senderUsername === 'string' && d.senderUsername.trim()
        ? { senderUsername: d.senderUsername }
        : {}),
      username: d.username ?? '',
      color: '',
      badges,
      text,
      emotes,
      timestamp: d.timestamp ?? Date.now(),
      kind,
      category: d.type === 'gift' ? 'gift'
        : d.type === 'sub' ? 'subscription'
        : (d.type === 'follow' || d.type === 'share') ? 'follow'
        : undefined,
      avatar: d.avatar,
    };
  }

  function emitMessage(d: any, kind: 'chat' | 'system'): void {
    if (!remember(d.id)) return;
    const message = toMessage(d, kind);
    /* The SSE endpoint already filters startup replay by `since`, but retain the
     * browser-side cutoff as a defense against stale proxies or older servers. */
    if (!isMessageFromCurrentOverlaySession(message.timestamp, startedAt)) return;
    opts.onMessage(message);
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const wait = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, wait);
  }

  function connect() {
    if (stopped) return;
    opts.onStatus('connecting');
    const query = new URLSearchParams({
      user: opts.channel,
      since: String(startedAt),
    });
    es = new EventSource(`/api/tiktok/chat?${query.toString()}`);
    es.onmessage = (e) => {
      let d: any;
      try { d = JSON.parse(e.data); } catch { return; }
      switch (d.type) {
        case 'status':
          if (d.status === 'connected') reconnectDelay = RECONNECT_START_MS;
          opts.onStatus(d.status, d.detail);
          break;
        case 'chat':   emitMessage(d, 'chat'); break;
        case 'gift':
        case 'sub':
        case 'follow':
        case 'share':  emitMessage(d, 'system'); break;
        case 'delete': opts.onDelete(d.senderId ? { senderId: d.senderId } : { id: d.id }); break;
        case 'pin':    opts.onPin({ message: toMessage(d, 'chat') }); break;
        case 'unpin':  opts.onPin(null); break;
      }
    };
    es.onerror = () => {
      es?.close();
      es = null;
      scheduleReconnect();
    };
  }

  return {
    start() { connect(); },
    stop() {
      stopped = true;
      es?.close();
      es = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    },
  };
}
