/* TikTok connection hub — ONE upstream TikTokLiveConnection per unique
 * channel, fanned out to every SSE subscriber (unified-chat-lite's hub
 * pattern). Load scales O(unique channels), not O(viewers).
 *
 * - subscribe(user, send): attach a subscriber; connection created on
 *   first subscriber, replayed a small recent-event buffer on attach
 * - 30s linger after the last subscriber detaches before disconnecting,
 *   so OBS refreshes / scene switches don't re-sign against Euler Stream
 * - module-level singleton (survives across API route invocations in the
 *   long-lived `next start` process)
 */
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

type Send = (data: object) => void;

interface Channel {
  conn: TikTokLiveConnection;
  subs: Set<Send>;
  recent: object[];          // last N events for late joiners
  status: object | null;     // last status event
  lingerTimer: ReturnType<typeof setTimeout> | null;
  backoff: number;
  closed: boolean;
  seenIds: Set<string>;
}

const channels = new Map<string, Channel>();
const LINGER_MS = 30_000;
const RECENT_MAX = 25;

function broadcast(ch: Channel, data: object, buffer = true) {
  if (buffer) {
    ch.recent.push(data);
    if (ch.recent.length > RECENT_MAX) ch.recent.shift();
  }
  for (const send of ch.subs) {
    try { send(data); } catch { /* dead subscriber; removed on close */ }
  }
}

function setStatus(ch: Channel, status: object) {
  ch.status = status;
  broadcast(ch, status, false);
}

function extractBadges(user: any): string[] {
  const urls: string[] = [];
  const push = (u?: string) => { if (u && !urls.includes(u)) urls.push(u); };
  for (const b of user?.badgeList ?? []) {
    push(b?.image?.image?.urlList?.[0] ?? b?.combine?.icon?.urlList?.[0]);
  }
  if (!urls.length) {
    for (const img of user?.badgeImageList ?? []) push(img?.urlList?.[0]);
  }
  return urls;
}

function createChannel(user: string): Channel {
  const conn = new TikTokLiveConnection(`@${user}`, {
    ...(process.env.TIKTOK_SIGN_API_KEY ? { signApiKey: process.env.TIKTOK_SIGN_API_KEY } : {}),
  });
  const ch: Channel = {
    conn, subs: new Set(), recent: [], status: null,
    lingerTimer: null, backoff: 5000, closed: false, seenIds: new Set(),
  };

  conn.on(ControlEvent.CONNECTED, () => {
    ch.backoff = 5000;
    setStatus(ch, { type: 'status', status: 'connected' });
  });
  conn.on(ControlEvent.DISCONNECTED, () => {
    if (!ch.closed && ch.subs.size) scheduleReconnect();
  });
  conn.on(WebcastEvent.STREAM_END, () => {
    setStatus(ch, { type: 'status', status: 'offline', detail: 'Stream ended' });
  });

  conn.on(WebcastEvent.CHAT, (data: any) => {
    const id = data.common?.msgId?.toString() ?? data.msgId?.toString()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (ch.seenIds.has(id)) return;
    ch.seenIds.add(id);
    if (ch.seenIds.size > 2000) { const first = ch.seenIds.values().next().value!; ch.seenIds.delete(first); }
    broadcast(ch, {
      type: 'chat',
      id,
      senderId: data.user?.userId?.toString() ?? data.user?.id?.toString() ?? '',
      username: data.user?.nickname || data.user?.uniqueId || 'viewer',
      text: data.content ?? data.comment ?? '',
      timestamp: Date.now(),
      moderator: !!(data.user?.isModerator ?? data.userIdentity?.isModeratorOfAnchor),
      subscriber: !!(data.user?.isSubscriber ?? data.userIdentity?.isSubscriberOfAnchor),
      badgeUrls: extractBadges(data.user),
      avatar: data.user?.avatarThumb?.urlList?.[0] ?? data.user?.avatarMedium?.urlList?.[0],
    });
  });

  conn.on(WebcastEvent.IM_DELETE, (data: any) => {
    for (const msgId of data.deleteMsgIdsList ?? []) broadcast(ch, { type: 'delete', id: msgId?.toString() }, false);
    for (const userId of data.deleteUserIdsList ?? []) broadcast(ch, { type: 'delete', senderId: userId?.toString() }, false);
  });

  conn.on(WebcastEvent.GIFT, (data: any) => {
    if (data.giftType === 1 && data.repeatEnd === false) return;
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    const count = data.repeatCount ?? 1;
    const name = data.giftDetails?.giftName ?? data.giftName ?? 'a gift';
    const diamonds = (data.giftDetails?.diamondCount ?? data.diamondCount ?? 0) * Math.max(count, 1);
    broadcast(ch, {
      type: 'gift',
      id: `gift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username: author,
      text: `${author} sent ${count}x ${name}!${diamonds ? ` (${diamonds} 💎)` : ''}`,
      giftIcon: data.giftDetails?.giftImage?.giftPictureUrl
        ?? data.giftDetails?.icon?.urlList?.[0]
        ?? data.giftImage?.giftPictureUrl,
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.SUB_NOTIFY, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    broadcast(ch, { type: 'sub', id: `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`, username: author, text: `${author} subscribed!`, timestamp: Date.now() });
  });
  conn.on(WebcastEvent.FOLLOW, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    broadcast(ch, { type: 'follow', id: `follow-${Date.now()}-${Math.random().toString(36).slice(2)}`, username: author, text: `${author} followed!`, timestamp: Date.now() });
  });
  conn.on(WebcastEvent.SHARE, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    broadcast(ch, { type: 'share', id: `share-${Date.now()}-${Math.random().toString(36).slice(2)}`, username: author, text: `${author} shared the stream!`, timestamp: Date.now() });
  });

  conn.on(WebcastEvent.ROOM_PIN, (data: any) => {
    const pinned = data.pinnedMessage ?? data.message ?? data;
    const u = pinned?.user ?? data.user;
    const text = pinned?.content ?? pinned?.comment ?? '';
    if (!text) { broadcast(ch, { type: 'unpin' }); return; }
    broadcast(ch, {
      type: 'pin',
      id: pinned?.common?.msgId ?? `pin-${Date.now()}`,
      senderId: u?.userId?.toString() ?? '',
      username: u?.nickname || u?.uniqueId || 'viewer',
      text,
      timestamp: Date.now(),
    });
  });

  function scheduleReconnect() {
    if (ch.closed) return;
    setStatus(ch, { type: 'status', status: 'connecting' });
    setTimeout(() => {
      if (ch.closed || !ch.subs.size) return;
      conn.connect().catch((err: any) => {
        const name = err?.name ?? '';
        if (name === 'UserOfflineError') {
          setStatus(ch, { type: 'status', status: 'offline', detail: 'User is not live' });
          setTimeout(scheduleReconnect, Math.max(60_000 - ch.backoff, 10_000));
        } else if (name === 'UserNotFoundError') {
          setStatus(ch, { type: 'status', status: 'error', detail: `TikTok user @${user} not found` });
          destroyChannel(user);
        } else {
          setStatus(ch, { type: 'status', status: 'error', detail: err?.message ?? 'connection failed' });
          ch.backoff = Math.min(ch.backoff * 2, 120_000);
          scheduleReconnect();
        }
      });
    }, ch.backoff);
  }

  conn.connect().catch((err: any) => {
    const name = err?.name ?? '';
    if (name === 'UserOfflineError') {
      setStatus(ch, { type: 'status', status: 'offline', detail: 'User is not live' });
      setTimeout(scheduleReconnect, 60_000);
    } else if (name === 'UserNotFoundError') {
      setStatus(ch, { type: 'status', status: 'error', detail: `TikTok user @${user} not found` });
      destroyChannel(user);
    } else {
      setStatus(ch, { type: 'status', status: 'error', detail: err?.message ?? 'connection failed' });
      scheduleReconnect();
    }
  });

  return ch;
}

function destroyChannel(user: string) {
  const ch = channels.get(user);
  if (!ch) return;
  ch.closed = true;
  if (ch.lingerTimer) clearTimeout(ch.lingerTimer);
  try { ch.conn.disconnect(); } catch { /* already down */ }
  channels.delete(user);
}

export function subscribe(user: string, send: Send): () => void {
  let ch = channels.get(user);
  if (!ch) {
    ch = createChannel(user);
    channels.set(user, ch);
  } else if (ch.lingerTimer) {
    // a viewer came back within the linger window — keep the connection
    clearTimeout(ch.lingerTimer);
    ch.lingerTimer = null;
  }
  ch.subs.add(send);

  // replay current status + recent events so late joiners aren't blank
  if (ch.status) { try { send(ch.status); } catch { /* noop */ } }
  else { try { send({ type: 'status', status: 'connecting' }); } catch { /* noop */ } }
  for (const ev of ch.recent) { try { send(ev); } catch { break; } }

  return () => {
    const c = channels.get(user);
    if (!c) return;
    c.subs.delete(send);
    if (c.subs.size === 0 && !c.lingerTimer) {
      c.lingerTimer = setTimeout(() => destroyChannel(user), LINGER_MS);
    }
  };
}

/** current hub state — /api/tiktok/stats introspection */
export function hubStats() {
  return [...channels.entries()].map(([user, ch]) => ({
    user, subscribers: ch.subs.size, lingering: !!ch.lingerTimer,
  }));
}
