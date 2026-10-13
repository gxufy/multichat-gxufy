import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { normalizeChatChannel } from './channelValidation';
import { SharedSseCapacityError } from './server/sharedSseAdmission';

type HubData = Record<string, any>;
type Send = (data: HubData, serialized: string) => void;

type BufferedEvent = {
  data: HubData;
  serialized: string;
};

interface Channel {
  conn: TikTokLiveConnection;
  subs: Set<Send>;
  recent: BufferedEvent[];
  status: BufferedEvent | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  backoff: number;
  closed: boolean;
  connectInFlight: boolean;
  needsReconnect: boolean;
  seenIds: Set<string>;
  startConnection: () => void;
}

const channels = new Map<string, Channel>();
export const TIKTOK_HUB_LINGER_MS = 30_000;
export const TIKTOK_HUB_MAX_CHANNELS = 32;
export const TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL = 32;
export const TIKTOK_HUB_MAX_SUBSCRIBERS = 256;
export const TIKTOK_RECENT_MAX = 100;
export const TIKTOK_PUBLIC_CONNECTION_ERROR_DETAIL = 'TikTok connection failed';
export const TIKTOK_TARGET_IDC_COOKIE = 'tt-target-idc';
const TIKTOK_TIMESTAMP_EARLIEST_MS = Date.UTC(2000, 0, 1);
const TIKTOK_TIMESTAMP_FUTURE_TOLERANCE_MS = 5 * 60_000;

const metrics = {
  broadcasts: 0,
  subscriberDeliveries: 0,
  reconnects: 0,
  upstreamErrors: 0,
};

function subscriberCount(): number {
  let subscribers = 0;
  for (const ch of channels.values()) subscribers += ch.subs.size;
  return subscribers;
}

function connectErrorName(error: unknown): string {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return '';
  try {
    const name = Reflect.get(error, 'name');
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

function serialize(data: HubData): string | null {
  try { return JSON.stringify(data); }
  catch { return null; }
}

function broadcast(ch: Channel, data: HubData, buffer = true) {
  const serialized = serialize(data);
  if (!serialized) return;
  metrics.broadcasts += 1;
  if (buffer) {
    ch.recent.push({ data, serialized });
    while (ch.recent.length > TIKTOK_RECENT_MAX) ch.recent.shift();
  }
  for (const send of ch.subs) {
    try {
      send(data, serialized);
      metrics.subscriberDeliveries += 1;
    } catch {
      // The SSE request-close handler removes dead subscribers.
    }
  }
}

function setStatus(ch: Channel, status: HubData) {
  const serialized = serialize(status);
  if (!serialized) return;
  ch.status = { data: status, serialized };
  for (const send of ch.subs) {
    try {
      send(status, serialized);
      metrics.subscriberDeliveries += 1;
    } catch {
      // The SSE request-close handler removes dead subscribers.
    }
  }
}

export function tikTokBufferedEventMatchesDelete(
  event: HubData,
  deletion: { id?: string; senderId?: string },
): boolean {
  if (deletion.id && event.id !== undefined && String(event.id) === deletion.id) return true;
  if (deletion.senderId && event.senderId !== undefined && String(event.senderId) === deletion.senderId) return true;
  return false;
}

function applyDeleteToRecovery(ch: Channel, deletion: { id?: string; senderId?: string }) {
  ch.recent = ch.recent.filter((entry) => !tikTokBufferedEventMatchesDelete(entry.data, deletion));
  /* Keep the moderation action itself in the recovery window. If an OBS browser
   * already rendered the row and its SSE connection drops exactly while TikTok
   * deletes it, the reconnect must receive the tombstone as well as avoid
   * replaying the deleted row. The timestamp lets a genuinely new browser source
   * skip old tombstones through the existing `since=` boundary. */
  broadcast(ch, { type: 'delete', ...deletion, timestamp: Date.now() }, true);
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

/**
 * TikTok's current protobuf exposes common.createTime as Unix milliseconds, but
 * older/alternate payloads have surfaced Unix seconds. Accept either only when
 * it resolves to a plausible, safe epoch value; receive time remains the
 * fail-safe for absent, malformed, or unbounded input.
 */
export function normalizeTikTokMessageTimestamp(
  value: unknown,
  receivedAt = Date.now(),
): number {
  let raw: number;
  if (typeof value === 'number') {
    raw = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    raw = Number(value.trim());
  } else {
    return receivedAt;
  }
  if (!Number.isSafeInteger(raw) || raw <= 0) return receivedAt;

  const latest = Math.min(8_640_000_000_000_000, receivedAt + TIKTOK_TIMESTAMP_FUTURE_TOLERANCE_MS);
  const candidates = [raw, raw * 1_000];
  for (const timestamp of candidates) {
    if (
      Number.isSafeInteger(timestamp)
      && timestamp >= TIKTOK_TIMESTAMP_EARLIEST_MS
      && timestamp <= latest
    ) return timestamp;
  }
  return receivedAt;
}

function senderIdentity(user: any, fallback: string) {
  const uniqueId = typeof user?.uniqueId === 'string' && user.uniqueId.trim()
    ? user.uniqueId
    : undefined;
  return {
    senderId: user?.userId?.toString() ?? user?.id?.toString() ?? '',
    ...(uniqueId ? { senderUsername: uniqueId } : {}),
    username: user?.nickname || user?.uniqueId || fallback,
  };
}

export function tikTokNativeMessageId(data: any): string | null {
  const value = data?.common?.msgId ?? data?.msgId;
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  return id || null;
}

/**
 * tiktok-live-connector currently seeds every anonymous web client with a
 * hard-coded US datacenter cookie. That can cause a 403 when this server is in
 * another region. Remove only that library default before the first request;
 * every other cookie/header remains available to the SDK.
 */
export function removeTikTokTargetIdcCookie(webClient: {
  clientHeaders: Record<string, string>;
  cookieJar: { store: Record<string, string> };
}): void {
  const cookieHeader = Object.keys(webClient.clientHeaders)
    .find((name) => name.toLowerCase() === 'cookie');
  if (cookieHeader) {
    const retained = webClient.clientHeaders[cookieHeader]
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part.split('=', 1)[0] !== TIKTOK_TARGET_IDC_COOKIE);
    if (retained.length) webClient.clientHeaders[cookieHeader] = retained.join('; ');
    else delete webClient.clientHeaders[cookieHeader];
  }
  delete webClient.cookieJar.store[TIKTOK_TARGET_IDC_COOKIE];
}

function createChannel(user: string): Channel {
  const conn = new TikTokLiveConnection(`@${user}`, {
    ...(process.env.TIKTOK_SIGN_API_KEY ? { signApiKey: process.env.TIKTOK_SIGN_API_KEY } : {}),
  });
  removeTikTokTargetIdcCookie(conn.webClient);
  const ch: Channel = {
    conn, subs: new Set(), recent: [], status: null,
    lingerTimer: null, reconnectTimer: null, backoff: 5000, closed: false,
    connectInFlight: false, needsReconnect: false, seenIds: new Set(),
    startConnection: () => {},
  };

  conn.on(ControlEvent.CONNECTED, () => {
    if (ch.reconnectTimer) {
      clearTimeout(ch.reconnectTimer);
      ch.reconnectTimer = null;
    }
    ch.backoff = 5000;
    ch.needsReconnect = false;
    setStatus(ch, { type: 'status', status: 'connected' });
  });
  conn.on(ControlEvent.DISCONNECTED, () => {
    ch.needsReconnect = true;
    if (!ch.closed && ch.subs.size) {
      if (scheduleReconnect()) metrics.reconnects += 1;
    }
  });
  conn.on(WebcastEvent.STREAM_END, () => {
    setStatus(ch, { type: 'status', status: 'offline', detail: 'Stream ended' });
  });

  conn.on(WebcastEvent.CHAT, (data: any) => {
    const receivedAt = Date.now();
    const id = tikTokNativeMessageId(data)
      ?? `${receivedAt}-${Math.random().toString(36).slice(2)}`;
    if (ch.seenIds.has(id)) return;
    ch.seenIds.add(id);
    if (ch.seenIds.size > 2000) {
      const first = ch.seenIds.values().next().value;
      if (first) ch.seenIds.delete(first);
    }
    broadcast(ch, {
      type: 'chat',
      id,
      ...senderIdentity(data.user, 'viewer'),
      text: data.content ?? data.comment ?? '',
      timestamp: normalizeTikTokMessageTimestamp(data.common?.createTime, receivedAt),
      moderator: !!(data.user?.isModerator ?? data.userIdentity?.isModeratorOfAnchor),
      subscriber: !!(data.user?.isSubscriber ?? data.userIdentity?.isSubscriberOfAnchor),
      badgeUrls: extractBadges(data.user),
      avatar: data.user?.avatarThumb?.urlList?.[0] ?? data.user?.avatarMedium?.urlList?.[0],
    });
  });

  conn.on(WebcastEvent.IM_DELETE, (data: any) => {
    for (const msgId of data.deleteMsgIdsList ?? []) {
      const deletion = { id: msgId?.toString() };
      if (!deletion.id) continue;
      applyDeleteToRecovery(ch, deletion);
    }
    for (const userId of data.deleteUserIdsList ?? []) {
      const deletion = { senderId: userId?.toString() };
      if (!deletion.senderId) continue;
      applyDeleteToRecovery(ch, deletion);
    }
  });

  conn.on(WebcastEvent.GIFT, (data: any) => {
    if (data.giftType === 1 && data.repeatEnd === false) return;
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    const count = data.repeatCount ?? 1;
    const name = data.giftDetails?.giftName ?? data.giftName ?? 'a gift';
    const diamonds = (data.giftDetails?.diamondCount ?? data.diamondCount ?? 0) * Math.max(count, 1);
    broadcast(ch, {
      type: 'gift',
      id: tikTokNativeMessageId(data)
        ?? `gift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...senderIdentity(data.user, 'Someone'),
      text: `${author} sent ${count}x ${name}!${diamonds ? ` (${diamonds} 💎)` : ''}`,
      giftIcon: data.giftDetails?.giftImage?.giftPictureUrl
        ?? data.giftDetails?.icon?.urlList?.[0]
        ?? data.giftImage?.giftPictureUrl,
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.SUB_NOTIFY, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    broadcast(ch, {
      type: 'sub',
      id: tikTokNativeMessageId(data)
        ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...senderIdentity(data.user, 'Someone'),
      text: `${author} subscribed!`,
      timestamp: Date.now(),
    });
  });
  conn.on(WebcastEvent.FOLLOW, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    broadcast(ch, {
      type: 'follow',
      id: tikTokNativeMessageId(data)
        ?? `follow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...senderIdentity(data.user, 'Someone'),
      text: `${author} followed!`,
      timestamp: Date.now(),
    });
  });
  conn.on(WebcastEvent.SHARE, (data: any) => {
    const author = data.user?.nickname || data.user?.uniqueId || 'Someone';
    broadcast(ch, {
      type: 'share',
      id: tikTokNativeMessageId(data)
        ?? `share-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...senderIdentity(data.user, 'Someone'),
      text: `${author} shared the stream!`,
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.ROOM_PIN, (data: any) => {
    const pinned = data.pinnedMessage ?? data.message ?? data;
    const u = pinned?.user ?? data.user;
    const text = pinned?.content ?? pinned?.comment ?? '';
    if (!text) { broadcast(ch, { type: 'unpin' }); return; }
    broadcast(ch, {
      type: 'pin',
      id: tikTokNativeMessageId(pinned) ?? tikTokNativeMessageId(data) ?? `pin-${Date.now()}`,
      ...senderIdentity(u, 'viewer'),
      text,
      timestamp: Date.now(),
    });
  });

  function recordConnectError() {
    metrics.upstreamErrors += 1;
  }

  function isCurrentChannel(): boolean {
    return !ch.closed && channels.get(user) === ch;
  }

  function scheduleReconnect(
    delay = ch.backoff,
    announceConnecting = true,
  ): boolean {
    if (!isCurrentChannel() || !ch.subs.size || ch.reconnectTimer) return false;
    ch.needsReconnect = true;
    if (announceConnecting) setStatus(ch, { type: 'status', status: 'connecting' });
    ch.reconnectTimer = setTimeout(() => {
      ch.reconnectTimer = null;
      if (!isCurrentChannel() || !ch.subs.size) return;
      if (!announceConnecting) setStatus(ch, { type: 'status', status: 'connecting' });
      void connect(true);
    }, delay);
    return true;
  }

  async function connect(reconnectAttempt: boolean): Promise<void> {
    if (!isCurrentChannel() || !ch.subs.size || ch.connectInFlight) return;
    ch.connectInFlight = true;
    try {
      await conn.connect();
      if (isCurrentChannel()) {
        ch.needsReconnect = false;
        ch.backoff = 5000;
      }
    } catch (err: unknown) {
      if (!isCurrentChannel()) return;
      recordConnectError();
      ch.needsReconnect = true;
      const name = connectErrorName(err);
      if (name === 'UserOfflineError') {
        setStatus(ch, { type: 'status', status: 'offline', detail: 'User is not live' });
        const delay = reconnectAttempt
          ? Math.max(60_000, ch.backoff + 10_000)
          : 60_000 + ch.backoff;
        scheduleReconnect(delay, false);
      } else if (name === 'UserNotFoundError') {
        setStatus(ch, { type: 'status', status: 'error', detail: `TikTok user @${user} not found` });
        destroyChannel(user, ch);
      } else {
        setStatus(ch, {
          type: 'status',
          status: 'error',
          detail: TIKTOK_PUBLIC_CONNECTION_ERROR_DETAIL,
        });
        if (reconnectAttempt) ch.backoff = Math.min(ch.backoff * 2, 120_000);
        metrics.reconnects += 1;
        scheduleReconnect();
      }
    } finally {
      ch.connectInFlight = false;
    }
  }

  ch.startConnection = () => {
    if (ch.needsReconnect) {
      scheduleReconnect();
    } else {
      void connect(false);
    }
  };

  return ch;
}

function destroyChannel(user: string, expected?: Channel) {
  const ch = channels.get(user);
  if (!ch || (expected && ch !== expected)) return;
  ch.closed = true;
  if (ch.lingerTimer) clearTimeout(ch.lingerTimer);
  if (ch.reconnectTimer) clearTimeout(ch.reconnectTimer);
  ch.lingerTimer = null;
  ch.reconnectTimer = null;
  try { ch.conn.disconnect(); } catch { /* already down */ }
  channels.delete(user);
  ch.subs.clear();
}

export function subscribe(rawUser: string, send: Send): () => void {
  const normalized = normalizeChatChannel('tiktok', rawUser);
  if (!normalized) throw new Error('invalid TikTok user');
  const user = normalized.toLowerCase();
  let ch = channels.get(user);
  if (!ch && channels.size >= TIKTOK_HUB_MAX_CHANNELS) {
    throw new SharedSseCapacityError('channels');
  }
  const duplicateSubscriber = ch?.subs.has(send) ?? false;
  if (!duplicateSubscriber && subscriberCount() >= TIKTOK_HUB_MAX_SUBSCRIBERS) {
    throw new SharedSseCapacityError('provider-subscribers');
  }
  if (
    ch
    && !duplicateSubscriber
    && ch.subs.size >= TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL
  ) {
    throw new SharedSseCapacityError('channel-subscribers');
  }

  let created = false;
  if (!ch) {
    ch = createChannel(user);
    channels.set(user, ch);
    created = true;
  } else if (ch.lingerTimer) {
    clearTimeout(ch.lingerTimer);
    ch.lingerTimer = null;
  }
  if (!duplicateSubscriber) ch.subs.add(send);

  if (ch.status) {
    try { send(ch.status.data, ch.status.serialized); } catch { /* noop */ }
  } else {
    const status = { type: 'status', status: 'connecting' };
    const serialized = JSON.stringify(status);
    try { send(status, serialized); } catch { /* noop */ }
  }
  for (const event of ch.recent) {
    try { send(event.data, event.serialized); } catch { break; }
  }
  if (created || ch.needsReconnect) ch.startConnection();

  let active = !duplicateSubscriber;
  return () => {
    if (!active) return;
    active = false;
    const current = channels.get(user);
    if (!current || current !== ch || !current.subs.delete(send)) return;
    if (current.subs.size === 0 && !current.lingerTimer) {
      if (current.reconnectTimer) {
        clearTimeout(current.reconnectTimer);
        current.reconnectTimer = null;
      }
      current.lingerTimer = setTimeout(
        () => destroyChannel(user, current),
        TIKTOK_HUB_LINGER_MS,
      );
    }
  };
}

export function tiktokHubAggregateStats() {
  let subscribers = 0;
  let lingeringChannels = 0;
  let bufferedEvents = 0;
  for (const ch of channels.values()) {
    subscribers += ch.subs.size;
    bufferedEvents += ch.recent.length;
    if (ch.lingerTimer) lingeringChannels += 1;
  }
  return {
    activeChannels: channels.size,
    subscribers,
    lingeringChannels,
    bufferedEvents,
    broadcasts: metrics.broadcasts,
    subscriberDeliveries: metrics.subscriberDeliveries,
    reconnects: metrics.reconnects,
    upstreamErrors: metrics.upstreamErrors,
  };
}

/** Compatibility export now returns aggregate-only data, never channel names. */
export function hubStats() {
  return tiktokHubAggregateStats();
}

export function resetTikTokHubForTests() {
  for (const user of [...channels.keys()]) destroyChannel(user);
  metrics.broadcasts = 0;
  metrics.subscriberDeliveries = 0;
  metrics.reconnects = 0;
  metrics.upstreamErrors = 0;
}
