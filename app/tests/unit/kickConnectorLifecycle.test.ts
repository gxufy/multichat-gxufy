import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector } from '@/lib/types';

type ConnectionHandler = (value?: any) => void;

class FakePusherChannel {
  bind() { return this; }
}

class FakePusherConnection {
  state = 'connected';
  private readonly handlers = new Map<string, ConnectionHandler[]>();

  bind(event: string, handler: ConnectionHandler) {
    const current = this.handlers.get(event) ?? [];
    current.push(handler);
    this.handlers.set(event, current);
  }

  emit(event: string, value?: any) {
    for (const handler of this.handlers.get(event) ?? []) handler(value);
  }
}

class FakePusher {
  static instances: FakePusher[] = [];

  readonly connection = new FakePusherConnection();
  readonly channels = new Map<string, FakePusherChannel>();
  connectCalls = 0;
  disconnectCalls = 0;

  constructor() {
    FakePusher.instances.push(this);
  }

  subscribe(name: string) {
    let channel = this.channels.get(name);
    if (!channel) {
      channel = new FakePusherChannel();
      this.channels.set(name, channel);
    }
    return channel;
  }

  channel(name: string) {
    return this.channels.get(name) ?? null;
  }

  connect() {
    this.connectCalls += 1;
  }

  disconnect() {
    this.disconnectCalls += 1;
    this.connection.state = 'disconnected';
    this.connection.emit('state_change', { current: 'disconnected' });
  }

  emitDisconnected() {
    this.connection.state = 'disconnected';
    this.connection.emit('state_change', { current: 'disconnected' });
  }

  emitConnected() {
    this.connection.state = 'connected';
    this.connection.emit('connected');
  }
}

vi.mock('pusher-js', () => ({ default: FakePusher }));

vi.mock('@/lib/kick', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  getKickChannel: vi.fn(async (channel: string) => ({
    id: channel === 'second' ? 8 : 7,
    user_id: channel === 'second' ? 88 : 77,
    chatroom: { id: channel === 'second' ? 800 : 700 },
    user: { id: channel === 'second' ? 88 : 77, username: channel },
    subscriber_badges: [],
  })),
}));

const connectors: Connector[] = [];

async function startConnector(channel = 'streamer') {
  const { createKickConnector } = await import('@/lib/connectors/kick');
  const connector = createKickConnector({
    channel,
    onMessage: vi.fn(),
    onDelete: vi.fn(),
    onPin: vi.fn(),
    onStatus: vi.fn(),
  });
  connectors.push(connector);
  connector.start();
  await vi.advanceTimersByTimeAsync(0);
  const pusher = FakePusher.instances.at(-1);
  expect(pusher).toBeDefined();
  return { connector, pusher: pusher! };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakePusher.instances = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { messages: [] } }),
  } as Response)));
});

afterEach(() => {
  for (const connector of connectors.splice(0)) connector.stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Kick connector reconnect lifecycle', () => {
  it('creates only one transport when start is requested repeatedly', async () => {
    const { createKickConnector } = await import('@/lib/connectors/kick');
    const connector = createKickConnector({
      channel: 'streamer',
      onMessage: vi.fn(),
      onDelete: vi.fn(),
      onPin: vi.fn(),
      onStatus: vi.fn(),
    });
    connectors.push(connector);

    connector.start();
    connector.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(FakePusher.instances).toHaveLength(1);
  });

  it('coalesces repeated disconnect signals into one reconnect', async () => {
    const { pusher } = await startConnector();

    pusher.emitDisconnected();
    pusher.emitDisconnected();
    pusher.emitDisconnected();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(pusher.connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pusher.connectCalls).toBe(1);
  });

  it('clears timer ownership when it fires and reconnects normally again', async () => {
    const { pusher } = await startConnector();

    pusher.emitDisconnected();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pusher.connectCalls).toBe(1);

    pusher.emitDisconnected();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pusher.connectCalls).toBe(2);
  });

  it('cancels a pending reconnect when Pusher recovers by itself', async () => {
    const { pusher } = await startConnector();

    pusher.emitDisconnected();
    pusher.emitConnected();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pusher.connectCalls).toBe(0);
  });

  it('coalesces watchdog failure and disconnect events into one reconnect', async () => {
    const { pusher } = await startConnector();

    pusher.connection.state = 'unavailable';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pusher.disconnectCalls).toBe(1);
    expect(pusher.connectCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pusher.connectCalls).toBe(1);
  });

  it('stop cancels pending work, ignores stale events, and is idempotent', async () => {
    const { connector, pusher } = await startConnector();

    pusher.emitDisconnected();
    connector.stop();
    connector.stop();
    pusher.emitDisconnected();
    pusher.emitConnected();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(pusher.connectCalls).toBe(0);
    expect(pusher.disconnectCalls).toBe(1);
  });

  it('rechecks lifecycle state if a cancelled timer callback is already queued', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { connector, pusher } = await startConnector();

    pusher.emitDisconnected();
    const reconnectCall = timeoutSpy.mock.calls.find(([, delay]) => delay === 2_000);
    expect(reconnectCall).toBeDefined();
    const staleCallback = reconnectCall![0] as () => void;

    connector.stop();
    staleCallback();

    expect(pusher.connectCalls).toBe(0);
  });

  it('keeps stale events isolated from a replacement connector instance', async () => {
    const first = await startConnector('first');
    first.connector.stop();
    const second = await startConnector('second');

    first.pusher.emitDisconnected();
    second.pusher.emitDisconnected();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(first.pusher.connectCalls).toBe(0);
    expect(second.pusher.connectCalls).toBe(1);
    expect(FakePusher.instances).toHaveLength(2);
  });
});
