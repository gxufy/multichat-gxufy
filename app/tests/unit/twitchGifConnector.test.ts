import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchConnector } from '@/lib/connectors/twitch';
import type { UnifiedMessage } from '@/lib/types';

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(value: string) { this.sent.push(value); }
  close() {}
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
});

afterEach(() => vi.unstubAllGlobals());

describe('Twitch connector GIF metadata', () => {
  it('carries structured native GIF ranges from the IRC gifs tag', () => {
    const seen: UnifiedMessage[] = [];
    const connector = createTwitchConnector({
      channel: 'streamer',
      onMessage: (message) => seen.push(message),
      onDelete: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    const socket = FakeSocket.last!;
    socket.onopen?.();
    socket.onmessage?.({
      data: '@badges=;display-name=Viewer;gifs=0-7|gif-1|https://cdn.example.com/native.gif;id=m1;user-id=u1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :fallback text\r\n',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].twitchGifs).toEqual([{
      start: 0,
      end: 8,
      id: 'gif-1',
      url: 'https://cdn.example.com/native.gif',
    }]);
    expect(seen[0].text).toBe('fallback text');
    connector.stop();
  });

  it('drops unsafe GIF metadata without dropping the chat message', () => {
    const seen: UnifiedMessage[] = [];
    const connector = createTwitchConnector({
      channel: 'streamer',
      onMessage: (message) => seen.push(message),
      onDelete: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    const socket = FakeSocket.last!;
    socket.onopen?.();
    socket.onmessage?.({
      data: '@badges=;display-name=Viewer;gifs=0-7|gif-1|http://cdn.example.com/native.gif;id=m2;user-id=u1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :fallback text\r\n',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].twitchGifs).toBeUndefined();
    expect(seen[0].text).toBe('fallback text');
    connector.stop();
  });
});
