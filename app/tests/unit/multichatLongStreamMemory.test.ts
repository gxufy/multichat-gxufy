/* A long stream must not leave behind one entry per message in any of the
 * overlay engine's maps or sets: everything per message is dropped once the
 * message leaves the (100-row) list. One chatter sends every message, so
 * per-chatter memory stays at one entry and anything that grows is per
 * message. Real runtime and Twitch connector; only the network is faked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedMessage } from '@/lib/kick';

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

/* Every Map and Set the overlay's own code creates, module-level ones included. */
const tracked: Array<{ collection: Map<unknown, unknown> | Set<unknown>; where: string }> = [];
function fromOverlayCode(stack: string | undefined): string | null {
  const line = stack?.split('\n').slice(2).find((entry) => /[\\/]src[\\/]lib[\\/]/.test(entry));
  return line ? line.trim() : null;
}
class TrackedMap<K, V> extends Map<K, V> {
  constructor(entries?: Iterable<readonly [K, V]> | null) {
    super(entries);
    const where = fromOverlayCode(new Error().stack);
    if (where) tracked.push({ collection: this, where });
  }
}
class TrackedSet<T> extends Set<T> {
  constructor(values?: Iterable<T> | null) {
    super(values);
    const where = fromOverlayCode(new Error().stack);
    if (where) tracked.push({ collection: this, where });
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  tracked.length = 0;
  FakeSocket.last = null;
  vi.useFakeTimers();
  vi.resetModules();
  window.localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => json({})));
  vi.stubGlobal('Map', TrackedMap);
  vi.stubGlobal('Set', TrackedSet);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a long stream', () => {
  for (const [name, extra] of [
    ['no fade', {}],
    ['fade after 20 s', { fade: '20' }],
  ] as const) {
    it(`keeps nothing per message once it has left the list (${name})`, async () => {
      const { startMultichatRuntime } = await import('@/lib/multichatRuntime');
      let shown: ParsedMessage[] = [];
      const stop = startMultichatRuntime(
        { twitch: 'streamer', animation: 'none', ...extra },
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

      /* Fixed tables (e.g. the emoji art list) are full from the start: only
         what is added from here on counts. */
      const before = new Map(tracked.map(({ collection }) => [collection, collection.size]));

      /* 50 messages a second for a simulated minute. */
      const TOTAL = 3_000;
      for (let i = 1; i <= TOTAL; i += 1) {
        socket.line(`@badges=;color=#FF0000;display-name=Viewer;id=m${i};user-id=111 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :message ${i} @viewer hello`);
        if (i % 50 === 0) await vi.advanceTimersByTimeAsync(1_000);
      }
      await vi.advanceTimersByTimeAsync(2_000);

      /* The overlay is still showing the newest messages. */
      expect(shown.at(-1)?.id).toBe(`twitch:m${TOTAL}`);
      const largest = tracked
        .map(({ collection, where }) => ({ size: collection.size - (before.get(collection) ?? 0), where }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 3);
      expect(tracked.length).toBeGreaterThan(0);
      /* The largest by design: the Twitch connector keeps its last 250
         messages for late updates. A per-message leak holds 3,000. */
      expect(largest[0]!.size, JSON.stringify(largest)).toBeLessThanOrEqual(300);
      stop();
    });
  }
});
