/* Planned handover during a deploy (lib/server/drain): the copy that is about
   to stop reports unhealthy, then moves its long-lived streams, and overlays
   reconnect within about a second instead of backing off. */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';

const mocks = vi.hoisted(() => ({
  youtubeUnsubscribe: vi.fn(),
  tiktokUnsubscribe: vi.fn(),
  removeSink: vi.fn(),
}));
vi.mock('@/lib/server/youtubeHub', () => ({ subscribeYouTube: () => mocks.youtubeUnsubscribe }));
vi.mock('@/lib/tiktokHub', () => ({ subscribe: () => mocks.tiktokUnsubscribe }));
vi.mock('@/lib/server/overlayLiveHub', () => ({
  addOverlayLiveSink: vi.fn(async () => {}),
  overlayLiveHasRoom: () => true,
  parseOverlayChannelParams: () => [],
  removeOverlayLiveSink: mocks.removeSink,
}));

import {
  DRAIN_POLL_MS,
  DRAIN_STREAM_DELAY_MS,
  __resetDrainForTests,
  isDraining,
} from '@/lib/server/drain';
import healthHandler from '@/api/runtime/health';
import youTubeHandler, { resetYouTubeSseAdmissionForTests } from '@/api/youtube/stream';
import tikTokHandler, { resetTikTokSseAdmissionForTests } from '@/api/tiktok/chat';
import overlayLiveHandler, { __resetOverlayLiveLimitForTests } from '@/api/overlay/live';
import { createTikTokConnector } from '@/lib/connectors/tiktok';
import { createYouTubeConnector } from '@/lib/connectors/youtube';

class MockRequest extends EventEmitter {
  method = 'GET';
  headers: ApiRequest['headers'] = {};
  socket = { remoteAddress: '127.0.0.1' };
  constructor(public query: Record<string, string>) { super(); }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  body: unknown;
  chunks: string[] = [];
  writableEnded = false;
  setHeader() { return this; }
  status(code: number) { this.statusCode = code; return this; }
  json(value: unknown) { this.body = value; this.writableEnded = true; return this; }
  writeHead(code: number) { this.statusCode = code; return this; }
  flushHeaders() {}
  write(value: string) { this.chunks.push(value); return true; }
  end() {
    if (this.writableEnded) return this;
    this.writableEnded = true;
    this.emit('finish');
    this.emit('close');
    return this;
  }
}

type Handler = (req: ApiRequest, res: ApiResponse) => unknown;
async function invoke(handler: Handler, query: Record<string, string> = {}) {
  const req = new MockRequest(query);
  const res = new MockResponse();
  await handler(req as unknown as ApiRequest, res as unknown as ApiResponse);
  return res;
}

let dir = '';
let drainFile = '';
let base = 0;

function startDraining(atMs = base) {
  writeFileSync(drainFile, '');
  utimesSync(drainFile, atMs / 1000, atMs / 1000);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'drain-'));
  drainFile = path.join(dir, 'slot.draining');
  process.env.FLOSSCHAT_DRAIN_FILE = drainFile;
  base = Date.now();
  vi.useFakeTimers();
  vi.setSystemTime(base);
  __resetDrainForTests();
  resetYouTubeSseAdmissionForTests();
  resetTikTokSseAdmissionForTests();
  __resetOverlayLiveLimitForTests();
  mocks.youtubeUnsubscribe.mockReset();
  mocks.tiktokUnsubscribe.mockReset();
  mocks.removeSink.mockReset();
});

afterEach(() => {
  __resetDrainForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.FLOSSCHAT_DRAIN_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe('drain signal', () => {
  it('is off without a drain file, and ignores one left over from before this process started', async () => {
    expect(isDraining()).toBe(false);
    expect((await invoke(healthHandler as Handler)).statusCode).toBe(200);

    startDraining(base - process.uptime() * 1000 - 60_000);
    __resetDrainForTests();
    expect(isDraining()).toBe(false);
    expect((await invoke(healthHandler as Handler)).statusCode).toBe(200);
  });

  it('keeps a new copy out of rotation while the deploy holds it', async () => {
    const hold = path.join(dir, 'slot.hold');
    process.env.FLOSSCHAT_HOLD_FILE = hold;
    writeFileSync(hold, '');
    const held = await invoke(healthHandler as Handler);
    expect(held.statusCode).toBe(503);
    expect(held.body).toEqual({ status: 'held' });
    rmSync(hold);
    expect((await invoke(healthHandler as Handler)).statusCode).toBe(200);
    delete process.env.FLOSSCHAT_HOLD_FILE;
  });

  it('reports unhealthy as soon as the deploy starts draining this copy', async () => {
    startDraining();
    __resetDrainForTests();
    const res = await invoke(healthHandler as Handler);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ status: 'draining' });
  });
});

describe('streams move only after Caddy has had time to notice', () => {
  it('YouTube and TikTok streams send "moving" and close; overlay control ends with a short retry', async () => {
    const youtube = await invoke(youTubeHandler as Handler, { channel: 'IShowSpeed', since: '1' });
    const tiktok = await invoke(tikTokHandler as Handler, { user: 'gxufy', since: '1' });
    const live = await invoke(overlayLiveHandler as Handler);
    /* A real server has long since started; record that before the fake clock moves. */
    expect(isDraining()).toBe(false);

    startDraining();
    await vi.advanceTimersByTimeAsync(DRAIN_STREAM_DELAY_MS - DRAIN_POLL_MS);
    /* Still open: new visitors are already going elsewhere, streams wait. */
    expect(youtube.writableEnded || tiktok.writableEnded || live.writableEnded).toBe(false);

    await vi.advanceTimersByTimeAsync(DRAIN_POLL_MS * 2);
    expect(youtube.chunks).toContain('data: {"type":"moving"}\n\n');
    expect(tiktok.chunks).toContain('data: {"type":"moving"}\n\n');
    expect(youtube.writableEnded && tiktok.writableEnded).toBe(true);
    expect(mocks.youtubeUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.tiktokUnsubscribe).toHaveBeenCalledTimes(1);
    expect(live.chunks).toContain('retry: 500\n\n');
    expect(live.writableEnded).toBe(true);
    expect(mocks.removeSink).toHaveBeenCalled();
  });

  it('does nothing to streams when no deploy is draining this copy', async () => {
    const youtube = await invoke(youTubeHandler as Handler, { channel: 'IShowSpeed', since: '1' });
    await vi.advanceTimersByTimeAsync(DRAIN_STREAM_DELAY_MS * 3);
    expect(youtube.writableEnded).toBe(false);
    expect(youtube.chunks.join('')).not.toContain('moving');
  });
});

class FakeEventSource {
  static OPEN = 1;
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  emit(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { this.closed = true; }
}

describe('overlays reconnect within about a second after "moving"', () => {
  beforeEach(() => {
    FakeEventSource.instances.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('TikTok', async () => {
    const connector = createTikTokConnector({
      channel: '@gxufy', onMessage: () => {}, onDelete: () => {}, onStatus: () => {},
    });
    connector.start();
    FakeEventSource.instances[0]!.emit({ type: 'moving' });
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain('/api/tiktok/chat');
    connector.stop();
  });

  it('YouTube', async () => {
    const connector = createYouTubeConnector({
      channel: 'IShowSpeed', onMessage: () => {}, onDelete: () => {}, onStatus: () => {},
    });
    connector.start();
    FakeEventSource.instances[0]!.emit({ type: 'moving' });
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain('/api/youtube/stream');
    connector.stop();
  });
});
