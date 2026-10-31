import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchConnector, parseBadgeMap } from '@/lib/connectors/twitch';
import type { UnifiedMessage } from '@/lib/types';

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send() {}
  close() {}
}

async function ingestWithBadgeResponse(body: unknown): Promise<UnifiedMessage> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body }) as Response),
  );
  const messages: UnifiedMessage[] = [];
  const connector = createTwitchConnector({
    channel: 'streamer',
    onMessage: (message) => messages.push(message),
    onDelete: () => {},
    onStatus: () => {},
  });

  connector.start();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
  await Promise.resolve();
  await Promise.resolve();

  FakeSocket.last!.onmessage?.({
    data:
      '@badges=moderator/1;display-name=SomeMod;id=t1;user-id=9 ' +
      ':somemod!somemod@somemod.tmi.twitch.tv PRIVMSG #streamer :hello\r\n',
  });

  expect(messages).toHaveLength(1);
  connector.stop();
  return messages[0];
}

describe('Twitch badge response validation', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeSocket.last = null;
  });

  it('accepts a plain string-to-string badge map', async () => {
    const message = await ingestWithBadgeResponse({
      'moderator/1': 'https://cdn.example/moderator.png',
    });

    expect(message.text).toBe('hello');
    expect(message.badges).toEqual([
      {
        type: 'moderator',
        version: '1',
        count: 1,
        url: 'https://cdn.example/moderator.png',
      },
    ]);
  });

  it('accepts the preview envelope without weakening map validation', () => {
    expect(parseBadgeMap({
      badges: { 'moderator/1': 'https://cdn.example/mod.png' },
      roomId: '42',
    })).toEqual({ 'moderator/1': 'https://cdn.example/mod.png' });
  });

  it('rejects unsafe URLs and malformed set/version keys', () => {
    expect(parseBadgeMap({ 'moderator/1': 'http://cdn.example/mod.png' })).toBeNull();
    expect(parseBadgeMap({ moderator: 'https://cdn.example/mod.png' })).toBeNull();
    expect(parseBadgeMap({ 'moderator/1/extra': 'https://cdn.example/mod.png' })).toBeNull();
  });

  it('preserves opaque Twitch badge versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ 'subscriber/12-month': 'https://cdn.example/sub.png' }),
      }) as Response),
    );
    const messages: UnifiedMessage[] = [];
    let loadedBadgeMap: Readonly<Record<string, string>> | null = null;
    const loadedConnector = createTwitchConnector({
      channel: 'streamer',
      onMessage: (message) => messages.push(message),
      onDelete: () => {},
      onStatus: () => {},
      onBadgeMap: (badgeMap) => { loadedBadgeMap = badgeMap; },
    });
    loadedConnector.start();
    await vi.waitFor(() => expect(loadedBadgeMap).toMatchObject({
      'subscriber/12-month': 'https://cdn.example/sub.png',
    }));
    FakeSocket.last!.onmessage?.({
      data: '@badges=subscriber/12-month;display-name=Sub;id=t2;user-id=10 ' +
        ':sub!sub@sub.tmi.twitch.tv PRIVMSG #streamer :hello\r\n',
    });
    expect(messages[0].badges[0]).toMatchObject({
      type: 'subscriber', version: '12-month', count: undefined,
      url: 'https://cdn.example/sub.png',
    });
    loadedConnector.stop();
  });

  it('assigns native badges only from each incoming messages own badges tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith('/api/twitch/badges?')) {
          return {
            ok: true,
            json: async () => ({
              'subscriber/12': 'https://cdn.example/subscriber-12.png',
              'moderator/1': 'https://cdn.example/moderator.png',
              'vip/1': 'https://cdn.example/vip.png',
              'broadcaster/1': 'https://cdn.example/broadcaster.png',
            }),
          } as Response;
        }
        return { ok: false } as Response;
      }),
    );

    const messages: UnifiedMessage[] = [];
    const connector = createTwitchConnector({
      channel: 'streamer',
      onMessage: (message) => messages.push(message),
      onDelete: () => {},
      onStatus: () => {},
    });
    connector.start();
    await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();

    const row = (
      id: string,
      userId: string,
      displayName: string,
      badges?: string,
    ) => `@${badges === undefined ? '' : `badges=${badges};`}display-name=${displayName};id=${id};room-id=42;user-id=${userId} `
      + `:${displayName.toLowerCase()}!u@h PRIVMSG #streamer :hello\r\n`;

    FakeSocket.last!.onmessage?.({
      data: [
        row('plain', '100', 'PlainUser'),
        row('sub', '101', 'Subscriber', 'subscriber/12'),
        row('mod', '102', 'Moderator', 'moderator/1'),
        row('vip', '103', 'VipUser', 'vip/1'),
        row('broadcaster', '104', 'Broadcaster', 'broadcaster/1'),
      ].join(''),
    });

    expect(messages.map((message) => ({
      id: message.id,
      senderId: message.senderId,
      badges: message.badges,
    }))).toEqual([
      { id: 'plain', senderId: '100', badges: [] },
      {
        id: 'sub', senderId: '101', badges: [{
          type: 'subscriber', version: '12', count: 12,
          url: 'https://cdn.example/subscriber-12.png',
        }],
      },
      {
        id: 'mod', senderId: '102', badges: [{
          type: 'moderator', version: '1', count: 1,
          url: 'https://cdn.example/moderator.png',
        }],
      },
      {
        id: 'vip', senderId: '103', badges: [{
          type: 'vip', version: '1', count: 1,
          url: 'https://cdn.example/vip.png',
        }],
      },
      {
        id: 'broadcaster', senderId: '104', badges: [{
          type: 'broadcaster', version: '1', count: 1,
          url: 'https://cdn.example/broadcaster.png',
        }],
      },
    ]);
    connector.stop();
  });

  it('keeps channel-specific badge artwork scoped to its connector instance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/twitch/badges?channel=first') {
          return {
            ok: true,
            json: async () => ({ 'subscriber/1': 'https://cdn.example/first-sub.png' }),
          } as Response;
        }
        if (url === '/api/twitch/badges?channel=second') {
          return {
            ok: true,
            json: async () => ({ 'subscriber/1': 'https://cdn.example/second-sub.png' }),
          } as Response;
        }
        return { ok: false } as Response;
      }),
    );

    const ingest = async (channel: string, id: string) => {
      const messages: UnifiedMessage[] = [];
      let loaded = false;
      const connector = createTwitchConnector({
        channel,
        onMessage: (message) => messages.push(message),
        onDelete: () => {},
        onStatus: () => {},
        onBadgeMap: () => { loaded = true; },
      });
      connector.start();
      await vi.waitFor(() => expect(loaded).toBe(true));
      FakeSocket.last!.onmessage?.({
        data: `@badges=subscriber/1;display-name=Viewer;id=${id};room-id=42;user-id=100 `
          + ':viewer!u@h PRIVMSG #channel :hello\r\n',
      });
      connector.stop();
      return messages[0].badges[0]?.url;
    };

    expect(await ingest('first', 'first-message')).toBe('https://cdn.example/first-sub.png');
    expect(await ingest('second', 'second-message')).toBe('https://cdn.example/second-sub.png');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'invalid'],
    ['a number', 42],
    ['a boolean', true],
    ['a record with a non-string value', { 'moderator/1': 42 }],
  ])('keeps delivering messages when the badge API returns %s', async (_label, body) => {
    const message = await ingestWithBadgeResponse(body);

    expect(message.text).toBe('hello');
    expect(message.badges).toEqual([
      { type: 'moderator', version: '1', count: 1, url: undefined },
    ]);
  });
});
