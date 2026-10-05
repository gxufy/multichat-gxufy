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
    onPin: () => {},
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
      onPin: () => {},
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
