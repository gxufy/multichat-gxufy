import { randomUUID } from 'crypto';
import { SharedSseCapacityError } from './sharedSseAdmission';

type KickRealtimeStatus = 'connecting' | 'connected' | 'error';

export type KickRealtimeHubEvent =
  | {
      type: 'status';
      status: KickRealtimeStatus;
      detail?: string;
    }
  | {
      type: 'event';
      sequence: number;
      channel: string;
      event: string;
      data: unknown;
      receivedAt: number;
    };

type Send = (
  data: KickRealtimeHubEvent,
  serialized: string,
) => void;

type BufferedEvent = {
  data: Extract<KickRealtimeHubEvent, { type: 'event' }>;
  serialized: string;
};

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  on(
    event: 'close',
    listener: (code: number, reason: { toString(): string }) => void,
  ): void;
};

type WebSocketCtor = new (
  url: string,
  options?: {
    origin?: string;
    handshakeTimeout?: number;
  },
) => WebSocketLike;

/*
 * Keep this as require() rather than a TS import so the server-only module
 * does not need @types/ws. `ws` is an explicit production dependency.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DefaultNodeWebSocket = require('ws') as WebSocketCtor;

let KickRealtimeWebSocket: WebSocketCtor =
  DefaultNodeWebSocket;

export function setKickRealtimeWebSocketCtorForTests(
  ctor: WebSocketCtor | null,
): void {
  KickRealtimeWebSocket =
    ctor ?? DefaultNodeWebSocket;
}

type ChannelState = {
  key: string;
  channelId: number;
  chatroomId: number;
  subs: Set<Send>;
  recent: BufferedEvent[];
  status: {
    data: Extract<KickRealtimeHubEvent, { type: 'status' }>;
    serialized: string;
  } | null;

  socket: WebSocketLike | null;
  clientId: string | null;

  closed: boolean;
  connectInFlight: boolean;
  subscribed: boolean;

  reconnectTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;

  reconnectBackoffMs: number;
  lastFrameAt: number;
  pingSeconds: number;

  commandId: number;
  sequence: number;
  pendingSubscriptions: Map<number, string>;
};

type RealtimeDescriptor = {
  data?: {
    connections?: Array<{
      provider?: unknown;
      credentials?: {
        url?: unknown;
      };
    }>;
  };
};

type RealtimeAuth = {
  data?: {
    token?: unknown;
  };
};

const channels = new Map<string, ChannelState>();

export const KICK_REALTIME_HUB_LINGER_MS = 30_000;
export const KICK_REALTIME_HUB_MAX_CHANNELS = 32;
export const KICK_REALTIME_HUB_MAX_SUBSCRIBERS_PER_CHANNEL = 32;
export const KICK_REALTIME_HUB_MAX_SUBSCRIBERS = 256;
export const KICK_REALTIME_RECENT_MAX = 100;

const KICK_REALTIME_REQUEST_TIMEOUT_MS = 10_000;
const KICK_REALTIME_RECONNECT_MIN_MS = 1_000;
const KICK_REALTIME_RECONNECT_MAX_MS = 30_000;

const KICK_WEB_ORIGIN = 'https://kick.com';
const KICK_REALTIME_AUTH_URL =
  'https://web.kick.com/api/v1/realtime/auth/connection';

const WS_OPEN = 1;

function subscriberCount(): number {
  let total = 0;
  for (const state of channels.values()) {
    total += state.subs.size;
  }
  return total;
}

function serialize(
  data: KickRealtimeHubEvent,
): string | null {
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

function setStatus(
  state: ChannelState,
  status: KickRealtimeStatus,
  detail?: string,
): void {
  const data: Extract<
    KickRealtimeHubEvent,
    { type: 'status' }
  > = {
    type: 'status',
    status,
    ...(detail ? { detail } : {}),
  };

  const serialized = serialize(data);
  if (!serialized) return;

  state.status = {
    data,
    serialized,
  };

  for (const send of state.subs) {
    try {
      send(data, serialized);
    } catch {
      // The SSE route owns removal of dead subscribers.
    }
  }
}

function broadcastEvent(
  state: ChannelState,
  channel: string,
  event: string,
  data: unknown,
): void {
  state.sequence += 1;

  const envelope: Extract<
    KickRealtimeHubEvent,
    { type: 'event' }
  > = {
    type: 'event',
    sequence: state.sequence,
    channel,
    event,
    data,
    receivedAt: Date.now(),
  };

  const serialized = serialize(envelope);
  if (!serialized) return;

  state.recent.push({
    data: envelope,
    serialized,
  });

  while (
    state.recent.length >
    KICK_REALTIME_RECENT_MAX
  ) {
    state.recent.shift();
  }

  for (const send of state.subs) {
    try {
      send(envelope, serialized);
    } catch {
      // The SSE route owns removal of dead subscribers.
    }
  }
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0 ||
    !Number.isSafeInteger(number)
  ) {
    return null;
  }

  return number;
}

function decodeKickPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function realtimeUrlAllowed(
  value: unknown,
): value is string {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value);

    return (
      url.protocol === 'wss:' &&
      url.pathname === '/connection/websocket' &&
      /^realtime\.[a-z0-9-]+\.platform\.kick\.com$/i.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

async function fetchJsonWithTimeout(
  url: string,
  body: unknown,
): Promise<unknown> {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    KICK_REALTIME_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: KICK_WEB_ORIGIN,
        Referer: `${KICK_WEB_ORIGIN}/`,
        /*
         * Kick currently accepts a plain Mozilla UA from a Node client.
         * Do not impersonate a full Chrome build; Kick has rejected that
         * shape from non-browser clients in the past.
         */
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Kick realtime HTTP ${response.status}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRealtimeUrl(
  channelId: number,
  clientId: string,
): Promise<string> {
  const requestBody = {
    client: {
      id: clientId,
      type: 'web',
    },
    capabilities: {
      accepted_providers: [
        { provider: 'centrifugo' },
        { provider: 'pusher' },
      ],
    },
  };

  const urls = [
    `https://web.kick.com/api/v1/realtime/channels/${channelId}/chat/connection`,
    'https://web.kick.com/api/v1/realtime/connection',
  ];

  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const raw = await fetchJsonWithTimeout(
        url,
        requestBody,
      );

      const descriptor =
        raw as RealtimeDescriptor;

      const connection =
        descriptor.data?.connections?.find(
          (candidate) =>
            candidate?.provider === 'centrifugo',
        );

      const realtimeUrl =
        connection?.credentials?.url;

      if (realtimeUrlAllowed(realtimeUrl)) {
        return realtimeUrl;
      }

      lastError = new Error(
        'Kick did not return a valid Centrifugo endpoint',
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(
      'Kick realtime endpoint unavailable',
    )
  );
}

async function mintRealtimeToken(
  clientId: string,
): Promise<string> {
  const raw = await fetchJsonWithTimeout(
    KICK_REALTIME_AUTH_URL,
    {
      client_id: clientId,
    },
  );

  const auth = raw as RealtimeAuth;
  const token = auth.data?.token;

  if (
    typeof token !== 'string' ||
    !token.trim()
  ) {
    throw new Error(
      'Kick realtime token unavailable',
    );
  }

  return token;
}

function feedNames(
  state: ChannelState,
): string[] {
  return [
    `chatrooms.${state.chatroomId}.v2`,
    `chatroom_${state.chatroomId}`,
    `channel_${state.channelId}`,
    `chatrooms.${state.chatroomId}`,
    `channel.${state.channelId}`,
  ];
}

function clearRefreshTimer(
  state: ChannelState,
): void {
  if (state.refreshTimer) {
    clearTimeout(state.refreshTimer);
  }

  state.refreshTimer = null;
}

function clearWatchdog(
  state: ChannelState,
): void {
  if (state.watchdogTimer) {
    clearInterval(state.watchdogTimer);
  }

  state.watchdogTimer = null;
}

function clearReconnectTimer(
  state: ChannelState,
): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }

  state.reconnectTimer = null;
}

function closeSocket(
  state: ChannelState,
): void {
  const socket = state.socket;
  state.socket = null;
  state.subscribed = false;
  state.pendingSubscriptions.clear();

  clearRefreshTimer(state);
  clearWatchdog(state);

  if (!socket) return;

  try {
    socket.close();
  } catch {
    try {
      socket.terminate();
    } catch {
      // Already gone.
    }
  }
}

function sendFrame(
  state: ChannelState,
  value: unknown,
): boolean {
  const socket = state.socket;

  if (
    !socket ||
    socket.readyState !== WS_OPEN
  ) {
    return false;
  }

  try {
    socket.send(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function nextCommandId(
  state: ChannelState,
): number {
  state.commandId += 1;
  return state.commandId;
}

function subscribeFeeds(
  state: ChannelState,
): void {
  for (const channel of feedNames(state)) {
    const id = nextCommandId(state);

    state.pendingSubscriptions.set(
      id,
      channel,
    );

    sendFrame(state, {
      id,
      subscribe: {
        channel,
        flag: 1,
      },
    });
  }
}

function scheduleRefresh(
  state: ChannelState,
  ttlSeconds: number,
): void {
  clearRefreshTimer(state);

  const safeTtl =
    Number.isFinite(ttlSeconds) &&
    ttlSeconds > 0
      ? ttlSeconds
      : 2_700;

  /*
   * Refresh halfway through the advertised lifetime.
   * Kick currently returns 2700 seconds (45 minutes).
   */
  const delay = Math.max(
    60_000,
    Math.floor((safeTtl * 1_000) / 2),
  );

  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null;

    if (
      state.closed ||
      !state.subs.size ||
      !state.clientId ||
      !state.socket ||
      state.socket.readyState !== WS_OPEN
    ) {
      return;
    }

    void mintRealtimeToken(state.clientId)
      .then((token) => {
        if (
          state.closed ||
          !state.socket ||
          state.socket.readyState !== WS_OPEN
        ) {
          return;
        }

        const id = nextCommandId(state);

        if (
          !sendFrame(state, {
            id,
            refresh: {
              token,
            },
          })
        ) {
          throw new Error(
            'Kick realtime refresh send failed',
          );
        }
      })
      .catch(() => {
        /*
         * A fresh connection also creates a fresh client id and token,
         * so a refresh failure is recovered by the normal reconnect path.
         */
        reconnectNow(state);
      });
  }, delay);
}

function startWatchdog(
  state: ChannelState,
): void {
  clearWatchdog(state);

  state.watchdogTimer = setInterval(() => {
    if (
      state.closed ||
      !state.subs.size ||
      !state.socket
    ) {
      return;
    }

    const pingMs =
      Math.max(state.pingSeconds, 25) *
      1_000;

    if (
      Date.now() - state.lastFrameAt >
      pingMs * 3
    ) {
      reconnectNow(state);
    }
  }, 10_000);
}

function scheduleReconnect(
  state: ChannelState,
): void {
  if (
    state.closed ||
    !state.subs.size ||
    state.reconnectTimer
  ) {
    return;
  }

  setStatus(
    state,
    'connecting',
    'Kick chat reconnecting',
  );

  const delay =
    state.reconnectBackoffMs;

  state.reconnectBackoffMs = Math.min(
    state.reconnectBackoffMs * 2,
    KICK_REALTIME_RECONNECT_MAX_MS,
  );

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;

    if (
      state.closed ||
      !state.subs.size
    ) {
      return;
    }

    void connect(state);
  }, delay);
}

function reconnectNow(
  state: ChannelState,
): void {
  if (
    state.closed ||
    !state.subs.size
  ) {
    return;
  }

  closeSocket(state);
  clearReconnectTimer(state);

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;

    if (
      state.closed ||
      !state.subs.size
    ) {
      return;
    }

    void connect(state);
  }, KICK_REALTIME_RECONNECT_MIN_MS);
}

function handlePublication(
  state: ChannelState,
  frame: Record<string, unknown>,
): void {
  const push = isObject(frame.push)
    ? frame.push
    : null;

  if (!push) return;

  if (isObject(push.disconnect)) {
    reconnectNow(state);
    return;
  }

  if (isObject(push.unsub)) {
    const channel =
      typeof push.channel === 'string'
        ? push.channel
        : '';

    const code = Number(push.unsub.code);

    if (
      channel &&
      Number.isInteger(code) &&
      code >= 2500 &&
      code <= 2999
    ) {
      const id = nextCommandId(state);

      state.pendingSubscriptions.set(
        id,
        channel,
      );

      sendFrame(state, {
        id,
        subscribe: {
          channel,
          flag: 1,
        },
      });
    }

    return;
  }

  const publication = isObject(push.pub)
    ? push.pub
    : null;

  const payload =
    publication &&
    isObject(publication.data)
      ? publication.data
      : null;

  if (!payload) return;

  const channel =
    typeof push.channel === 'string'
      ? push.channel
      : '';

  const event =
    typeof payload.event === 'string'
      ? payload.event
      : '';

  if (!channel || !event) return;

  broadcastEvent(
    state,
    channel,
    event,
    decodeKickPayload(payload.data),
  );
}

function processFrame(
  state: ChannelState,
  raw: unknown,
): void {
  const text =
    typeof raw === 'string'
      ? raw
      : String(raw ?? '');

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isObject(parsed)) continue;

    state.lastFrameAt = Date.now();

    /*
     * Centrifugo's heartbeat is an empty JSON object.
     * Because pong=true in Kick's connect response, answer with {}.
     */
    if (Object.keys(parsed).length === 0) {
      sendFrame(state, {});
      continue;
    }

    if (isObject(parsed.connect)) {
      const ttl = Number(
        parsed.connect.ttl,
      );

      const ping = Number(
        parsed.connect.ping,
      );

      state.pingSeconds =
        Number.isFinite(ping) &&
        ping > 0
          ? ping
          : 25;

      scheduleRefresh(
        state,
        Number.isFinite(ttl) &&
        ttl > 0
          ? ttl
          : 2_700,
      );

      startWatchdog(state);
      subscribeFeeds(state);
      continue;
    }

    if (isObject(parsed.refresh)) {
      const ttl = Number(
        parsed.refresh.ttl,
      );

      scheduleRefresh(
        state,
        Number.isFinite(ttl) &&
        ttl > 0
          ? ttl
          : 2_700,
      );

      continue;
    }

    if (isObject(parsed.subscribe)) {
      const id = Number(parsed.id);

      const channel =
        state.pendingSubscriptions.get(
          id,
        );

      if (channel) {
        state.pendingSubscriptions.delete(
          id,
        );

        if (
          channel ===
          `chatrooms.${state.chatroomId}.v2`
        ) {
          state.subscribed = true;
          state.reconnectBackoffMs =
            KICK_REALTIME_RECONNECT_MIN_MS;

          setStatus(
            state,
            'connected',
            'Kick chat connected',
          );
        }
      }

      continue;
    }

    if (isObject(parsed.error)) {
      const id = Number(parsed.id);

      const failedChannel =
        state.pendingSubscriptions.get(
          id,
        );

      if (failedChannel) {
        state.pendingSubscriptions.delete(
          id,
        );
      }

      /*
       * A primary-chat subscription error takes chat down.
       * An error with no pending subscription belongs to connect/refresh
       * and also requires a fresh connection/token. Auxiliary feed refusal
       * remains isolated so chat itself stays available.
       */
      if (
        !failedChannel ||
        failedChannel ===
          `chatrooms.${state.chatroomId}.v2`
      ) {
        reconnectNow(state);
      }

      continue;
    }

    handlePublication(
      state,
      parsed,
    );
  }
}

async function connect(
  state: ChannelState,
): Promise<void> {
  if (
    state.closed ||
    !state.subs.size ||
    state.connectInFlight
  ) {
    return;
  }

  state.connectInFlight = true;
  clearReconnectTimer(state);
  closeSocket(state);

  setStatus(
    state,
    'connecting',
    'Connecting to Kick chat',
  );

  try {
    const clientId = randomUUID();

    const [
      realtimeUrl,
      token,
    ] = await Promise.all([
      resolveRealtimeUrl(
        state.channelId,
        clientId,
      ),
      mintRealtimeToken(clientId),
    ]);

    if (
      state.closed ||
      !state.subs.size
    ) {
      return;
    }

    state.clientId = clientId;
    state.commandId = 0;
    state.pendingSubscriptions.clear();

    const socket = new KickRealtimeWebSocket(
      realtimeUrl,
      {
        origin: KICK_WEB_ORIGIN,
        handshakeTimeout:
          KICK_REALTIME_REQUEST_TIMEOUT_MS,
      },
    );

    state.socket = socket;

    socket.on('open', () => {
      if (
        state.closed ||
        state.socket !== socket
      ) {
        try {
          socket.close();
        } catch {
          // Stale connection.
        }
        return;
      }

      state.lastFrameAt = Date.now();

      const id = nextCommandId(state);

      sendFrame(state, {
        id,
        connect: {
          token,
          name: 'js',
        },
      });
    });

    socket.on('message', (data) => {
      if (
        state.closed ||
        state.socket !== socket
      ) {
        return;
      }

      processFrame(
        state,
        data,
      );
    });

    socket.on('error', () => {
      if (
        state.closed ||
        state.socket !== socket
      ) {
        return;
      }

      /*
       * `ws` normally follows an error with close. Force closure so a
       * half-open upstream can never leave this channel permanently stuck.
       */
      try {
        socket.terminate();
      } catch {
        // Close handler/reconnect owns recovery.
      }
    });

    socket.on('close', () => {
      if (
        state.socket !== socket
      ) {
        return;
      }

      state.socket = null;
      state.subscribed = false;
      state.pendingSubscriptions.clear();

      clearRefreshTimer(state);
      clearWatchdog(state);

      if (
        !state.closed &&
        state.subs.size
      ) {
        scheduleReconnect(state);
      }
    });
  } catch {
    if (
      !state.closed &&
      state.subs.size
    ) {
      setStatus(
        state,
        'error',
        'Kick chat connection failed',
      );

      scheduleReconnect(state);
    }
  } finally {
    state.connectInFlight = false;
  }
}

function createChannelState(
  channelId: number,
  chatroomId: number,
): ChannelState {
  return {
    key: `${channelId}:${chatroomId}`,
    channelId,
    chatroomId,
    subs: new Set(),
    recent: [],
    status: null,

    socket: null,
    clientId: null,

    closed: false,
    connectInFlight: false,
    subscribed: false,

    reconnectTimer: null,
    refreshTimer: null,
    watchdogTimer: null,
    lingerTimer: null,

    reconnectBackoffMs:
      KICK_REALTIME_RECONNECT_MIN_MS,
    lastFrameAt: 0,
    pingSeconds: 25,

    commandId: 0,
    sequence: 0,
    pendingSubscriptions: new Map(),
  };
}

function destroyChannel(
  key: string,
  expected?: ChannelState,
): void {
  const state = channels.get(key);

  if (
    !state ||
    (expected && state !== expected)
  ) {
    return;
  }

  state.closed = true;

  clearReconnectTimer(state);
  clearRefreshTimer(state);
  clearWatchdog(state);

  if (state.lingerTimer) {
    clearTimeout(state.lingerTimer);
  }

  state.lingerTimer = null;

  closeSocket(state);

  state.subs.clear();
  state.recent.length = 0;

  channels.delete(key);
}

export function subscribeKickRealtime(
  rawChannelId: number,
  rawChatroomId: number,
  send: Send,
  afterSequence?: number | null,
): () => void {
  const channelId =
    positiveInteger(rawChannelId);

  const chatroomId =
    positiveInteger(rawChatroomId);

  if (!channelId || !chatroomId) {
    throw new Error(
      'invalid Kick realtime ids',
    );
  }

  const key =
    `${channelId}:${chatroomId}`;

  let state =
    channels.get(key);

  if (
    !state &&
    channels.size >=
      KICK_REALTIME_HUB_MAX_CHANNELS
  ) {
    throw new SharedSseCapacityError(
      'channels',
    );
  }

  const duplicateSubscriber =
    state?.subs.has(send) ?? false;

  if (
    !duplicateSubscriber &&
    subscriberCount() >=
      KICK_REALTIME_HUB_MAX_SUBSCRIBERS
  ) {
    throw new SharedSseCapacityError(
      'provider-subscribers',
    );
  }

  if (
    state &&
    !duplicateSubscriber &&
    state.subs.size >=
      KICK_REALTIME_HUB_MAX_SUBSCRIBERS_PER_CHANNEL
  ) {
    throw new SharedSseCapacityError(
      'channel-subscribers',
    );
  }

  let created = false;

  if (!state) {
    state = createChannelState(
      channelId,
      chatroomId,
    );

    channels.set(
      key,
      state,
    );

    created = true;
  } else if (state.lingerTimer) {
    clearTimeout(
      state.lingerTimer,
    );

    state.lingerTimer = null;
  }

  if (!duplicateSubscriber) {
    state.subs.add(send);
  }

  if (state.status) {
    try {
      send(
        state.status.data,
        state.status.serialized,
      );
    } catch {
      // Request cleanup removes it.
    }
  } else {
    const status: Extract<
      KickRealtimeHubEvent,
      { type: 'status' }
    > = {
      type: 'status',
      status: 'connecting',
      detail: 'Connecting to Kick chat',
    };

    const serialized =
      JSON.stringify(status);

    try {
      send(
        status,
        serialized,
      );
    } catch {
      // Request cleanup removes it.
    }
  }

  if (
    Number.isSafeInteger(
      afterSequence,
    ) &&
    Number(afterSequence) >= 0
  ) {
    for (const buffered of state.recent) {
      if (
        buffered.data.sequence <=
        Number(afterSequence)
      ) {
        continue;
      }

      try {
        send(
          buffered.data,
          buffered.serialized,
        );
      } catch {
        break;
      }
    }
  }

  if (
    created ||
    (
      !state.socket &&
      !state.connectInFlight &&
      !state.reconnectTimer
    )
  ) {
    void connect(state);
  }

  let active =
    !duplicateSubscriber;

  return () => {
    if (!active) return;
    active = false;

    const current =
      channels.get(key);

    if (
      !current ||
      current !== state ||
      !current.subs.delete(send)
    ) {
      return;
    }

    if (
      current.subs.size === 0 &&
      !current.lingerTimer
    ) {
      clearReconnectTimer(current);

      current.lingerTimer =
        setTimeout(
          () =>
            destroyChannel(
              key,
              current,
            ),
          KICK_REALTIME_HUB_LINGER_MS,
        );
    }
  };
}

export function kickRealtimeHubStats() {
  let subscribers = 0;
  let connectedChannels = 0;
  let lingeringChannels = 0;
  let bufferedEvents = 0;

  for (const state of channels.values()) {
    subscribers +=
      state.subs.size;

    bufferedEvents +=
      state.recent.length;

    if (state.subscribed) {
      connectedChannels += 1;
    }

    if (state.lingerTimer) {
      lingeringChannels += 1;
    }
  }

  return {
    activeChannels: channels.size,
    connectedChannels,
    subscribers,
    lingeringChannels,
    bufferedEvents,
  };
}

export function resetKickRealtimeHubForTests(): void {
  for (const key of [
    ...channels.keys(),
  ]) {
    destroyChannel(key);
  }
}
