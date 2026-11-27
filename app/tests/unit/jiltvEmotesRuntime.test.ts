/* JilTV emotes on a running overlay: never asked for unless the link turns
 * them on; shown in Twitch messages when on, with or without 7TV emotes.
 * Real runtime and Twitch connector; only the network is faked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedMessage } from '@/lib/kick';
import { clearDrawn, drawParts } from '../fixtures/drawParts';

afterEach(clearDrawn);

class FakeEventSource {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send() {}
  close() {}
  line(text: string) {
    this.onmessage?.({ data: `${text}\r\n` });
  }
}

const CDN = 'https://cdn.jiltv.app/emotes';
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeSocket.last = null;
  window.localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('WebSocket', FakeSocket);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://api.jiltv.app/v1/sets/global') return json({ sets: [], cdn: CDN });
    if (url === 'https://api.jiltv.app/v1/channels/twitch/1234/bootstrap') {
      return json({ set: { emotes: [{ id: '01M5FQEEW4EM9T7GPPQ4XBB45E', name: 'ApuGuitar', v: 2, w: 32, h: 32, f: 1 }] }, cdn: CDN });
    }
    if (url.startsWith('/api/twitch/emote-resources?channelId=')) {
      return json({ bttvGlobal: [{ id: '5e76d338d6581c3724c0f0b9', code: 'bttvHey' }] });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function overlay(query: Record<string, string>) {
  const { startMultichatRuntime } = await import('@/lib/multichatRuntime');
  let shown: ParsedMessage[] = [];
  const stop = startMultichatRuntime(
    { twitch: 'streamer', animation: 'none', ...query },
    {
      onConfig: () => undefined,
      onLoaderPhase: () => undefined,
      onMessages: (messages) => { shown = messages; },
      onFadingIds: () => undefined,
      onSharedChat: () => undefined,
      onError: () => undefined,
    },
  )!;
  await vi.advanceTimersByTimeAsync(50);
  const socket = FakeSocket.last!;
  socket.onopen?.();
  socket.line('@room-id=1234 :tmi.twitch.tv ROOMSTATE #streamer');
  await vi.advanceTimersByTimeAsync(500);
  socket.line('@badges=;display-name=Viewer;id=m1;user-id=99 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :ApuGuitar bttvHey');
  await vi.advanceTimersByTimeAsync(3_000);
  const message = shown.find((row) => row.id.includes('m1'))!;
  const { container } = drawParts(message.message);
  stop();
  return {
    images: [...container.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? ''),
    askedJilTV: fetchMock.mock.calls.some(([input]) => String(input).includes('jiltv.app')),
  };
}

describe('JilTV emotes on the overlay', () => {
  it('are never asked for when the link does not turn them on', async () => {
    const { images, askedJilTV } = await overlay({});
    expect(askedJilTV).toBe(false);
    expect(images.some((src) => src.includes('cdn.jiltv.app'))).toBe(false);
    expect(images.some((src) => src.includes('betterttv'))).toBe(true);
  });

  it('show in Twitch messages alongside the other emotes when turned on', async () => {
    const { images, askedJilTV } = await overlay({ jiltvEmotesEnabled: 'true' });
    expect(askedJilTV).toBe(true);
    expect(images).toContain(`${CDN}/01M5FQEEW4EM9T7GPPQ4XBB45E/2/2x.webp`);
    expect(images.some((src) => src.includes('betterttv'))).toBe(true);
  });

  it('show on their own when 7TV emotes are off', async () => {
    const { images } = await overlay({ jiltvEmotesEnabled: 'true', sevenTVEmotesEnabled: 'false' });
    expect(images).toEqual([`${CDN}/01M5FQEEW4EM9T7GPPQ4XBB45E/2/2x.webp`]);
  });
});
