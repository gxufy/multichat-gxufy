/* Instant refresh delivery: GET /api/overlay/live and the hub behind it. */
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionUser: { id: string; login: string; displayName: string } | null = null;
vi.mock('@/lib/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/session')>()),
  readSession: () => sessionUser,
}));

import liveHandler, { __resetOverlayLiveLimitForTests } from '@/pages/api/overlay/live';
import refreshHandler, { __resetOverlayRefreshLimitForTests } from '@/pages/api/overlay/refresh';
import {
  OVERLAY_LIVE_CHECK_MS,
  OVERLAY_LIVE_HEARTBEAT_MS,
  OVERLAY_LIVE_MAX_PER_CLIENT,
  __resetOverlayLiveHubForTests,
  overlayLiveConnectionCount,
} from '@/lib/server/overlayLiveHub';
import { __closeSupporterStoresForTests, openSupporterStore } from '@/lib/server/supporterStore';

const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
let dir = '';

type FakeConnection = {
  req: EventEmitter;
  res: EventEmitter & { headers: Record<string, string>; chunks: string[]; statusCode: number; body: unknown };
};

function connect(ip = '203.0.113.9', method = 'GET', query: Record<string, unknown> = {}): FakeConnection {
  const req = Object.assign(new EventEmitter(), {
    method,
    query,
    headers: { host: 'localhost:3000' },
    socket: { remoteAddress: ip },
  });
  const res = Object.assign(new EventEmitter(), {
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    writeHead(code: number, headers: Record<string, string>) {
      this.statusCode = code;
      for (const [k, v] of Object.entries(headers)) this.headers[k.toLowerCase()] = v;
      return this;
    },
    flushHeaders() {},
    write(chunk: string) { this.chunks.push(chunk); return true; },
    end() {},
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  });
  void liveHandler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return { req, res };
}

async function post(body?: unknown) {
  let statusCode = 200;
  const req = {
    method: 'POST',
    query: {},
    body,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    socket: { remoteAddress: '198.51.100.7' },
  } as unknown as NextApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as NextApiResponse;
  await refreshHandler(req, res);
  return statusCode;
}

const states = (c: FakeConnection) => c.res.chunks
  .filter((chunk) => chunk.startsWith('event: state'))
  .map((chunk) => JSON.parse(chunk.split('data: ')[1]!));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-live-'));
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(dir, 'supporters.db'));
  vi.stubEnv('NODE_ENV', 'development');
  sessionUser = null;
  __resetOverlayLiveLimitForTests();
  __resetOverlayRefreshLimitForTests();
  __resetOverlayLiveHubForTests();
});

afterEach(() => {
  __resetOverlayLiveHubForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('/api/overlay/live', () => {
  it('opens an event stream and sends the current state straight away', async () => {
    const c = connect();
    await settle();
    expect(c.res.statusCode).toBe(200);
    expect(c.res.headers['content-type']).toBe('text/event-stream');
    expect(c.res.headers['cache-control']).toContain('no-transform');
    expect(c.res.chunks[0]).toBe('retry: 3000\n\n');
    const [first] = states(c);
    expect(first).toMatchObject({ token: 0, targets: [] });
    expect(typeof first.now).toBe('number');
  });

  it("pushes the owner's refresh-all to every open overlay at once", async () => {
    const a = connect('203.0.113.1');
    const b = connect('203.0.113.2');
    await settle();
    sessionUser = OWNER;
    expect(await post()).toBe(200);
    await settle();
    for (const c of [a, b]) {
      const all = states(c);
      expect(all.at(-1)!.token).toBeGreaterThan(0);
    }
  });

  it('pushes a one-channel refresh at once', async () => {
    const c = connect();
    await settle();
    sessionUser = OWNER;
    expect(await post({ platform: 'kick', channel: 'itsjjx' })).toBe(200);
    await settle();
    expect(states(c).at(-1)!.targets).toEqual([expect.objectContaining({ platform: 'kick', channel: 'itsjjx' })]);
  });

  it('notices changes made elsewhere within a second, sends nothing when nothing changed, and keeps the line alive', async () => {
    vi.useFakeTimers();
    const c = connect();
    await vi.advanceTimersByTimeAsync(0);
    const before = states(c).length;
    await vi.advanceTimersByTimeAsync(OVERLAY_LIVE_CHECK_MS * 3);
    /* The first tick may repeat the state once; after that, silence. */
    const settled = states(c).length;
    expect(settled - before).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(OVERLAY_LIVE_CHECK_MS * 3);
    expect(states(c).length).toBe(settled);

    await openSupporterStore()!.setOverlayRefreshToken(Date.now());
    await vi.advanceTimersByTimeAsync(OVERLAY_LIVE_CHECK_MS);
    expect(states(c).length).toBe(settled + 1);
    expect(states(c).at(-1)!.token).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(OVERLAY_LIVE_HEARTBEAT_MS);
    expect(c.res.chunks).toContain(': keep-alive\n\n');
  });

  it('frees a slot when an overlay disconnects, and caps connections per address', async () => {
    const open: FakeConnection[] = [];
    for (let n = 0; n < OVERLAY_LIVE_MAX_PER_CLIENT; n += 1) {
      __resetOverlayLiveLimitForTests();
      open.push(connect('203.0.113.50'));
    }
    await settle();
    expect(overlayLiveConnectionCount()).toBe(OVERLAY_LIVE_MAX_PER_CLIENT);
    __resetOverlayLiveLimitForTests();
    const refused = connect('203.0.113.50');
    expect(refused.res.statusCode).toBe(503);

    open[0]!.req.emit('close');
    expect(overlayLiveConnectionCount()).toBe(OVERLAY_LIVE_MAX_PER_CLIENT - 1);
    __resetOverlayLiveLimitForTests();
    const again = connect('203.0.113.50');
    await settle();
    expect(again.res.statusCode).toBe(200);
  });

  it("sends a command only to the overlays showing that channel", async () => {
    const plaque = connect('203.0.113.21', 'GET', { c: ['twitch:PlaqueBoyMax', 'youtube:plaqueboymaxlive'] });
    const kai = connect('203.0.113.22', 'GET', { c: 'twitch:kaicenat' });
    const anonymous = connect('203.0.113.23');
    await settle();
    sessionUser = OWNER;
    expect(await post({ platform: 'twitch', channel: 'plaqueboymax', command: 'tts hello' })).toBe(200);
    await settle();
    expect(states(plaque).at(-1)!.commands).toEqual([expect.objectContaining({ channel: 'plaqueboymax', text: 'tts hello' })]);
    expect(states(kai).at(-1)!.commands).toEqual([]);
    expect(states(anonymous).at(-1)!.commands).toEqual([]);
  });

  it('ignores channel names it cannot use', async () => {
    const c = connect('203.0.113.24', 'GET', { c: ['twitch:bad name', 'myspace:tom', 'nocolon', 'kick:ok_name'] });
    await settle();
    sessionUser = OWNER;
    expect(await post({ platform: 'kick', channel: 'ok_name', command: 'clear' })).toBe(200);
    await settle();
    expect(states(c).at(-1)!.commands).toEqual([expect.objectContaining({ platform: 'kick', channel: 'ok_name', text: 'clear' })]);
  });

  it('only answers GET', async () => {
    const c = connect('203.0.113.9', 'POST');
    expect(c.res.statusCode).toBe(405);
  });
});
