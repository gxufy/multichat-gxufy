import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, {
  TWITCH_BADGES_MAX_BYTES,
  TWITCH_BADGES_TIMEOUT_MS,
} from '@/pages/api/twitch/badges';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  fixedProviderResourceStatsForTests,
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function invoke(query: Record<string, string | string[]> = {}, method = 'GET') {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const req = {
    method,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as NextApiResponse;
  return handler(req, res).then(() => ({ statusCode, body, headers }));
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

beforeEach(() => resetFixedProviderResourcesForTests());
afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Twitch badge API boundary', () => {
  it('merges channel art over global art and exposes room id only to preview callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
        data: {
          badges: [
            { setID: 'subscriber', version: '1', imageURL: 'https://cdn.example/global.png' },
            { setID: 'moderator', version: '1', imageURL: 'https://cdn.example/mod.png' },
          ],
          user: {
            id: '42',
            broadcastBadges: [
              { setID: 'subscriber', version: '1', imageURL: 'https://cdn.example/channel.png' },
            ],
          },
        },
      })));

    const production = await invoke({ channel: 'streamer' });
    expect(production.statusCode).toBe(200);
    expect(production.body).toEqual({
      'subscriber/1': 'https://cdn.example/channel.png',
      'moderator/1': 'https://cdn.example/mod.png',
    });

    const preview = await invoke({ channel: 'streamer', preview: '1' });
    expect(preview.body).toEqual({
      badges: {
        'subscriber/1': 'https://cdn.example/channel.png',
        'moderator/1': 'https://cdn.example/mod.png',
      },
      roomId: '42',
    });
  });

  it('loads global badges without requiring a channel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
        data: {
          badges: [{ setID: 'vip', version: '1', imageURL: 'https://cdn.example/vip.png' }],
        },
      })));
    const result = await invoke({ preview: '1' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ badges: { 'vip/1': 'https://cdn.example/vip.png' }, roomId: null });
  });

  it('rejects methods and invalid channels before contacting Twitch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke({}, 'POST')).statusCode).toBe(405);
    expect((await invoke({ channel: 'bad/channel' })).statusCode).toBe(400);
    expect((await invoke({ channel: ['valid'] })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns one generic failure for malformed upstream envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ data: { badges: 'bad' } })));
    const result = await invoke({ channel: 'streamer' });
    expect(result.statusCode).toBe(502);
    expect(result.body).toEqual({ error: 'Unable to load Twitch badges.' });
  });

  it('uses only the fixed Twitch GQL endpoint and rejects redirects', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      data: { badges: [], user: null },
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke({ channel: 'safe_login' })).statusCode).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://gql.twitch.tv/gql');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('coalesces identical upstream work while preserving preview response shape', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const production = invoke({ channel: 'streamer' });
    const preview = invoke({ channel: 'streamer', preview: '1' });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(response({
      data: {
        badges: [{ setID: 'vip', version: '1', imageURL: 'https://cdn.example/vip.png' }],
        user: { id: '42', broadcastBadges: [] },
      },
    }));
    expect((await production).body).toEqual({ 'vip/1': 'https://cdn.example/vip.png' });
    expect((await preview).body).toEqual({
      badges: { 'vip/1': 'https://cdn.example/vip.png' },
      roomId: '42',
    });
  });

  it('rejects oversized declared and streamed bodies', async () => {
    const declared = new Response(new ReadableStream<Uint8Array>(), {
      headers: { 'Content-Length': String(TWITCH_BADGES_MAX_BYTES + 1) },
    });
    let sent = false;
    const streamed = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new Uint8Array(TWITCH_BADGES_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
    }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(declared)
      .mockResolvedValueOnce(streamed));
    expect((await invoke({ channel: 'one' })).statusCode).toBe(502);
    expect((await invoke({ channel: 'two' })).statusCode).toBe(502);
  });

  it('aborts timeout work and releases shared capacity', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }));
    const pending = invoke({ channel: 'slow' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(TWITCH_BADGES_TIMEOUT_MS);
    expect((await pending).statusCode).toBe(502);
    expect(signal?.aborted).toBe(true);
    expect(fixedProviderResourceStatsForTests().active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
