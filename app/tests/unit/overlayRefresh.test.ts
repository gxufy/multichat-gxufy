/* Owner's "refresh all overlays": the stamp API and the overlay watcher. */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionUser: { id: string; login: string; displayName: string } | null = null;
vi.mock('@/lib/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/session')>()),
  readSession: () => sessionUser,
}));

import handler, { __resetOverlayRefreshLimitForTests } from '@/api/overlay/refresh';
import { __closeSupporterStoresForTests } from '@/lib/server/supporterStore';
import {
  REFRESH_ALL_SPREAD_MS,
  REFRESH_POLL_JITTER_MS,
  REFRESH_POLL_MS,
  overlayRefreshTargetMatches,
  startOverlayRefreshWatcher,
} from '@/lib/overlayRefreshWatcher';
import { OVERLAY_OWNER_COMMAND_TTL_MS, OVERLAY_REFRESH_TARGET_TTL_MS } from '@/lib/server/supporterStore';

const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
const SITE = 'http://localhost:3000';

let dir = '';

async function call(method: string, origin?: string, requestBody?: unknown, query: Record<string, unknown> = {}) {
  let statusCode = 200;
  let body: any;
  const req = {
    method,
    query,
    body: requestBody,
    headers: { host: 'localhost:3000', ...(origin ? { origin } : {}) },
    socket: { remoteAddress: '203.0.113.9' },
  } as unknown as ApiRequest;
  const res = {
    setHeader() {},
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as ApiResponse;
  await handler(req, res);
  return { statusCode, body };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-refresh-'));
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', path.join(dir, 'supporters.db'));
  vi.stubEnv('NODE_ENV', 'development');
  sessionUser = null;
  __resetOverlayRefreshLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('/api/overlay/refresh', () => {
  it('starts at 0 and only the owner can send a refresh', async () => {
    const first = (await call('GET')).body;
    expect(first.token).toBe(0);
    expect(first.targets).toEqual([]);
    expect(typeof first.now).toBe('number');

    expect((await call('POST', 'http://localhost:3000')).statusCode).toBe(403);
    sessionUser = { id: '555', login: 'someone', displayName: 'Someone' };
    expect((await call('POST', 'http://localhost:3000')).statusCode).toBe(403);

    sessionUser = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
    /* Owner, but from another site: refused. */
    expect((await call('POST', 'https://evil.example')).statusCode).toBe(403);
    const sent = await call('POST', 'http://localhost:3000');
    expect(sent.statusCode).toBe(200);
    expect(sent.body.token).toBeGreaterThan(0);
    expect((await call('GET')).body.token).toBe(sent.body.token);
    expect((await call('PUT')).statusCode).toBe(405);
  });

  it('limits how often the owner can send', async () => {
    sessionUser = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
    const codes: number[] = [];
    for (let n = 0; n < 12; n += 1) codes.push((await call('POST', 'http://localhost:3000')).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(-2)).toEqual([429, 429]);
  });
});

describe('/api/overlay/refresh — one channel', () => {
  it('only the owner can refresh a channel, and GET lists it with the server time', async () => {
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'plaqueboymax' })).statusCode).toBe(403);
    sessionUser = OWNER;
    expect((await call('POST', 'https://evil.example', { platform: 'twitch', channel: 'x' })).statusCode).toBe(403);

    const sent = await call('POST', SITE, { platform: 'twitch', channel: '@PlaqueBoyMax' });
    expect(sent.statusCode).toBe(200);
    expect(sent.body.target).toMatchObject({ platform: 'twitch', channel: 'plaqueboymax' });

    const listed = (await call('GET')).body;
    expect(listed.token).toBe(0);
    expect(listed.targets).toEqual([sent.body.target]);
    expect(listed.now).toBeGreaterThanOrEqual(sent.body.target.at);
  });

  it('accepts any platform, rejects bad names and platforms', async () => {
    sessionUser = OWNER;
    expect((await call('POST', SITE, { channel: 'kai cenat' })).statusCode).toBe(400);
    expect((await call('POST', SITE, { channel: '' })).statusCode).toBe(400);
    expect((await call('POST', SITE, { platform: 'facebook', channel: 'kaicenat' })).statusCode).toBe(400);
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'way-too-long-for-a-twitch-login' })).statusCode).toBe(400);
    const any = await call('POST', SITE, { channel: 'KaiCenat' });
    expect(any.statusCode).toBe(200);
    expect(any.body.target).toMatchObject({ platform: 'any', channel: 'kaicenat' });
  });

  it('keeps one entry per channel and forgets them after the time limit', async () => {
    sessionUser = OWNER;
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await call('POST', SITE, { platform: 'kick', channel: 'xqc' });
    vi.setSystemTime(1_060_000);
    await call('POST', SITE, { platform: 'kick', channel: 'xqc' });
    let targets = (await call('GET')).body.targets;
    expect(targets).toEqual([{ platform: 'kick', channel: 'xqc', at: 1_060_000 }]);
    vi.setSystemTime(1_060_000 + OVERLAY_REFRESH_TARGET_TTL_MS + 1);
    targets = (await call('GET')).body.targets;
    expect(targets).toEqual([]);
  });

  it('a channel refresh does not count against the refresh-all limit', async () => {
    sessionUser = OWNER;
    for (let n = 0; n < 12; n += 1) await call('POST', SITE, { platform: 'twitch', channel: `chan${n}` });
    expect((await call('POST', SITE)).statusCode).toBe(200);
  });
});

describe('/api/overlay/refresh — owner commands', () => {
  it('only the owner can send one, and only overlays naming that channel get it', async () => {
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'plaqueboymax', command: 'reload' })).statusCode).toBe(403);
    sessionUser = OWNER;
    expect((await call('POST', 'https://evil.example', { platform: 'twitch', channel: 'x', command: 'reload' })).statusCode).toBe(403);

    const sent = await call('POST', SITE, { platform: 'twitch', channel: '@PlaqueBoyMax', command: 'tts hello chat' });
    expect(sent.statusCode).toBe(200);
    expect(sent.body.command).toMatchObject({ platform: 'twitch', channel: 'plaqueboymax', text: 'tts hello chat' });
    expect(typeof sent.body.command.id).toBe('string');

    const mine = (await call('GET', undefined, undefined, { c: ['twitch:PlaqueBoyMax', 'kick:other'] })).body;
    expect(mine.commands).toEqual([sent.body.command]);
    const others = (await call('GET', undefined, undefined, { c: 'twitch:kaicenat' })).body;
    expect(others.commands).toEqual([]);
    const nobody = (await call('GET')).body;
    expect(nobody.commands).toEqual([]);
    /* A command is not a refresh. */
    expect(mine.token).toBe(0);
    expect(mine.targets).toEqual([]);
  });

  it('refuses permits, unknown commands and bad channels', async () => {
    sessionUser = OWNER;
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'x', command: 'permit alice' })).statusCode).toBe(400);
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'x', command: 'nuke' })).statusCode).toBe(400);
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'x', command: '' })).statusCode).toBe(400);
    expect((await call('POST', SITE, { platform: 'twitch', channel: 'bad name', command: 'reload' })).statusCode).toBe(400);
  });

  it('forgets commands after two minutes', async () => {
    sessionUser = OWNER;
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    await call('POST', SITE, { platform: 'kick', channel: 'xqc', command: 'clear' });
    expect((await call('GET', undefined, undefined, { c: 'kick:xqc' })).body.commands).toHaveLength(1);
    vi.setSystemTime(5_000_000 + OVERLAY_OWNER_COMMAND_TTL_MS + 1);
    expect((await call('GET', undefined, undefined, { c: 'kick:xqc' })).body.commands).toEqual([]);
  });
});

describe('matching a channel refresh to an overlay', () => {
  const shown = [
    { platform: 'twitch' as const, channel: 'PlaqueBoyMax' },
    { platform: 'youtube' as const, channel: '@plaqueboymaxlive' },
  ];
  it('matches by platform and name, ignoring case and a leading @', () => {
    expect(overlayRefreshTargetMatches({ platform: 'twitch', channel: 'plaqueboymax' }, shown)).toBe(true);
    expect(overlayRefreshTargetMatches({ platform: 'youtube', channel: 'PlaqueBoyMaxLive' }, shown)).toBe(true);
    expect(overlayRefreshTargetMatches({ platform: 'any', channel: 'plaqueboymaxlive' }, shown)).toBe(true);
    expect(overlayRefreshTargetMatches({ platform: 'kick', channel: 'plaqueboymax' }, shown)).toBe(false);
    expect(overlayRefreshTargetMatches({ platform: 'any', channel: 'kaicenat' }, shown)).toBe(false);
    expect(overlayRefreshTargetMatches({ platform: 'any', channel: '' }, shown)).toBe(false);
  });
});

describe('overlay refresh watcher — one channel', () => {
  type Answer = { token: number; now?: number; targets?: unknown[] };
  function server(answers: Answer[]) {
    let index = 0;
    return vi.fn(async () => {
      const answer = answers[Math.min(index, answers.length - 1)]!;
      index += 1;
      return new Response(JSON.stringify(answer), { status: 200 });
    }) as unknown as typeof fetch;
  }
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };
  const channels = () => [{ platform: 'twitch' as const, channel: 'plaqueboymax' }];

  it('reloads when its channel is refreshed after it started', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    startOverlayRefreshWatcher({
      fetcher: server([
        { token: 3, now: 1_000, targets: [] },
        { token: 3, now: 61_000, targets: [{ platform: 'twitch', channel: 'plaqueboymax', at: 30_000 }] },
      ]),
      random: () => 0, openLive: null, channels, onRefresh,
    });
    await tick(0);
    expect(onRefresh).not.toHaveBeenCalled();
    await tick(REFRESH_POLL_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('ignores other channels, and refreshes sent before it started', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const stop = startOverlayRefreshWatcher({
      fetcher: server([
        { token: 3, now: 50_000, targets: [{ platform: 'twitch', channel: 'plaqueboymax', at: 40_000 }] },
        { token: 3, now: 110_000, targets: [
          { platform: 'twitch', channel: 'plaqueboymax', at: 40_000 },
          { platform: 'twitch', channel: 'kaicenat', at: 90_000 },
          { platform: 'kick', channel: 'plaqueboymax', at: 95_000 },
        ] },
      ]),
      random: () => 0, openLive: null, channels, onRefresh,
    });
    await tick(0);
    await tick(REFRESH_POLL_MS * 3);
    expect(onRefresh).not.toHaveBeenCalled();
    stop();
  });

  it('ignores channel refreshes from an older server that sends no time', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const stop = startOverlayRefreshWatcher({
      fetcher: server([
        { token: 3 },
        { token: 3, targets: [{ platform: 'any', channel: 'plaqueboymax', at: 99_999_999 }] },
      ]),
      random: () => 0, openLive: null, channels, onRefresh,
    });
    await tick(0);
    await tick(REFRESH_POLL_MS * 2);
    expect(onRefresh).not.toHaveBeenCalled();
    stop();
  });
});

describe('overlay refresh watcher', () => {
  function server(tokens: number[]) {
    let index = 0;
    return vi.fn(async () => {
      const token = tokens[Math.min(index, tokens.length - 1)]!;
      index += 1;
      return new Response(JSON.stringify({ token, now: 1_000 + index, targets: [] }), { status: 200 });
    }) as unknown as typeof fetch;
  }
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

  it('ignores the stamp it started with and reloads at once on a newer one', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const stop = startOverlayRefreshWatcher({ fetcher: server([5, 5, 9]), random: () => 0, openLive: null, onRefresh });
    await tick(0);
    await tick(REFRESH_POLL_MS);
    expect(onRefresh).not.toHaveBeenCalled();
    await tick(REFRESH_POLL_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await tick(REFRESH_POLL_MS * 3);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('spreads a refresh of everything over a couple of seconds, never more', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    startOverlayRefreshWatcher({ fetcher: server([1, 2]), random: () => 0.999, openLive: null, onRefresh });
    await tick(0);
    await tick(REFRESH_POLL_MS + REFRESH_POLL_JITTER_MS);
    expect(onRefresh).not.toHaveBeenCalled();
    await tick(REFRESH_ALL_SPREAD_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('spreads polls with jitter, survives errors, and stops cleanly', async () => {    vi.useFakeTimers();
    const fetcher = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const onRefresh = vi.fn();
    const stop = startOverlayRefreshWatcher({ fetcher, random: () => 1, openLive: null, onRefresh });
    await tick(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await tick(REFRESH_POLL_MS + REFRESH_POLL_JITTER_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
    await tick(REFRESH_POLL_MS * 5);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('overlay refresh watcher — live connection', () => {
  class FakeLive {
    readyState = 0;
    closed = false;
    listeners: ((event: { data: string }) => void)[] = [];
    constructor(readonly url: string) {}
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      if (type === 'state') this.listeners.push(listener);
    }
    emit(state: unknown) {
      this.readyState = 1;
      for (const listener of this.listeners) listener({ data: JSON.stringify(state) });
    }
    close() { this.closed = true; }
  }
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };
  const quietServer = () => vi.fn(async () => new Response(JSON.stringify({ token: 7, now: 1, targets: [] }), { status: 200 })) as unknown as typeof fetch;

  it('asks for live badge changes only when it shows badges, and passes them on parsed', async () => {
    vi.useFakeTimers();
    class BadgeLive extends FakeLive {
      badgeListeners: ((event: { data: string }) => void)[] = [];
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'limerino') this.badgeListeners.push(listener);
        else super.addEventListener(type, listener);
      }
    }
    let live: BadgeLive | null = null;
    const onLimerino = vi.fn();
    const stop = startOverlayRefreshWatcher({
      fetcher: quietServer(), random: () => 0, onRefresh: vi.fn(), onLimerino,
      channels: () => [{ platform: 'twitch', channel: 'kaicenat' }],
      openLive: (url) => (live = new BadgeLive(url)),
    });
    await tick(0);
    expect(live!.url).toBe('/api/overlay/live?c=twitch%3Akaicenat&b=1');
    live!.badgeListeners[0]({ data: '{"t":"patch","users":{"42":"first"}}' });
    live!.badgeListeners[0]({ data: 'not json' });
    expect(onLimerino).toHaveBeenCalledTimes(1);
    expect(onLimerino).toHaveBeenCalledWith({ t: 'patch', users: { 42: 'first' } });
    stop();
    live!.badgeListeners[0]({ data: '{"t":"reload","v":2}' });
    expect(onLimerino).toHaveBeenCalledTimes(1);

    let plain: FakeLive | null = null;
    startOverlayRefreshWatcher({ fetcher: quietServer(), random: () => 0, onRefresh: vi.fn(), openLive: (url) => (plain = new FakeLive(url)) });
    await tick(0);
    expect(plain!.url).toBe('/api/overlay/live');
  });

  it('reloads the moment the server pushes a newer stamp', async () => {
    vi.useFakeTimers();
    let live: FakeLive | null = null;
    const onRefresh = vi.fn();
    startOverlayRefreshWatcher({
      fetcher: quietServer(), random: () => 0, onRefresh,
      openLive: (url) => (live = new FakeLive(url)),
    });
    await tick(0);
    expect(live!.url).toBe('/api/overlay/live');
    live!.emit({ token: 7, now: 5_000, targets: [] });
    expect(onRefresh).not.toHaveBeenCalled();
    live!.emit({ token: 8, now: 9_000, targets: [] });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(live!.closed).toBe(true);
  });

  it('reloads at once when its channel is pushed, and only then', async () => {
    vi.useFakeTimers();
    let live: FakeLive | null = null;
    const onRefresh = vi.fn();
    startOverlayRefreshWatcher({
      fetcher: quietServer(), random: () => 0, onRefresh,
      channels: () => [{ platform: 'kick', channel: 'itsjjx' }],
      openLive: (url) => (live = new FakeLive(url)),
    });
    await tick(0);
    live!.emit({ token: 7, now: 5_000, targets: [] });
    live!.emit({ token: 7, now: 6_000, targets: [{ platform: 'kick', channel: 'someoneelse', at: 5_500 }] });
    expect(onRefresh).not.toHaveBeenCalled();
    live!.emit({ token: 7, now: 7_000, targets: [{ platform: 'kick', channel: 'itsjjx', at: 6_500 }] });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not ask the server by polling while the live connection is open', async () => {
    vi.useFakeTimers();
    let live: FakeLive | null = null;
    const fetcher = quietServer();
    const stop = startOverlayRefreshWatcher({
      fetcher, random: () => 0, onRefresh: vi.fn(),
      openLive: (url) => (live = new FakeLive(url)),
    });
    await tick(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    live!.emit({ token: 7, now: 5_000, targets: [] });
    await tick(REFRESH_POLL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    live!.readyState = 2;
    await tick(REFRESH_POLL_MS);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
    expect(live!.closed).toBe(true);
  });

  it('ignores garbage from the live connection', async () => {
    vi.useFakeTimers();
    let live: FakeLive | null = null;
    const onRefresh = vi.fn();
    startOverlayRefreshWatcher({
      fetcher: quietServer(), random: () => 0, onRefresh,
      openLive: (url) => (live = new FakeLive(url)),
    });
    await tick(0);
    /* The first check set the baseline (stamp 7). Unreadable pushes, a bad
       stamp, or a bad channel list must not reload anything. */
    for (const listener of live!.listeners) listener({ data: 'not json' });
    live!.emit({ token: 'x' });
    live!.emit({ token: 7, now: 9_000, targets: 'nope' });
    live!.emit({ token: 7, now: 9_000, targets: [{ platform: 'myspace', channel: 'x', at: 8_000 }] });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('overlay refresh watcher — owner commands', () => {
  const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };
  class FakeLive {
    readyState = 0;
    listeners: ((event: { data: string }) => void)[] = [];
    constructor(readonly url: string) {}
    addEventListener(_type: string, listener: (event: { data: string }) => void) { this.listeners.push(listener); }
    emit(state: unknown) {
      this.readyState = 1;
      for (const listener of this.listeners) listener({ data: JSON.stringify(state) });
    }
    close() {}
  }
  /* The overlay's first answer says the server time is 5 000, so that is when it started. */
  const quietServer = () => vi.fn(async () => new Response(JSON.stringify({ token: 1, now: 5_000, targets: [], commands: [] }), { status: 200 })) as unknown as typeof fetch;
  const cmd = (id: string, text: string, at: number, channel = 'plaqueboymax', platform = 'twitch') => ({ id, platform, channel, text, at });

  it('names its channels when connecting and runs each new command once', async () => {
    vi.useFakeTimers();
    let live: FakeLive | null = null;
    const ran: string[] = [];
    const onRefresh = vi.fn();
    startOverlayRefreshWatcher({
      fetcher: quietServer(), random: () => 0, onRefresh,
      channels: () => [{ platform: 'twitch', channel: 'PlaqueBoyMax' }, { platform: 'youtube', channel: '@plaqueboymaxlive' }],
      onCommand: (text) => ran.push(text),
      openLive: (url) => (live = new FakeLive(url)),
    });
    await tick(0);
    expect(live!.url).toBe('/api/overlay/live?c=twitch%3APlaqueBoyMax&c=youtube%3A%40plaqueboymaxlive');
    /* Sent before this overlay started: not for it. */
    live!.emit({ token: 1, now: 5_000, targets: [], commands: [cmd('old', 'reload', 4_000)] });
    live!.emit({ token: 1, now: 6_000, targets: [], commands: [cmd('old', 'reload', 4_000), cmd('a', 'tts hi', 5_500)] });
    live!.emit({ token: 1, now: 7_000, targets: [], commands: [cmd('a', 'tts hi', 5_500), cmd('b', 'clear', 6_500), cmd('c', 'reload', 6_600, 'someoneelse')] });
    expect(ran).toEqual(['tts hi', 'clear']);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('gets commands by polling when the live connection is unavailable', async () => {
    vi.useFakeTimers();
    let call = 0;
    const fetcher = vi.fn(async (url: string) => {
      call += 1;
      expect(url).toBe('/api/overlay/refresh?c=kick%3Aitsjjx');
      const body = call === 1
        ? { token: 1, now: 1_000, targets: [], commands: [] }
        : { token: 1, now: 70_000, targets: [], commands: [cmd('k', 'counterbgoff', 60_000, 'itsjjx', 'kick')] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const ran: string[] = [];
    startOverlayRefreshWatcher({
      fetcher, random: () => 0, openLive: null, onRefresh: vi.fn(),
      channels: () => [{ platform: 'kick', channel: 'itsjjx' }],
      onCommand: (text) => ran.push(text),
    });
    await tick(0);
    await tick(REFRESH_POLL_MS);
    expect(ran).toEqual(['counterbgoff']);
  });
});
