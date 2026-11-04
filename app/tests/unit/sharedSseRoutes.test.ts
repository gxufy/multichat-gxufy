import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const hubs = vi.hoisted(() => ({
  tiktokSubscribe: vi.fn(),
  youtubeSubscribe: vi.fn(),
  tiktokUnsubscribes: [] as Array<ReturnType<typeof vi.fn>>,
  youtubeUnsubscribes: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock('@/lib/tiktokHub', () => ({ subscribe: hubs.tiktokSubscribe }));
vi.mock('@/lib/server/youtubeHub', () => ({ subscribeYouTube: hubs.youtubeSubscribe }));

import tikTokHandler, {
  resetTikTokSseAdmissionForTests,
} from '@/pages/api/tiktok/chat';
import youTubeHandler, {
  resetYouTubeSseAdmissionForTests,
} from '@/pages/api/youtube/stream';
import { SharedSseCapacityError } from '@/lib/server/sharedSseAdmission';

class MockRequest extends EventEmitter {
  method = 'GET';
  query: Record<string, string | string[]>;
  headers: NextApiRequest['headers'] = {};
  socket: { remoteAddress?: string } = { remoteAddress: '127.0.0.1' };

  constructor(query: Record<string, string | string[]>) {
    super();
    this.query = query;
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();
  chunks: string[] = [];
  writableEnded = false;

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.body = value;
    this.writableEnded = true;
    return this;
  }

  writeHead(code: number, headers: Record<string, string>) {
    this.statusCode = code;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    return this;
  }

  flushHeaders() {}

  write(value: string) {
    this.chunks.push(value);
    return true;
  }

  end() {
    if (this.writableEnded) return this;
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }
}

type SseHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
) => unknown | Promise<unknown>;

async function invoke(
  handler: SseHandler,
  query: Record<string, string | string[]>,
  remoteAddress = '127.0.0.1',
) {
  const req = new MockRequest(query);
  req.socket.remoteAddress = remoteAddress;
  const res = new MockResponse();
  await handler(
    req as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return { req, res };
}

const originalVercel = process.env.VERCEL;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.VERCEL;
  resetTikTokSseAdmissionForTests();
  resetYouTubeSseAdmissionForTests();
  hubs.tiktokUnsubscribes = [];
  hubs.youtubeUnsubscribes = [];
  hubs.tiktokSubscribe.mockReset().mockImplementation((_channel, send) => {
    const unsubscribe = vi.fn();
    hubs.tiktokUnsubscribes.push(unsubscribe);
    send({ type: 'status', status: 'connecting' }, '{"type":"status","status":"connecting"}');
    return unsubscribe;
  });
  hubs.youtubeSubscribe.mockReset().mockImplementation((_channel, send) => {
    const unsubscribe = vi.fn();
    hubs.youtubeUnsubscribes.push(unsubscribe);
    send({ type: 'status', status: 'connecting' }, '{"type":"status","status":"connecting"}');
    return unsubscribe;
  });
});

afterEach(() => {
  resetTikTokSseAdmissionForTests();
  resetYouTubeSseAdmissionForTests();
  vi.useRealTimers();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe('bounded shared SSE routes', () => {
  it('rejects unsupported methods before either hub is touched', async () => {
    const tiktok = new MockRequest({ user: 'streamer' });
    tiktok.method = 'POST';
    const tiktokResponse = new MockResponse();
    await tikTokHandler(
      tiktok as unknown as NextApiRequest,
      tiktokResponse as unknown as NextApiResponse,
    );
    expect(tiktokResponse.statusCode).toBe(405);
    expect(tiktokResponse.headers.get('allow')).toBe('GET');

    const youtube = new MockRequest({ channel: 'streamer' });
    youtube.method = 'POST';
    const youtubeResponse = new MockResponse();
    await youTubeHandler(
      youtube as unknown as NextApiRequest,
      youtubeResponse as unknown as NextApiResponse,
    );
    expect(youtubeResponse.statusCode).toBe(405);
    expect(hubs.tiktokSubscribe).not.toHaveBeenCalled();
    expect(hubs.youtubeSubscribe).not.toHaveBeenCalled();
  });

  it('queues synchronous TikTok replay until SSE headers exist and cleans up once', async () => {
    const { req, res } = await invoke(tikTokHandler, { user: 'streamer' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.chunks).toEqual([
      'data: {"type":"status","status":"connecting"}\n\n',
    ]);
    expect(vi.getTimerCount()).toBe(1);

    req.emit('aborted');
    req.emit('close');
    res.emit('close');
    expect(hubs.tiktokUnsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('formats YouTube SSE replay and releases the subscriber on response error', async () => {
    const { res } = await invoke(youTubeHandler, { channel: 'streamer' });
    expect(res.statusCode).toBe(200);
    expect(res.chunks).toEqual([
      'data: {"type":"status","status":"connecting"}\n\n',
    ]);
    res.emit('error', new Error('socket closed'));
    expect(hubs.youtubeUnsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases subscriber capacity on normal response teardown', async () => {
    const { res } = await invoke(youTubeHandler, { channel: 'streamer' });
    res.end();
    res.emit('close');
    expect(hubs.youtubeUnsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a generic 503 before opening SSE when either hub is full', async () => {
    hubs.tiktokSubscribe.mockImplementationOnce(() => {
      throw new SharedSseCapacityError('channels');
    });
    hubs.youtubeSubscribe.mockImplementationOnce(() => {
      throw new SharedSseCapacityError('provider-subscribers');
    });

    const tiktok = await invoke(tikTokHandler, { user: 'streamer' }, '127.0.0.2');
    const youtube = await invoke(youTubeHandler, { channel: 'streamer' }, '127.0.0.3');
    for (const { res } of [tiktok, youtube]) {
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'Stream temporarily unavailable.' });
      expect(res.headers.get('retry-after')).toBe('30');
      expect(res.headers.has('content-type')).toBe(false);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rate limits excess TikTok admissions without another hub subscription', async () => {
    for (let index = 0; index < 30; index += 1) {
      const accepted = await invoke(tikTokHandler, { user: 'streamer' }, '127.0.0.4');
      expect(accepted.res.statusCode).toBe(200);
      accepted.req.emit('close');
    }
    const rejected = await invoke(tikTokHandler, { user: 'streamer' }, '127.0.0.4');
    expect(rejected.res.statusCode).toBe(429);
    expect(rejected.res.body).toEqual({ error: 'Too many stream requests.' });
    expect(Number(rejected.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(hubs.tiktokSubscribe).toHaveBeenCalledTimes(30);
  });

  it('rate limits excess YouTube admissions without another hub subscription', async () => {
    for (let index = 0; index < 30; index += 1) {
      const accepted = await invoke(youTubeHandler, { channel: 'streamer' }, '127.0.0.5');
      expect(accepted.res.statusCode).toBe(200);
      accepted.req.emit('close');
    }
    const rejected = await invoke(youTubeHandler, { channel: 'streamer' }, '127.0.0.5');
    expect(rejected.res.statusCode).toBe(429);
    expect(rejected.res.body).toEqual({ error: 'Too many stream requests.' });
    expect(Number(rejected.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(hubs.youtubeSubscribe).toHaveBeenCalledTimes(30);
  });
});
