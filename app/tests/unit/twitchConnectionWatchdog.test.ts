import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TWITCH_CONNECT_TIMEOUT_MS,
  TWITCH_KEEPALIVE_IDLE_MS,
  TWITCH_KEEPALIVE_TIMEOUT_MS,
  TWITCH_RECONNECT_AGAIN_MS,
  createTwitchConnector,
} from '@/lib/connectors/twitch';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
    this.receive(':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!');
  }

  receive(line: string) {
    this.onmessage?.({ data: `${line}\r\n` });
  }

  pings() {
    return this.sent.filter((line) => line.startsWith('PING'));
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];

function start() {
  const statuses: string[] = [];
  const connector = createTwitchConnector({
    channel: 'gxufy',
    onMessage: () => undefined,
    onDelete: () => undefined,
    onStatus: (status: string) => statuses.push(status),
  } as never);
  connector.start();
  return { connector, statuses };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false }) as Response));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Twitch connection watchdog', () => {
  it('asks Twitch after a quiet minute, and an answer keeps the connection', () => {
    const { connector } = start();
    const socket = latest();
    socket.open();

    vi.advanceTimersByTime(TWITCH_KEEPALIVE_IDLE_MS - 5_000);
    expect(socket.pings()).toEqual([]);
    vi.advanceTimersByTime(5_000);
    expect(socket.pings()).toEqual(['PING :tmi.twitch.tv']);

    socket.receive(':tmi.twitch.tv PONG tmi.twitch.tv :tmi.twitch.tv');
    vi.advanceTimersByTime(TWITCH_KEEPALIVE_TIMEOUT_MS * 3);
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket.closed).toBe(false);
    connector.stop();
  });

  it('a busy chat never needs a ping', () => {
    const { connector } = start();
    const socket = latest();
    socket.open();
    for (let i = 0; i < 40; i += 1) {
      vi.advanceTimersByTime(10_000);
      socket.receive(`@id=${i} :a!a@a.tmi.twitch.tv PRIVMSG #gxufy :hi ${i}`);
    }
    expect(socket.pings()).toEqual([]);
    connector.stop();
  });

  it('no answer to the ping: gives the socket up and reconnects', () => {
    const { connector, statuses } = start();
    const socket = latest();
    socket.open();

    vi.advanceTimersByTime(TWITCH_KEEPALIVE_IDLE_MS + TWITCH_KEEPALIVE_TIMEOUT_MS + 5_000);
    expect(socket.closed).toBe(true);
    expect(socket.onmessage).toBeNull();
    expect(statuses.at(-1)).toBe('connecting');

    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    const next = latest();
    next.open();
    expect(next.sent).toContain('JOIN #gxufy');

    /* A late close from the abandoned socket starts nothing. */
    socket.onclose?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    connector.stop();
  });

  it('a socket that never opens is given up and tried again', () => {
    const { connector } = start();
    const socket = latest();
    vi.advanceTimersByTime(TWITCH_CONNECT_TIMEOUT_MS + 5_000);
    expect(socket.closed).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    connector.stop();
  });

  it('Twitch’s RECONNECT moves to a new socket at once', () => {
    const { connector } = start();
    const socket = latest();
    socket.open();
    socket.receive(':tmi.twitch.tv RECONNECT');
    expect(socket.closed).toBe(true);
    expect(FakeSocket.all).toHaveLength(2);
    expect(latest().closed).toBe(false);
    connector.stop();
  });

  it('a second RECONNECT within ten seconds waits for the backoff', () => {
    const { connector } = start();
    latest().open();
    latest().receive(':tmi.twitch.tv RECONNECT');
    expect(FakeSocket.all).toHaveLength(2);
    latest().open();
    vi.advanceTimersByTime(TWITCH_RECONNECT_AGAIN_MS - 1_000);
    latest().receive(':tmi.twitch.tv RECONNECT');
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(3);
    /* Ten seconds after the last one, the next moves at once again. */
    latest().open();
    vi.advanceTimersByTime(TWITCH_RECONNECT_AGAIN_MS);
    latest().receive(':tmi.twitch.tv RECONNECT');
    expect(FakeSocket.all).toHaveLength(4);
    connector.stop();
  });

  it('a normal close still reconnects with the backoff, once', () => {
    const { connector } = start();
    const socket = latest();
    socket.open();
    socket.onclose?.();
    socket.onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    latest().onclose?.();
    vi.advanceTimersByTime(1_999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    connector.stop();
  });

  it('stop leaves no timers behind', () => {
    const { connector } = start();
    const socket = latest();
    socket.open();
    connector.stop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(socket.pings()).toEqual([]);
    expect(FakeSocket.all).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
