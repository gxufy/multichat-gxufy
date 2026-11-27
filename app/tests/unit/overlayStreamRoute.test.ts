/* GET /api/overlay/stream: one overlay's server streams in one response
 * (lib/server/overlayStreamMux), each still served by its own route handler. */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';

const hubs = vi.hoisted(() => ({
  tiktok: vi.fn(),
  youtube: vi.fn(),
  kick: vi.fn(),
  unsubscribed: [] as string[],
  sinks: [] as Array<{ write(chunk: string): unknown }>,
  removedSinks: 0,
  moves: [] as Array<() => void>,
}));

vi.mock('@/lib/tiktokHub', () => ({ subscribe: hubs.tiktok }));
vi.mock('@/lib/server/youtubeHub', () => ({ subscribeYouTube: hubs.youtube }));
vi.mock('@/lib/server/kickRealtimeHub', () => ({ subscribeKickRealtime: hubs.kick }));
vi.mock('@/lib/server/limerinoLive', () => ({ ensureLimerinoLive: () => undefined }));
vi.mock('@/lib/server/overlayLiveHub', () => ({
  parseOverlayChannelParams: () => [],
  overlayLiveHasRoom: () => true,
  overlayLiveBadgeConnectionCount: () => 0,
  broadcastOverlayBadgeEvent: () => 0,
  addOverlayLiveSink: async (sink: { write(chunk: string): unknown }) => {
    hubs.sinks.push(sink);
    sink.write('event: state\ndata: {"token":1,"targets":[],"commands":[],"now":5}\n\n');
  },
  removeOverlayLiveSink: () => {
    hubs.removedSinks += 1;
  },
}));
vi.mock('@/lib/server/drain', () => ({
  onStreamsMove: (listener: () => void) => {
    hubs.moves.push(listener);
    return () => {
      const index = hubs.moves.indexOf(listener);
      if (index >= 0) hubs.moves.splice(index, 1);
    };
  },
}));

import handler, { resetOverlayStreamAdmissionForTests } from '@/api/overlay/stream';
import { resetTikTokSseAdmissionForTests } from '@/api/tiktok/chat';
import { resetYouTubeSseAdmissionForTests } from '@/api/youtube/stream';
import { resetKickRealtimeSseAdmissionForTests } from '@/api/kick/realtime';
import { __resetOverlayLiveLimitForTests } from '@/api/overlay/live';
import { SharedSseCapacityError } from '@/lib/server/sharedSseAdmission';
import {
  OVERLAY_STREAM_MAX_SUBS,
  OVERLAY_STREAM_RESUME_MARGIN_MS,
  SubResponse,
  overlayStreamFrame,
  parseOverlayStreamSubs,
} from '@/lib/server/overlayStreamMux';

class MockRequest extends EventEmitter {
  method = 'GET';
  headers: ApiRequest['headers'] = { host: 'localhost:3000' };
  socket = { remoteAddress: '127.0.0.1' };
  constructor(public query: Record<string, string | string[]>) {
    super();
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers = new Map<string, string>();
  chunks: string[] = [];
  writableEnded = false;
  body: unknown;
  setHeader(name: string, value: string) {
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
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    return this;
  }
}

type Frame = { key: string; event: string; id: string; data: string };

/** Read the frames back as a browser would (data lines joined). */
function frames(res: MockResponse): Frame[] {
  const out: Frame[] = [];
  for (const block of res.chunks.join('').split('\n\n')) {
    const data = block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
    if (!data) continue;
    const [key, event, id, ...rest] = data.split('\t');
    out.push({ key: key!, event: event!, id: id!, data: rest.join('\t') });
  }
  return out;
}

const sub = (key: string, target: string, lastEventId = '') => `${key}|${lastEventId}|${target}`;

async function open(s: string[]) {
  const req = new MockRequest({ s });
  const res = new MockResponse();
  handler(req as unknown as ApiRequest, res as unknown as ApiResponse);
  await Promise.resolve();
  await Promise.resolve();
  return { req, res };
}

const ALL = [
  sub('o', '/api/overlay/live?c=twitch%3Agxufy&b=1'),
  sub('k', '/api/kick/realtime?channelId=875396&chatroomId=875062'),
  sub('y', '/api/youtube/stream?channel=SymfuhnyTV&since=1000'),
  sub('t', '/api/tiktok/chat?user=realgrxnt&since=1000'),
];

beforeEach(() => {
  resetOverlayStreamAdmissionForTests();
  resetTikTokSseAdmissionForTests();
  resetYouTubeSseAdmissionForTests();
  resetKickRealtimeSseAdmissionForTests();
  __resetOverlayLiveLimitForTests();
  hubs.unsubscribed = [];
  hubs.sinks = [];
  hubs.removedSinks = 0;
  hubs.moves = [];
  hubs.youtube.mockReset().mockImplementation((_channel: string, send: (data: object, serialized: string) => void) => {
    send({ type: 'status', status: 'connected' }, '{"type":"status","status":"connected"}');
    send({ type: 'actions', timestamp: 2_000 }, '{"type":"actions","timestamp":2000,"actions":[]}');
    return () => hubs.unsubscribed.push('youtube');
  });
  hubs.tiktok.mockReset().mockImplementation((_user: string, send: (data: object, serialized: string) => void) => {
    send({ type: 'chat', id: 't1', timestamp: 3_000 }, '{"type":"chat","id":"t1","timestamp":3000}');
    return () => hubs.unsubscribed.push('tiktok');
  });
  hubs.kick.mockReset().mockImplementation((_channel: number, _room: number, send: (data: object, serialized: string) => void) => {
    send({ type: 'event', sequence: 42 } as object, '{"type":"event","sequence":42,"event":"ChatMessageEvent"}');
    return () => hubs.unsubscribed.push('kick');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one overlay stream', () => {
  it('carries all four streams in one response, each under its own key', async () => {
    const { res } = await open(ALL);
    expect(res.statusCode).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const got = frames(res);
    expect(got.filter((frame) => frame.event === '.open').map((frame) => frame.key).sort()).toEqual(['k', 'o', 't', 'y']);
    expect(got).toContainEqual({ key: 'o', event: 'state', id: '', data: '{"token":1,"targets":[],"commands":[],"now":5}' });
    expect(got).toContainEqual({ key: 'k', event: 'message', id: '42', data: '{"type":"event","sequence":42,"event":"ChatMessageEvent"}' });
    expect(got).toContainEqual({ key: 'y', event: 'message', id: '', data: '{"type":"status","status":"connected"}' });
    /* YouTube and TikTok events carry their time as the id, for resuming. */
    expect(got).toContainEqual({ key: 'y', event: 'message', id: '2000', data: '{"type":"actions","timestamp":2000,"actions":[]}' });
    expect(got).toContainEqual({ key: 't', event: 'message', id: '3000', data: '{"type":"chat","id":"t1","timestamp":3000}' });
    /* Keep-alive comments and retry lines of the sub-streams stay inside. */
    expect(res.chunks.join('')).not.toContain('retry:');
  });

  it('resumes each stream from the last event the browser saw', async () => {
    await open([
      sub('k', '/api/kick/realtime?channelId=875396&chatroomId=875062', '41'),
      sub('y', '/api/youtube/stream?channel=SymfuhnyTV&since=1000', '5000'),
      sub('t', '/api/tiktok/chat?user=realgrxnt&since=9000', '5000'),
    ]);
    expect(hubs.kick).toHaveBeenCalledWith(875396, 875062, expect.any(Function), 41);
    /* YouTube's since moves up to shortly before the last event's time;
       TikTok's was later already. */
    const [, youtubeSend] = hubs.youtube.mock.calls[0]!;
    expect(typeof youtubeSend).toBe('function');
    const { res } = await open([sub('y', '/api/youtube/stream?channel=SymfuhnyTV&since=1000', '7500')]);
    /* The 2,000 ms actions event is older than the resume point (7,500 ms less
       the margin): not sent again. */
    expect(OVERLAY_STREAM_RESUME_MARGIN_MS).toBe(5_000);
    expect(frames(res).some((frame) => frame.data.includes('"timestamp":2000'))).toBe(false);
    /* Within the margin before the last event: sent again (the overlay drops
       what it already showed). */
    const margin = await open([sub('y', '/api/youtube/stream?channel=SymfuhnyTV&since=1000', '6500')]);
    expect(frames(margin.res).some((frame) => frame.data.includes('"timestamp":2000'))).toBe(true);
    const second = await open([sub('t', '/api/tiktok/chat?user=realgrxnt&since=1000', '2500')]);
    expect(frames(second.res).some((frame) => frame.data.includes('"t1"'))).toBe(true);
  });

  it('reports a refused stream and keeps the others', async () => {
    hubs.youtube.mockImplementationOnce(() => {
      throw new SharedSseCapacityError('channels');
    });
    const { res } = await open([
      sub('y', '/api/youtube/stream?channel=SymfuhnyTV&since=1000'),
      sub('t', '/api/tiktok/chat?user=&since=1000'),
      sub('k', '/api/kick/realtime?channelId=875396&chatroomId=875062'),
    ]);
    const got = frames(res);
    expect(got).toContainEqual({ key: 'y', event: '.error', id: '', data: '503 30' });
    expect(got).toContainEqual({ key: 't', event: '.error', id: '', data: '400' });
    expect(got.some((frame) => frame.key === 'k' && frame.event === 'message')).toBe(true);
    expect(res.writableEnded).toBe(false);
  });

  it('ends every stream when the overlay goes away', async () => {
    vi.useFakeTimers();
    const { req } = await open(ALL);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    req.emit('close');
    expect(hubs.unsubscribed.sort()).toEqual(['kick', 'tiktok', 'youtube']);
    expect(hubs.removedSinks).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hands over at a deploy: the streams say so, then the overlay reconnects', async () => {
    const { res } = await open(ALL);
    for (const listener of [...hubs.moves]) listener();
    const got = frames(res);
    expect(got).toContainEqual({ key: 'y', event: 'message', id: '', data: '{"type":"moving"}' });
    expect(got).toContainEqual({ key: 't', event: 'message', id: '', data: '{"type":"moving"}' });
    expect(got).toContainEqual({ key: 'o', event: '.end', id: '', data: '500' });
    expect(got.at(-1)).toEqual({ key: '*', event: '.move', id: '', data: '500' });
    expect(res.writableEnded).toBe(true);
    expect(hubs.unsubscribed.sort()).toEqual(['kick', 'tiktok', 'youtube']);
  });

  it('refuses anything but the four overlay streams', async () => {
    for (const s of [
      [],
      [sub('a', '/api/supporter/checkout')],
      [sub('a', '/api/youtube/stream?channel=x'), sub('a', '/api/tiktok/chat?user=x')],
      ['a|/api/youtube/stream'],
      [sub('A', '/api/youtube/stream?channel=x')],
      [sub('a', '/api/youtube/stream?channel=x', '12x')],
      Array.from({ length: OVERLAY_STREAM_MAX_SUBS + 1 }, (_unused, index) => sub(`a${index}`, '/api/youtube/stream?channel=x')),
    ]) {
      const req = new MockRequest({ s });
      const res = new MockResponse();
      handler(req as unknown as ApiRequest, res as unknown as ApiResponse);
      expect(res.statusCode, JSON.stringify(s)).toBe(400);
    }
    const post = new MockRequest({ s: ALL });
    post.method = 'POST';
    const res = new MockResponse();
    handler(post as unknown as ApiRequest, res as unknown as ApiResponse);
    expect(res.statusCode).toBe(405);
    expect(hubs.youtube).not.toHaveBeenCalled();
  });

  it('parses the stream list', () => {
    expect(parseOverlayStreamSubs(sub('k', '/api/kick/realtime?channelId=1&chatroomId=2', '7'))).toEqual([
      expect.objectContaining({ key: 'k', lastEventId: '7', path: '/api/kick/realtime' }),
    ]);
    expect(parseOverlayStreamSubs('k||/api/kick/realtime')![0]!.query.toString()).toBe('');
  });
});

describe('re-framing a route\'s events', () => {
  it('follows the EventSource rules for the parts the routes use', () => {
    const out: string[] = [];
    const res = new SubResponse('k', '/api/kick/realtime', (chunk) => out.push(chunk));
    res.writeHead(200, {});
    res.write('retry: 2000\n\n');
    res.write(': ping\n\n');
    res.write('id: 7\n');
    res.write('data: {"a":1}\r\n\r\n');
    res.write('event: state\ndata: line one\ndata: line two\n\n');
    res.write('data: {"b":2}\n\n');
    res.end();
    expect(out).toEqual([
      overlayStreamFrame('k', '.open', '', ''),
      overlayStreamFrame('k', 'message', '7', '{"a":1}'),
      overlayStreamFrame('k', 'state', '7', 'line one\nline two'),
      /* The id stays until another is given, as in EventSource. */
      overlayStreamFrame('k', 'message', '7', '{"b":2}'),
      overlayStreamFrame('k', '.end', '', '2000'),
    ]);
    expect(overlayStreamFrame('k', 'state', '', 'a\nb')).toBe('data: k\tstate\t\ta\ndata: b\n\n');
  });
});
