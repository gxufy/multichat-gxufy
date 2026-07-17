/* GET /api/tiktok/chat?user=<uniqueId> — Server-Sent Events stream.
 *
 * Holds a persistent TikTokLiveConnection (tiktok-live-connector, signed
 * via Euler Stream's free tier — same as unified-chat-lite's TikTokLive)
 * per client and forwards events as SSE. Requires a long-lived Node
 * process (`next start` / `next dev`) — not serverless-compatible.
 *
 * SSE event data: { type: 'chat'|'gift'|'sub'|'pin'|'unpin'|'status', ... }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req.query.user as string || '').trim().replace(/^@/, '');
  if (!user || !/^[A-Za-z0-9._]{1,50}$/.test(user)) {
    return res.status(400).json({ error: 'invalid user' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (data: object) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };
  send({ type: 'status', status: 'connecting' });

  // Optional Euler Stream API key (TIKTOK_SIGN_API_KEY) raises the free
  // signing tier's rate limits — works without one for casual use.
  const conn = new TikTokLiveConnection(`@${user}`, {
    ...(process.env.TIKTOK_SIGN_API_KEY ? { signApiKey: process.env.TIKTOK_SIGN_API_KEY } : {}),
  });
  let closed = false;
  // reconnect with backoff while stream is live-ish; recheck offline every 60s
  let backoff = 5000;

  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* noop */ }
  }, 15000);

  conn.on(ControlEvent.CONNECTED, () => {
    backoff = 5000;
    send({ type: 'status', status: 'connected' });
  });
  conn.on(ControlEvent.DISCONNECTED, () => {
    if (!closed) scheduleReconnect();
  });
  conn.on(WebcastEvent.STREAM_END, () => {
    send({ type: 'status', status: 'offline', detail: 'Stream ended' });
  });

  /* badgeList → displayable badge image URLs — StreamNook tiktok.rs
   * parse_badges: image badge (.image.image.urlList) first, else combined
   * badge icon (.combine.icon.urlList); dedup by URL; fall back to the
   * plain badgeImageList (user_badges) when badgeList yields nothing. */
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

  // v2 proto: text lives in `content` (older versions used `comment`);
  // the initial sign-response batch can replay messages → dedup by msgId
  const seenIds = new Set<string>();
  conn.on(WebcastEvent.CHAT, (data: any) => {
    const id = data.common?.msgId?.toString() ?? data.msgId?.toString()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (seenIds.has(id)) return;
    seenIds.add(id);
    if (seenIds.size > 2000) { const first = seenIds.values().next().value!; seenIds.delete(first); }
    send({
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

  // Deleted messages / users (StreamNook emit_deletions: ImDelete)
  conn.on(WebcastEvent.IM_DELETE, (data: any) => {
    for (const msgId of data.deleteMsgIdsList ?? []) {
      send({ type: 'delete', id: msgId?.toString() });
    }
    for (const userId of data.deleteUserIdsList ?? []) {
      send({ type: 'delete', senderId: userId?.toString() });
    }
  });

  conn.on(WebcastEvent.GIFT, (data: any) => {
    // StreamNook is_streak_over(): combo gifts (giftType 1) fire per tap —
    // only emit when the streak ends; diamonds = diamond_count × repeats
    if (data.giftType === 1 && data.repeatEnd === false) return;
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    const count = data.repeatCount ?? 1;
    const name = data.giftDetails?.giftName ?? data.giftName ?? 'a gift';
    const diamonds = (data.giftDetails?.diamondCount ?? data.diamondCount ?? 0) * Math.max(count, 1);
    send({
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
    send({
      type: 'sub',
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username: author,
      text: `${author} subscribed!`,
      timestamp: Date.now(),
    });
  });

  // Follows + shares (StreamNook tiktok.rs handle_event Social actions)
  conn.on(WebcastEvent.FOLLOW, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    send({
      type: 'follow',
      id: `follow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username: author,
      text: `${author} followed!`,
      timestamp: Date.now(),
    });
  });
  conn.on(WebcastEvent.SHARE, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    send({
      type: 'share',
      id: `share-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      username: author,
      text: `${author} shared the stream!`,
      timestamp: Date.now(),
    });
  });

  // WebcastRoomPinMessage — pinned comment (StreamNook's vendored proto has
  // this unused; tiktok-live-connector exposes it as ROOM_PIN)
  conn.on(WebcastEvent.ROOM_PIN, (data: any) => {
    const pinned = data.pinnedMessage ?? data.message ?? data;
    const u = pinned?.user ?? data.user;
    const text = pinned?.content ?? pinned?.comment ?? '';
    if (!text) { send({ type: 'unpin' }); return; }
    send({
      type: 'pin',
      id: pinned?.common?.msgId ?? `pin-${Date.now()}`,
      senderId: u?.userId?.toString() ?? '',
      username: u?.nickname || u?.uniqueId || 'viewer',
      text,
      timestamp: Date.now(),
    });
  });

  function scheduleReconnect() {
    if (closed) return;
    send({ type: 'status', status: 'connecting' });
    setTimeout(() => {
      if (closed) return;
      conn.connect().catch((err: any) => {
        const name = err?.name ?? '';
        if (name === 'UserOfflineError') {
          send({ type: 'status', status: 'offline', detail: 'User is not live' });
          setTimeout(scheduleReconnect, 60_000 - backoff); // net ~60s recheck
        } else if (name === 'UserNotFoundError') {
          send({ type: 'status', status: 'error', detail: `TikTok user @${user} not found` });
          cleanup();
        } else {
          send({ type: 'status', status: 'error', detail: err?.message ?? 'connection failed' });
          backoff = Math.min(backoff * 2, 120_000);
          scheduleReconnect();
        }
      });
    }, backoff);
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    try { conn.disconnect(); } catch { /* already down */ }
    try { res.end(); } catch { /* already closed */ }
  }

  req.on('close', cleanup);

  conn.connect().catch((err: any) => {
    const name = err?.name ?? '';
    if (name === 'UserOfflineError') {
      send({ type: 'status', status: 'offline', detail: 'User is not live' });
      setTimeout(scheduleReconnect, 60_000);
    } else if (name === 'UserNotFoundError') {
      send({ type: 'status', status: 'error', detail: `TikTok user @${user} not found` });
      cleanup();
    } else {
      send({ type: 'status', status: 'error', detail: err?.message ?? 'connection failed' });
      scheduleReconnect();
    }
  });
}
