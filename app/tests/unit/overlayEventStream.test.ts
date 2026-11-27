/* The browser half of the one-stream-per-overlay connection
 * (lib/overlayEventStream): stand-ins that behave as EventSources for each
 * overlay stream, sharing one real connection. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_STREAM_GATHER_MS,
  OVERLAY_STREAM_RETRY_START_MS,
  openOverlayEventSource,
  startOverlayStreamMux,
} from '@/lib/overlayEventStream';

class FakeEventSource {
  static all: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly named = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.named.set(type, [...(this.named.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  /* Test helpers. */
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  frame(key: string, event: string, data = '', id = '') {
    this.onmessage?.(new MessageEvent('message', { data: `${key}\t${event}\t${id}\t${data}` }));
  }
  fail(state = 0) {
    this.readyState = state;
    this.onerror?.(new Event('error'));
  }
  subs(): Array<{ key: string; lastEventId: string; target: string }> {
    return new URLSearchParams(this.url.split('?')[1]).getAll('s').map((entry) => {
      const [key, lastEventId, ...target] = entry.split('|');
      return { key: key!, lastEventId: lastEventId!, target: target.join('|') };
    });
  }
  keyFor(path: string): string {
    return this.subs().find((sub) => sub.target.startsWith(path))!.key;
  }
}

const shared = () => FakeEventSource.all.filter((source) => source.url.startsWith('/api/overlay/stream?') && !source.closed);
const latest = () => shared().at(-1)!;

let stop: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  stop();
  stop = () => {};
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start() {
  stop = startOverlayStreamMux();
}

describe('overlay streams', () => {
  it('without the mux, is a plain EventSource', () => {
    const source = openOverlayEventSource('/api/tiktok/chat?user=a');
    expect(source).toBeInstanceOf(FakeEventSource);
    expect((source as unknown as FakeEventSource).url).toBe('/api/tiktok/chat?user=a');
  });

  it('uses a plain EventSource for anything but the overlay streams', () => {
    start();
    const other = openOverlayEventSource('https://events.7tv.io/v3@x');
    expect(other).toBeInstanceOf(FakeEventSource);
  });

  it('shares one connection between all of an overlay\'s streams', () => {
    start();
    const live = openOverlayEventSource('/api/overlay/live?c=twitch%3Ax&b=1');
    const youtube = openOverlayEventSource('/api/youtube/stream?channel=y&since=1');
    const tiktok = openOverlayEventSource('/api/tiktok/chat?user=t&since=1');
    const kick = openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    expect(FakeEventSource.all).toHaveLength(0);
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    expect(FakeEventSource.all).toHaveLength(1);
    const stream = latest();
    expect(stream.subs().map((sub) => sub.target)).toEqual([
      '/api/overlay/live?c=twitch%3Ax&b=1',
      '/api/youtube/stream?channel=y&since=1',
      '/api/tiktok/chat?user=t&since=1',
      '/api/kick/realtime?channelId=1&chatroomId=2',
    ]);

    const opened: string[] = [];
    const messages: string[] = [];
    const states: string[] = [];
    youtube.onopen = () => opened.push('youtube');
    youtube.onmessage = (event) => messages.push(`youtube ${event.data}`);
    tiktok.onmessage = (event) => messages.push(`tiktok ${event.data}`);
    kick.onmessage = (event) => messages.push(`kick ${event.data} #${event.lastEventId}`);
    live.addEventListener('state', (event) => states.push(event.data));

    stream.open();
    stream.frame(stream.keyFor('/api/youtube/stream'), '.open');
    stream.frame(stream.keyFor('/api/overlay/live'), '.open');
    expect(youtube.readyState).toBe(1);
    expect(tiktok.readyState).toBe(0);
    expect(opened).toEqual(['youtube']);
    stream.frame(stream.keyFor('/api/youtube/stream'), 'message', '{"a":1}');
    stream.frame(stream.keyFor('/api/tiktok/chat'), 'message', '{"b":2}', '3000');
    stream.frame(stream.keyFor('/api/kick/realtime'), 'message', '{"c":3}', '42');
    stream.frame(stream.keyFor('/api/overlay/live'), 'state', '{"token":1}');
    stream.frame('zz', 'message', 'nobody');
    expect(messages).toEqual(['youtube {"a":1}', 'tiktok {"b":2}', 'kick {"c":3} #42']);
    expect(states).toEqual(['{"token":1}']);
  });

  it('a stream that is closed leaves; the others carry on unaware and resume where they were', () => {
    start();
    const youtube = openOverlayEventSource('/api/youtube/stream?channel=y&since=1');
    const kick = openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    const first = latest();
    first.open();
    first.frame(first.keyFor('/api/kick/realtime'), '.open');
    first.frame(first.keyFor('/api/kick/realtime'), 'message', '{}', '77');
    const errors: string[] = [];
    let opens = 0;
    kick.onerror = () => errors.push('kick');
    kick.onopen = () => { opens += 1; };

    youtube.close();
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    expect(first.closed).toBe(true);
    const second = latest();
    expect(second.subs()).toEqual([{ key: first.keyFor('/api/kick/realtime'), lastEventId: '77', target: '/api/kick/realtime?channelId=1&chatroomId=2' }]);
    second.open();
    second.frame(second.keyFor('/api/kick/realtime'), '.open');
    expect(errors).toEqual([]);
    expect(opens).toBe(0);
    expect(kick.readyState).toBe(1);
  });

  it('a refused stream errors and stays closed, as an EventSource does', () => {
    start();
    const tiktok = openOverlayEventSource('/api/tiktok/chat?user=t');
    const kick = openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    const stream = latest();
    stream.open();
    let errors = 0;
    tiktok.onerror = () => { errors += 1; };
    stream.frame(stream.keyFor('/api/tiktok/chat'), '.error', '503 30');
    expect(errors).toBe(1);
    expect(tiktok.readyState).toBe(2);
    /* Nothing else changes: the refused one is simply not asked for again. */
    vi.advanceTimersByTime(60_000);
    expect(shared()).toEqual([stream]);
    expect(kick.readyState).toBe(0);
  });

  it('a stream that ends errors, then comes back after its delay', () => {
    start();
    const live = openOverlayEventSource('/api/overlay/live?c=twitch%3Ax');
    openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    const stream = latest();
    stream.open();
    stream.frame(stream.keyFor('/api/overlay/live'), '.open');
    let errors = 0;
    live.addEventListener('error' as string, () => { errors += 1; });
    stream.frame(stream.keyFor('/api/overlay/live'), '.end', '500');
    expect(errors).toBe(1);
    expect(live.readyState).toBe(0);
    vi.advanceTimersByTime(499);
    expect(shared()).toEqual([stream]);
    vi.advanceTimersByTime(1 + OVERLAY_STREAM_GATHER_MS);
    expect(stream.closed).toBe(true);
    expect(latest().subs().map((sub) => sub.target)).toEqual([
      '/api/overlay/live?c=twitch%3Ax',
      '/api/kick/realtime?channelId=1&chatroomId=2',
    ]);
  });

  it('a dropped connection errors every stream on it, then reconnects with backoff', () => {
    start();
    const tiktok = openOverlayEventSource('/api/tiktok/chat?user=t');
    const kick = openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    const stream = latest();
    stream.open();
    const errors: string[] = [];
    /* A connector that closes on error (and reconnects itself). */
    tiktok.onerror = () => { errors.push('tiktok'); tiktok.close(); };
    /* As the connectors do on the shared stream: wait for it to reconnect. */
    kick.onerror = () => errors.push('kick');
    stream.fail();
    expect(errors).toEqual(['tiktok', 'kick']);
    expect(kick.readyState).toBe(0);
    expect(kick.sharedReconnect).toBe(true);
    vi.advanceTimersByTime(OVERLAY_STREAM_RETRY_START_MS - 1);
    expect(shared()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(latest().subs().map((sub) => sub.target)).toEqual(['/api/kick/realtime?channelId=1&chatroomId=2']);
    latest().fail();
    vi.advanceTimersByTime(OVERLAY_STREAM_RETRY_START_MS);
    expect(shared()).toEqual([]);
    vi.advanceTimersByTime(OVERLAY_STREAM_RETRY_START_MS);
    expect(shared()).toHaveLength(1);
  });

  it('falls back to one connection per stream when the shared one is not there', () => {
    start();
    const youtube = openOverlayEventSource('/api/youtube/stream?channel=y');
    const live = openOverlayEventSource('/api/overlay/live?c=twitch%3Ax');
    const states: string[] = [];
    live.addEventListener('state', (event) => states.push(event.data));
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    latest().fail(2);
    const natives = FakeEventSource.all.filter((source) => !source.url.startsWith('/api/overlay/stream'));
    expect(natives.map((source) => source.url)).toEqual(['/api/youtube/stream?channel=y', '/api/overlay/live?c=twitch%3Ax']);
    const got: string[] = [];
    youtube.onmessage = (event) => got.push(event.data);
    natives[0]!.onmessage!(new MessageEvent('message', { data: 'hello' }));
    natives[1]!.named.get('state')![0]!(new MessageEvent('state', { data: '{"token":2}' }));
    expect(got).toEqual(['hello']);
    expect(states).toEqual(['{"token":2}']);
    /* On its own connection, a dropped stream is the connector's to back off. */
    expect(youtube.sharedReconnect).toBe(false);
    /* Later streams go straight to their own connection too. */
    const tiktok = openOverlayEventSource('/api/tiktok/chat?user=t');
    expect(FakeEventSource.all.at(-1)!.url).toBe('/api/tiktok/chat?user=t');
    tiktok.close();
    expect(FakeEventSource.all.at(-1)!.closed).toBe(true);
  });

  it('a handover reconnects at once, without errors', () => {
    start();
    const kick = openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    const stream = latest();
    stream.open();
    stream.frame(stream.keyFor('/api/kick/realtime'), '.open');
    stream.frame(stream.keyFor('/api/kick/realtime'), 'message', '{}', '9');
    let errors = 0;
    kick.onerror = () => { errors += 1; };
    stream.frame('*', '.move', '500');
    expect(stream.closed).toBe(true);
    vi.advanceTimersByTime(500);
    expect(latest().subs()[0]!.lastEventId).toBe('9');
    expect(errors).toBe(0);
  });

  it('stopping ends every stream', () => {
    start();
    const kick = openOverlayEventSource('/api/kick/realtime?channelId=1&chatroomId=2');
    vi.advanceTimersByTime(OVERLAY_STREAM_GATHER_MS);
    const stream = latest();
    stop();
    stop = () => {};
    expect(stream.closed).toBe(true);
    expect(kick.readyState).toBe(2);
    /* And the next page's streams are plain again. */
    expect(openOverlayEventSource('/api/tiktok/chat?user=t')).toBeInstanceOf(FakeEventSource);
  });
});
