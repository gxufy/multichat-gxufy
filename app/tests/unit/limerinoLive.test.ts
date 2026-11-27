// @vitest-environment node
/* Limerino's live badge feed on the server (lib/server/limerinoLive), the
   overlay connection that carries it, and the picked-badge rule. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIMERINO_EVENTS_URL,
  LIMERINO_LIVE_BATCH_MS,
  LIMERINO_LIVE_DEFAULT_RETRY_MS,
  LIMERINO_LIVE_IDLE_CHECK_MS,
  LIMERINO_LIVE_IDLE_STOP_MS,
  LIMERINO_LIVE_SILENCE_MS,
  createSseReader,
  limerinoLiveRunning,
  startLimerinoLiveForTests,
  stopLimerinoLiveForTests,
  type LimerinoLiveUpdate,
} from '@/lib/server/limerinoLive';
import {
  LIMERINO_CATALOG_URL,
  LIMERINO_HOLDERS_URL,
  limerinoBadgesVersion,
  limerinoCachedEtags,
  loadLimerinoBadges,
  resetLimerinoBadgeCacheForTests,
} from '@/lib/server/limerinoBadges';
import {
  __resetOverlayLiveHubForTests,
  addOverlayLiveSink,
  broadcastOverlayBadgeEvent,
  overlayLiveBadgeConnectionCount,
} from '@/lib/server/overlayLiveHub';

const files = [18, 36, 54, 72].map((width) => ({ name: `${width / 18}x.png`, width, height: width, frame_count: 1, format: 'PNG' }));
const badge = (id: string) => ({
  id, kind: 'BADGE',
  data: { tooltip: `${id} badge`, host: { url: `//api.limerino.com/v1/badges/art/${id}/1`, files } },
});

let catalogIds: string[];
let catalogEtag: string;
let holders: Record<string, string[]>;
let holdersEtag: string;

class FakeStream {
  controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly stream = new ReadableStream<Uint8Array>({ start: (controller) => { this.controller = controller; } });
  send(text: string) { this.controller.enqueue(new TextEncoder().encode(text)); }
  end() { this.controller.close(); }
}

let streams: FakeStream[];
let eventReplies: (() => Response)[];
let fetchMock: ReturnType<typeof vi.fn>;
let broadcasts: LimerinoLiveUpdate[];
let connections: number;

function json(body: unknown, etag: string): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag } });
}

function install() {
  streams = [];
  eventReplies = [];
  broadcasts = [];
  connections = 1;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === LIMERINO_EVENTS_URL) {
      const queued = eventReplies.shift();
      if (queued) return queued();
      const stream = new FakeStream();
      streams.push(stream);
      init?.signal?.addEventListener('abort', () => {
        try { stream.controller.error(new Error('aborted')); } catch { /* closed */ }
      });
      return new Response(stream.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url === LIMERINO_CATALOG_URL) return json({ badges: catalogIds.map(badge) }, catalogEtag);
    if (url === LIMERINO_HOLDERS_URL) return json({ users: holders }, holdersEtag);
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

const calls = (url: string) => fetchMock.mock.calls.filter(([input]) => String(input) === url).length;
const tick = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
const sync = (catalog: string, holdersTag: string) => `event: sync\ndata: ${JSON.stringify({ catalog, holders: holdersTag })}\n\n`;
const patch = (users: Record<string, string[]>) => `event: holders\ndata: ${JSON.stringify({ etag: '"h-new"', users })}\n\n`;

function startLive() {
  startLimerinoLiveForTests({
    fetch: fetchMock as unknown as typeof fetch,
    broadcast: (update) => { broadcasts.push(update); },
    connections: () => connections,
    random: () => 0,
  });
}

async function shownBy(userId: string): Promise<string[]> {
  return (await loadLimerinoBadges()).filter((record) => record.users.includes(userId)).map((record) => record.id);
}

beforeEach(() => {
  vi.useFakeTimers();
  catalogIds = ['first', 'second'];
  catalogEtag = '"cat-1"';
  holders = { 42: ['second'], 777: ['first', 'second'] };
  holdersEtag = '"hold-1"';
  resetLimerinoBadgeCacheForTests();
  install();
});

afterEach(() => {
  stopLimerinoLiveForTests();
  __resetOverlayLiveHubForTests();
  resetLimerinoBadgeCacheForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reading server-sent events', () => {
  it('handles split lines, \\r\\n, comments, retry and several data lines', () => {
    const events: { event: string; data: string }[] = [];
    const retries: number[] = [];
    let comments = 0;
    const feed = createSseReader({ onEvent: (e) => events.push(e), onRetry: (ms) => retries.push(ms), onComment: () => { comments += 1; } });
    feed('retry: 7312\r\n\r\n: heartbeat\r');
    feed('\n\r\nevent: sync\r\ndata: {"a":');
    feed('1}\r');
    feed('\n\r\ndata: one\ndata: two\n\nevent:holders\ndata:x\n\n');
    expect(retries).toEqual([7312]);
    expect(comments).toBe(1);
    expect(events).toEqual([
      { event: 'sync', data: '{"a":1}' },
      { event: 'message', data: 'one\ntwo' },
      { event: 'holders', data: 'x' },
    ]);
  });

  it('drops an event that is far too big, and carries on', () => {
    const events: string[] = [];
    const feed = createSseReader({ onEvent: (e) => events.push(e.data) }, 50);
    feed(`data: ${'x'.repeat(80)}\n\ndata: small\n\n`);
    expect(events).toEqual(['small']);
  });
});

describe('the server keeps one live stream to Limerino', () => {
  it('opens the stream and loads the list on the first sync, without telling overlays (they have their own)', async () => {
    startLive();
    await tick();
    expect(calls(LIMERINO_EVENTS_URL)).toBe(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    streams[0].send(sync('"cat-1"', '"hold-1"'));
    await tick();
    expect(calls(LIMERINO_CATALOG_URL)).toBe(1);
    expect(calls(LIMERINO_HOLDERS_URL)).toBe(1);
    expect(broadcasts).toEqual([]);
  });

  it('does nothing on a sync whose ETags match the held lists (weak or not)', async () => {
    await loadLimerinoBadges();
    startLive();
    await tick();
    streams[0].send(sync('W/"cat-1"', '"hold-1"'));
    await tick();
    expect(calls(LIMERINO_CATALOG_URL)).toBe(1);
    expect(broadcasts).toEqual([]);
  });

  it('applies a holders patch at once and passes it on once a second: the badge each user now shows, or none', async () => {
    await loadLimerinoBadges();
    expect(await shownBy('777')).toEqual(['first']);
    startLive();
    await tick();
    streams[0].send(patch({ 42: ['first'], 777: ['second', 'first'], 9001: ['unknown', 'second'], 5: [] }));
    await tick();
    expect(await shownBy('42')).toEqual(['first']);
    expect(await shownBy('777')).toEqual(['second']);
    expect(await shownBy('9001')).toEqual(['second']);
    expect(limerinoCachedEtags().holders).toBe('');
    expect(broadcasts).toEqual([]);
    streams[0].send(patch({ 42: [] }));
    await tick(LIMERINO_LIVE_BATCH_MS);
    expect(broadcasts).toEqual([{ t: 'patch', users: { 42: null, 777: 'second', 9001: 'second', 5: null } }]);
    expect(await shownBy('42')).toEqual([]);
    expect(calls(LIMERINO_CATALOG_URL)).toBe(1);
  });

  it('tells overlays to reload when the catalog changes', async () => {
    await loadLimerinoBadges();
    const before = limerinoBadgesVersion();
    startLive();
    await tick();
    catalogIds = ['first', 'second', 'third'];
    catalogEtag = '"cat-2"';
    streams[0].send(sync('"cat-2"', '"hold-1"'));
    await tick();
    expect(calls(LIMERINO_CATALOG_URL)).toBe(2);
    expect(limerinoBadgesVersion()).toBeGreaterThan(before);
    expect(broadcasts).toEqual([{ t: 'reload', v: limerinoBadgesVersion() }]);
  });

  it('loads the list instead of patching when it holds none yet', async () => {
    startLive();
    await tick();
    streams[0].send(patch({ 42: ['first'] }));
    await tick();
    expect(calls(LIMERINO_CATALOG_URL)).toBe(1);
    expect(broadcasts).toEqual([]);
  });

  it('reconnects after the stream\'s own retry delay when it ends', async () => {
    startLive();
    await tick();
    streams[0].send('retry: 5000\n\n');
    await tick();
    streams[0].end();
    await tick(4_900);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(1);
    await tick(200);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(2);
  });

  it('waits retry-after (or 60 s) after a refusal, doubling each time', async () => {
    eventReplies.push(
      () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '90' } }),
      () => new Response(JSON.stringify({ error: 'badges_unavailable' }), { status: 503 }),
    );
    startLive();
    await tick();
    expect(calls(LIMERINO_EVENTS_URL)).toBe(1);
    await tick(89_000);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(1);
    await tick(1_000);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(2);
    await tick(119_000);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(2);
    await tick(1_000);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(3);
    expect(streams).toHaveLength(1);
  });

  it('keeps a stream with heartbeats, and reopens one that goes silent for a minute', async () => {
    startLive();
    await tick();
    for (let i = 0; i < 5; i += 1) {
      await tick(20_000);
      streams[0].send(': heartbeat\n\n');
    }
    await tick();
    expect(calls(LIMERINO_EVENTS_URL)).toBe(1);
    await tick(LIMERINO_LIVE_SILENCE_MS);
    await tick(LIMERINO_LIVE_DEFAULT_RETRY_MS);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(2);
  });

  it('closes the stream two minutes after the last overlay showing badges leaves', async () => {
    startLive();
    await tick();
    connections = 0;
    await tick(LIMERINO_LIVE_IDLE_STOP_MS - LIMERINO_LIVE_IDLE_CHECK_MS);
    expect(limerinoLiveRunning()).toBe(true);
    await tick(LIMERINO_LIVE_IDLE_CHECK_MS * 2);
    expect(limerinoLiveRunning()).toBe(false);
    const opened = calls(LIMERINO_EVENTS_URL);
    expect(streams.at(-1)!.controller.desiredSize).toBe(null);
    await tick(10 * 60_000);
    expect(calls(LIMERINO_EVENTS_URL)).toBe(opened);
  });
});

describe('the overlay connection carries badge changes only to chat overlays that asked', () => {
  it('sends the limerino event to b=1 connections only', async () => {
    const withBadges = { chunks: [] as string[], write(chunk: string) { this.chunks.push(chunk); }, end() {} };
    const counter = { chunks: [] as string[], write(chunk: string) { this.chunks.push(chunk); }, end() {} };
    await addOverlayLiveSink(withBadges, 'a', [], true);
    await addOverlayLiveSink(counter, 'b', [], false);
    expect(overlayLiveBadgeConnectionCount()).toBe(1);
    expect(broadcastOverlayBadgeEvent('limerino', { t: 'patch', users: { 42: 'first' } })).toBe(1);
    expect(withBadges.chunks.at(-1)).toBe('event: limerino\ndata: {"t":"patch","users":{"42":"first"}}\n\n');
    expect(counter.chunks.some((chunk) => chunk.includes('limerino'))).toBe(false);
    expect(broadcastOverlayBadgeEvent('bad\nname', {})).toBe(0);
  });
});
