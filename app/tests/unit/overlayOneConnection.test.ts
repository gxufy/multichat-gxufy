/* A chat overlay showing Kick, Twitch, YouTube and TikTok keeps ONE connection
 * open to our server (lib/overlayEventStream), not one per stream: over
 * HTTP/1.1 a browser allows six per site, shared by every OBS browser source,
 * and four per overlay starved the rest (missing platforms, stalled counters,
 * pages that never loaded). Real connectors and refresh watcher; only the
 * network is faked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMultichatRuntime } from '@/lib/multichatRuntime';
import { OVERLAY_STREAM_GATHER_MS } from '@/lib/overlayEventStream';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

class FakeWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send() {}
  close() {}
}

const KICK_CHANNEL = {
  id: 875396,
  slug: 'adinross',
  user_id: 904404,
  chatroom: { id: 875062 },
  subscriber_badges: [],
  user: { id: 904404, username: 'adinross' },
  livestream: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://kick.com/api/v2/channels/adinross') && !url.includes('/messages')) {
      return new Response(JSON.stringify(KICK_CHANNEL), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ownServer = (source: FakeEventSource) => source.url.startsWith('/');

describe('a four-platform chat overlay', () => {
  it('keeps one connection to our server for all of its streams', async () => {
    const stop = startMultichatRuntime(
      { kick: 'adinross', twitch: 'ohnepixel', youtube: 'SymfuhnyTV', tiktok: 'realgrxnt', animation: 'none' },
      {
        onConfig: () => undefined,
        onLoaderPhase: () => undefined,
        onMessages: () => undefined,
        onFadingIds: () => undefined,
        onSharedChat: () => undefined,
        onError: () => undefined,
      },
    );
    expect(stop).not.toBeNull();
    /* Startup: the Kick channel lookup resolves, then streams are gathered. */
    await vi.advanceTimersByTimeAsync(2_000);

    const open = FakeEventSource.all.filter((source) => ownServer(source) && !source.closed);
    expect(open.map((source) => source.url.split('?')[0])).toEqual(['/api/overlay/stream']);
    const targets = new URLSearchParams(open[0]!.url.split('?')[1])
      .getAll('s')
      .map((entry) => entry.split('|')[2]!.split('?')[0])
      .sort();
    expect(targets).toEqual(['/api/kick/realtime', '/api/overlay/live', '/api/tiktok/chat', '/api/youtube/stream']);

    /* Every connection ever opened to our server was the shared one. */
    expect(FakeEventSource.all.filter(ownServer).every((source) => source.url.startsWith('/api/overlay/stream?'))).toBe(true);
    expect(OVERLAY_STREAM_GATHER_MS).toBeLessThan(2_000);

    stop!();
    expect(FakeEventSource.all.filter((source) => ownServer(source) && !source.closed)).toEqual([]);
  });
});
