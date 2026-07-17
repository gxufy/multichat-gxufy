/* TikTok Live connector — thin EventSource client over /api/tiktok/chat SSE.
 * The persistent websocket lives server-side (tiktok-live-connector).
 * TikTok has no colors/emotes; moderator/subscriber flags become badges.
 */
import type { Connector, ConnectorCallbacks, UnifiedMessage } from '../types';

export interface TikTokConnectorOpts extends ConnectorCallbacks {
  channel: string;
}

export function createTikTokConnector(opts: TikTokConnectorOpts): Connector {
  let es: EventSource | null = null;
  let stopped = false;

  function toMessage(d: any, kind: 'chat' | 'system'): UnifiedMessage {
    const badges: UnifiedMessage['badges'] = [];
    // real TikTok badge art (top gifter, sub, fan-club) from badgeList
    for (const url of d.badgeUrls ?? []) badges.push({ type: 'tiktok', url });
    if (d.moderator) badges.push({ type: 'moderator' });
    if (d.subscriber && !(d.badgeUrls?.length)) badges.push({ type: 'subscriber' });
    // gift events lead with the gift's art inline (StreamNook overlay)
    let text: string = d.text ?? '';
    const emotes: UnifiedMessage['emotes'] = [];
    if (d.giftIcon) {
      const token = 'gift';
      emotes.push({ begin: [...text].length + 1, end: [...text].length + 1 + token.length, text: token, url: d.giftIcon });
      text = `${text} ${token}`;
    }
    return {
      platform: 'tiktok',
      id: d.id,
      senderId: d.senderId ?? '',
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

  function connect() {
    if (stopped) return;
    opts.onStatus('connecting');
    es = new EventSource(`/api/tiktok/chat?user=${encodeURIComponent(opts.channel)}`);
    es.onmessage = (e) => {
      let d: any;
      try { d = JSON.parse(e.data); } catch { return; }
      switch (d.type) {
        case 'status': opts.onStatus(d.status, d.detail); break;
        case 'chat':   opts.onMessage(toMessage(d, 'chat')); break;
        case 'gift':
        case 'sub':
        case 'follow':
        case 'share':  opts.onMessage(toMessage(d, 'system')); break;
        case 'delete': opts.onDelete(d.senderId ? { senderId: d.senderId } : { id: d.id }); break;
        case 'pin':    opts.onPin({ message: toMessage(d, 'chat') }); break;
        case 'unpin':  opts.onPin(null); break;
      }
    };
    es.onerror = () => {
      es?.close();
      if (!stopped) setTimeout(connect, 5000); // SSE drop → reconnect
    };
  }

  return {
    start() { connect(); },
    stop() {
      stopped = true;
      es?.close();
    },
  };
}
