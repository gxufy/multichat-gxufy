/* The paint rule on a running overlay: a Twitch chatter wearing a 7TV and a
 * JilTV paint shows the 7TV one, and the JilTV one once they pick it with
 * `!flosschat paint jiltv`, which the overlay remembers. Real runtime, Twitch
 * connector and 7TV event handling; only the network is faked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedMessage } from '@/lib/kick';

class FakeEventSource {
  static all: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener() {}
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
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

const JILTV_PAINT = {
  id: '01M5TCPBHMFJ8BX1VCFQWEP8ST',
  name: 'Android',
  texture: 'https://cdn.jiltv.app/paints/a.webp',
  fallback: '#5cae54ff',
  shadows: [],
};
const SEVENTV_PAINT = {
  id: '01SEVENTVPAINT',
  name: 'Red to blue',
  function: 'LINEAR_GRADIENT',
  angle: 90,
  repeat: false,
  stops: [{ at: 0, color: 0xff0000ff }, { at: 1, color: 0x0000ffff }],
  shadows: [],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_GXUFY_JILTV_COSMETICS', '1');
  FakeEventSource.all = [];
  FakeSocket.last = null;
  window.localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/jiltv/cosmetics?')) return json({ paints: { jilence: JILTV_PAINT } });
    if (url === 'https://api.7tv.app/v4/gql' && init?.method === 'POST') {
      /* Every chatter asked about wears the 7TV paint. */
      const users = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`u${i}`, { style: { paint: SEVENTV_PAINT } }]));
      return json({ data: { users } });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function overlay(query: Record<string, string> = {}) {
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
  let count = 0;
  return {
    stop,
    say: async (text: string) => {
      count += 1;
      socket.line(`@badges=;display-name=Jilence;id=m${count};user-id=438697907 :jilence!jilence@jilence.tmi.twitch.tv PRIVMSG #streamer :${text}`);
      await vi.advanceTimersByTimeAsync(3_000);
    },
    paintOf: (text: string) => shown.find((message) => (message.raw as { text?: string } | undefined)?.text === text)?.identity.background ?? '',
    presence: async () => {
      const events = FakeEventSource.all.find((source) => source.url.includes('7tv'))!;
      events.emit('dispatch', {
        type: 'entitlement.create',
        body: {
          object: {
            kind: 'PAINT',
            ref_id: SEVENTV_PAINT.id,
            user: { connections: [{ platform: 'TWITCH', id: '438697907' }] },
          },
        },
      });
      await vi.advanceTimersByTimeAsync(100);
    },
  };
}

describe('a chatter wearing a 7TV and a JilTV paint', () => {
  it('shows 7TV, then their own pick, remembered after a reload, until they say auto', async () => {
    const first = await overlay();
    await first.say('hi');
    expect(first.paintOf('hi')).toContain('linear-gradient');
    expect(first.paintOf('hi')).not.toContain('jiltv');

    await first.say('!flosschat paint jiltv');
    expect(first.paintOf('!flosschat paint jiltv')).toContain('cdn.jiltv.app');
    /* Already shown messages follow too. */
    expect(first.paintOf('hi')).toContain('cdn.jiltv.app');
    /* 7TV sending their cosmetics again (a presence) doesn't undo the pick. */
    await first.presence();
    expect(first.paintOf('hi')).toContain('cdn.jiltv.app');
    first.stop();

    const second = await overlay();
    await second.say('back');
    expect(second.paintOf('back')).toContain('cdn.jiltv.app');
    await second.say('!flosschat paint auto');
    expect(second.paintOf('back')).toContain('linear-gradient');
    expect(second.paintOf('back')).not.toContain('jiltv');
    second.stop();
  });

  it('shows only 7TV, and never asks JilTV, with JilTV Cosmetics off', async () => {
    const off = await overlay({ jiltvCosmeticsEnabled: 'false' });
    await off.say('hi');
    await off.say('!flosschat paint jiltv');
    expect(off.paintOf('hi')).toContain('linear-gradient');
    expect(off.paintOf('!flosschat paint jiltv')).not.toContain('jiltv');
    const asked = vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith('/api/jiltv/'));
    expect(asked).toBe(false);
    off.stop();
  });
});
