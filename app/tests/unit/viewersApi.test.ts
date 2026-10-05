import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const tiktok = vi.hoisted(() => ({
  fetchRoomInfo: vi.fn(),
}));

vi.mock('tiktok-live-connector', () => ({
  TikTokLiveConnection: class FakeTikTokLiveConnection {
    fetchRoomInfo = tiktok.fetchRoomInfo;
  },
}));

import viewersHandler, {
  VIEWER_TIKTOK_TIMEOUT_MS,
  VIEWER_CACHE_STALE_IF_ERROR_MS,
  VIEWER_TWITCH_MAX_BYTES,
  VIEWER_TWITCH_TIMEOUT_MS,
  VIEWER_YOUTUBE_MAX_BYTES,
  VIEWER_YOUTUBE_MAX_REDIRECTS,
  resetViewerResourcesForTests,
  viewerResourceStatsForTests,
} from '@/pages/api/viewers';
import audienceHandler from '@/pages/api/audience';
import {
  VIEWER_ADMISSION_MAX_WORK,
  VIEWER_IN_FLIGHT_MAX,
  VIEWER_TIKTOK_MAX_CONCURRENCY,
} from '@/lib/server/viewerResourceControl';

class MockResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();
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

  end() {
    this.writableEnded = true;
    return this;
  }
}

function request(
  query: Record<string, string | string[]> = {},
  method = 'GET',
  remoteAddress = '127.0.0.1',
): NextApiRequest {
  return {
    method,
    query,
    headers: {},
    socket: { remoteAddress },
  } as unknown as NextApiRequest;
}

async function invoke(
  handler: typeof viewersHandler,
  query: Record<string, string | string[]> = {},
  method = 'GET',
  remoteAddress = '127.0.0.1',
) {
  const req = request(query, method, remoteAddress);
  const res = new MockResponse();
  await handler(req, res as unknown as NextApiResponse);
  return res;
}

function twitchResponse(viewers: number, status = 200) {
  return new Response(JSON.stringify({
    data: { user: { stream: { viewersCount: viewers } } },
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function youtubeResponse(
  html: string,
  status = 200,
  headers: HeadersInit = { 'Content-Type': 'text/html; charset=utf-8' },
) {
  return new Response(html, {
    status,
    headers,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetViewerResourcesForTests();
  tiktok.fetchRoomInfo.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetViewerResourcesForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bounded viewer API methods and compatibility', () => {
  it('uses the reviewed production resource limits', () => {
    expect(VIEWER_IN_FLIGHT_MAX).toBe(64);
    expect(VIEWER_ADMISSION_MAX_WORK).toBe(600);
    expect(VIEWER_TIKTOK_MAX_CONCURRENCY).toBe(8);
  });

  it('supports GET and CORS preflight while rejecting unsupported methods', async () => {
    const get = await invoke(viewersHandler);
    expect(get.statusCode).toBe(200);
    expect(get.body).toEqual({});
    expect(get.headers.get('access-control-allow-origin')).toBe('*');
    expect(get.headers.get('cache-control')).toBe('no-store');

    const options = await invoke(viewersHandler, {}, 'OPTIONS');
    expect(options.statusCode).toBe(204);
    expect(options.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');

    const post = await invoke(viewersHandler, {}, 'POST');
    expect(post.statusCode).toBe(405);
    expect(post.body).toEqual({ error: 'Method not allowed.' });
    expect(post.headers.get('allow')).toBe('GET, OPTIONS');
  });

  it('keeps partial-provider failure and response shape unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      if (String(url).includes('twitch.tv')) return Promise.resolve(twitchResponse(123));
      return Promise.reject(new Error('youtube unavailable'));
    }));
    tiktok.fetchRoomInfo.mockResolvedValue({ status: 2, user_count: 456 });

    const response = await invoke(viewersHandler, {
      twitch: 'Streamer',
      youtube: '@Creator',
      tiktok: '@TikToker',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      twitch: { live: true, viewers: 123 },
      tiktok: { live: true, viewers: 456 },
    });
  });

  it('preserves YouTube live-unknown parsing semantics', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(youtubeResponse(
      '<meta property="og:url" content="https://www.youtube.com/watch?v=live">',
    ))));
    const response = await invoke(viewersHandler, { youtube: '@Creator' });
    expect(response.body).toEqual({
      youtube: { live: true, viewers: null },
    });
  });

  it('uses explicit Twitch redirect rejection and bounded same-host YouTube redirects', async () => {
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('twitch.tv')) {
        expect(init?.redirect).toBe('error');
        return Promise.resolve(twitchResponse(123));
      }
      expect(init?.redirect).toBe('manual');
      if (String(url).includes('/@Creator/live')) {
        return Promise.resolve(youtubeResponse('', 302, {
          Location: 'https://www.youtube.com/watch?v=abcdefghijk',
        }));
      }
      return Promise.resolve(youtubeResponse('456 watching now'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await invoke(viewersHandler, {
      twitch: 'Streamer',
      youtube: '@Creator',
    });
    expect(response.body).toEqual({
      twitch: { live: true, viewers: 123 },
      youtube: { live: true, viewers: 456 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects cross-host and excessive YouTube redirects as partial-provider failures', async () => {
    const crossHostFetch = vi.fn(async () => youtubeResponse('', 302, {
      Location: 'https://example.com/watch?v=abcdefghijk',
    }));
    vi.stubGlobal('fetch', crossHostFetch);
    expect((await invoke(viewersHandler, { youtube: 'CreatorOne' })).body).toEqual({});
    expect(crossHostFetch).toHaveBeenCalledTimes(1);

    resetViewerResourcesForTests();
    const loopFetch = vi.fn(async () => youtubeResponse('', 302, {
      Location: 'https://www.youtube.com/@CreatorTwo/live',
    }));
    vi.stubGlobal('fetch', loopFetch);
    expect((await invoke(viewersHandler, { youtube: 'CreatorTwo' })).body).toEqual({});
    expect(loopFetch).toHaveBeenCalledTimes(VIEWER_YOUTUBE_MAX_REDIRECTS + 1);
  });

  it('keeps partial-provider semantics for oversized Twitch and YouTube bodies', async () => {
    const twitchCancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      if (String(url).includes('twitch.tv')) {
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(VIEWER_TWITCH_MAX_BYTES));
            controller.enqueue(new Uint8Array([1]));
          },
          cancel: twitchCancel,
        })));
      }
      return Promise.resolve(youtubeResponse('88 watching now'));
    }));
    const twitchOversized = await invoke(viewersHandler, {
      twitch: 'OversizedTwitch',
      youtube: 'HealthyYouTube',
    });
    expect(twitchOversized.body).toEqual({
      youtube: { live: true, viewers: 88 },
    });
    expect(twitchCancel).toHaveBeenCalledTimes(1);

    resetViewerResourcesForTests();
    const youtubeCancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
      if (String(url).includes('twitch.tv')) return Promise.resolve(twitchResponse(77));
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(VIEWER_YOUTUBE_MAX_BYTES));
          controller.enqueue(new Uint8Array([1]));
        },
        cancel: youtubeCancel,
      }), {
        headers: { 'Content-Length': '1' },
      }));
    }));
    const youtubeOversized = await invoke(viewersHandler, {
      twitch: 'HealthyTwitch',
      youtube: 'OversizedYouTube',
    });
    expect(youtubeOversized.body).toEqual({
      twitch: { live: true, viewers: 77 },
    });
    expect(youtubeCancel).toHaveBeenCalledTimes(1);
  });

  it('treats malformed Twitch JSON and provider timeouts as omitted providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{private malformed body')));
    expect((await invoke(viewersHandler, { twitch: 'Malformed' })).body).toEqual({});

    resetViewerResourcesForTests();
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }));
    const pending = invoke(viewersHandler, { twitch: 'Timeout' });
    await vi.advanceTimersByTimeAsync(VIEWER_TWITCH_TIMEOUT_MS);
    expect((await pending).body).toEqual({});
    expect(signal?.aborted).toBe(true);
  });
});

describe('viewer cache, coalescing, and alias controls', () => {
  it('coalesces identical simultaneous work across /viewers and /audience', async () => {
    const upstream = deferred<Response>();
    const fetchMock = vi.fn(() => upstream.promise);
    vi.stubGlobal('fetch', fetchMock);

    const viewersRequest = invoke(viewersHandler, { twitch: 'same' });
    const audienceRequest = invoke(audienceHandler, { twitch: 'same' });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(viewerResourceStatsForTests().inFlight).toBe(1);

    upstream.resolve(twitchResponse(99));
    const [viewers, audience] = await Promise.all([viewersRequest, audienceRequest]);
    expect(viewers.body).toEqual({ twitch: { live: true, viewers: 99 } });
    expect(audience.body).toEqual(viewers.body);
    expect(audience.headers.get('access-control-allow-origin')).toBe('*');

    const cached = await invoke(audienceHandler, { twitch: 'same' });
    expect(cached.body).toEqual(viewers.body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a recent successful value when an upstream refresh temporarily fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const fetchMock = vi.fn(() =>
      Promise.resolve(twitchResponse(321)),
    );

    vi.stubGlobal('fetch', fetchMock);

    const first = await invoke(
      viewersHandler,
      { twitch: 'stale-safe' },
    );

    expect(first.statusCode).toBe(200);

    expect(first.body).toEqual({
      twitch: {
        live: true,
        viewers: 321,
      },
    });

    vi.setSystemTime(20_000);

    fetchMock.mockRejectedValueOnce(
      new Error('temporary upstream failure'),
    );

    const fallback = await invoke(
      audienceHandler,
      { twitch: 'stale-safe' },
    );

    expect(fallback.statusCode).toBe(200);

    expect(fallback.body).toEqual({
      twitch: {
        live: true,
        viewers: 321,
      },
    });

    vi.setSystemTime(
      VIEWER_CACHE_STALE_IF_ERROR_MS + 1,
    );

    fetchMock.mockRejectedValueOnce(
      new Error('still unavailable'),
    );

    const expired = await invoke(
      viewersHandler,
      { twitch: 'stale-safe' },
    );

    expect(expired.statusCode).toBe(200);
    expect(expired.body).toEqual({});
  });

  it('does not let cache hits or the audience alias bypass or double-charge admission', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(twitchResponse(10)));
    vi.stubGlobal('fetch', fetchMock);

    for (let index = 0; index < VIEWER_ADMISSION_MAX_WORK; index += 1) {
      const response = await invoke(viewersHandler, { twitch: `channel${index}` });
      expect(response.statusCode).toBe(200);
    }

    const cachedChannel = 'channel' + String(VIEWER_ADMISSION_MAX_WORK - 1);
    const cached = await invoke(audienceHandler, { twitch: cachedChannel });
    expect(cached.statusCode).toBe(200);
    expect(cached.body).toEqual({ twitch: { live: true, viewers: 10 } });

    const rejected = await invoke(audienceHandler, { twitch: 'one-more' });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.body).toEqual({ error: 'Too many viewer requests.' });
    expect(Number(rejected.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(VIEWER_ADMISSION_MAX_WORK);
  });

  it('keeps audience OPTIONS free and rejects its unsupported methods', async () => {
    const options = await invoke(audienceHandler, {}, 'OPTIONS');
    expect(options.statusCode).toBe(204);
    expect(viewerResourceStatsForTests()).toMatchObject({
      inFlight: 0,
      limiterEntries: 0,
    });

    const post = await invoke(audienceHandler, {}, 'POST');
    expect(post.statusCode).toBe(405);
    expect(post.body).toEqual({ error: 'Method not allowed.' });
  });
});

describe('TikTok non-abortable viewer work', () => {
  it('caps abandoned room-info work until the real operations settle', async () => {
    vi.useFakeTimers();
    const pending = Array.from(
      { length: VIEWER_TIKTOK_MAX_CONCURRENCY },
      () => deferred<Record<string, unknown>>(),
    );
    for (const item of pending) tiktok.fetchRoomInfo.mockImplementationOnce(() => item.promise);

    const requests = pending.map((_, index) => (
      invoke(viewersHandler, { tiktok: `creator${index}` })
    ));
    await Promise.resolve();
    await Promise.resolve();
    expect(tiktok.fetchRoomInfo).toHaveBeenCalledTimes(VIEWER_TIKTOK_MAX_CONCURRENCY);
    expect(viewerResourceStatsForTests().activeTikTok).toBe(VIEWER_TIKTOK_MAX_CONCURRENCY);

    await vi.advanceTimersByTimeAsync(VIEWER_TIKTOK_TIMEOUT_MS);
    const timedOut = await Promise.all(requests);
    expect(timedOut.every((response) => (
      response.statusCode === 200 && JSON.stringify(response.body) === '{}'
    ))).toBe(true);
    expect(viewerResourceStatsForTests()).toMatchObject({
      inFlight: 0,
      activeTikTok: VIEWER_TIKTOK_MAX_CONCURRENCY,
    });

    const rejected = await invoke(viewersHandler, { tiktok: 'capacityblocked' });
    expect(rejected.statusCode).toBe(503);
    expect(rejected.body).toEqual({ error: 'Viewer data temporarily unavailable.' });
    expect(tiktok.fetchRoomInfo).toHaveBeenCalledTimes(VIEWER_TIKTOK_MAX_CONCURRENCY);

    for (const item of pending) item.resolve({ status: 4 });
    await Promise.resolve();
    await Promise.resolve();
    expect(viewerResourceStatsForTests().activeTikTok).toBe(0);

    tiktok.fetchRoomInfo.mockResolvedValueOnce({ status: 2, user_count: 77 });
    const recovered = await invoke(viewersHandler, { tiktok: 'aftercapacity' });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.body).toEqual({ tiktok: { live: true, viewers: 77 } });
  });
});
