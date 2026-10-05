import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, {
  __resetYouTubeChannelSearchRateLimitForTests,
} from '@/pages/api/youtube/channel-search';
import {
  YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX,
  YOUTUBE_CHANNEL_SEARCH_MAX_BYTES,
  __resetYouTubeChannelSearchCacheForTests,
  searchYouTubeChannels,
} from '@/lib/server/youtubeChannelSearch';

const originalVercel = process.env.VERCEL;
const originalTrustedCaddy = process.env.TRUST_CADDY_PROXY;

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function channelId(index: number): string {
  return `UC${String(index).padStart(22, '0')}`;
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

function oversizedStreamResponse(
  maximumBytes: number,
  declaredLength?: number,
): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  let sent = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) return;
      sent = true;
      controller.enqueue(new Uint8Array(maximumBytes));
      controller.enqueue(new TextEncoder().encode('é'));
    },
    cancel,
  }), {
    headers: declaredLength === undefined
      ? undefined
      : { 'Content-Length': String(declaredLength) },
  });
  return { response, cancel };
}

function channelRenderer(
  handle: string,
  index: number,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    channelId: channelId(index),
    title: { simpleText: handle.slice(1).toUpperCase() },
    navigationEndpoint: {
      browseEndpoint: { canonicalBaseUrl: `/${handle}` },
    },
    thumbnail: {
      thumbnails: [
        {
          url: `//yt3.ggpht.com/${handle.slice(1)}-small`,
          width: 48,
          height: 48,
        },
        {
          url: `https://yt3.googleusercontent.com/${handle.slice(1)}-large`,
          width: 88,
          height: 88,
        },
      ],
    },
    subscriberCountText: { simpleText: handle },
    videoCountText: { simpleText: '1.38M subscribers' },
    ...overrides,
  };
}

function searchHtml(renderers: unknown[]): string {
  const initialData = {
    contents: {
      sectionListRenderer: {
        contents: renderers.map((channel) => ({ channelRenderer: channel })),
      },
    },
    metadata: { note: 'A string containing a closing brace }; stays valid.' },
  };

  return `<!doctype html><script>var ytInitialData = ${JSON.stringify(initialData)};</script>`;
}

function invoke(
  query: Record<string, string | string[]> = { q: 'channel' },
  method = 'GET',
  ip = '203.0.113.10',
) {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const trustedCaddy = process.env.TRUST_CADDY_PROXY === '1';
  const req = {
    method,
    query,
    headers: {
      'x-forwarded-for': '198.51.100.240',
      'x-real-ip': '198.51.100.241',
      'x-gxufy-client-ip': ip,
    },
    socket: { remoteAddress: trustedCaddy ? '127.0.0.1' : ip },
  } as unknown as NextApiRequest;
  const res = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as NextApiResponse;

  return Promise.resolve(handler(req, res)).then(() => ({
    statusCode,
    body,
    headers,
  }));
}

beforeEach(() => {
  delete process.env.VERCEL;
  delete process.env.TRUST_CADDY_PROXY;
  __resetYouTubeChannelSearchRateLimitForTests();
  __resetYouTubeChannelSearchCacheForTests();
});

afterEach(() => {
  __resetYouTubeChannelSearchRateLimitForTests();
  __resetYouTubeChannelSearchCacheForTests();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalTrustedCaddy === undefined) delete process.env.TRUST_CADDY_PROXY;
  else process.env.TRUST_CADDY_PROXY = originalTrustedCaddy;
  vi.unstubAllGlobals();
});

describe('YouTube channel search API', () => {
  it('rejects unsupported methods and invalid queries before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const method = await invoke({ q: 'valid' }, 'POST');
    expect(method.statusCode).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect((await invoke({ q: 'ab' })).statusCode).toBe(400);
    expect((await invoke({ q: 'bad/name' })).statusCode).toBe(400);
    expect((await invoke({ q: ['valid', 'duplicate'] })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses balanced ytInitialData and the observed subscriber-field quirk', async () => {
    const renderer = channelRenderer('@Agent00', 1, {
      title: { runs: [{ text: 'Agent ' }, { text: '00' }] },
      subscriberCountText: { simpleText: '@Agent00' },
      videoCountText: { simpleText: '1.38M subscribers' },
    });
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => htmlResponse(searchHtml([renderer])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await invoke({ q: '  @AGENT00  ' });
    expect(result.statusCode).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.body).toEqual([
      {
        channel_id: channelId(1),
        handle: '@Agent00',
        display_name: 'Agent 00',
        thumbnail_url: 'https://yt3.googleusercontent.com/Agent00-large',
        subscribers: '1.38M subscribers',
        is_live: false,
      },
    ]);

    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://www.youtube.com/results');
    expect(url.searchParams.get('search_query')).toBe('agent00');
    expect((init as RequestInit).cache).toBe('no-store');
    expect((init as RequestInit).redirect).toBe('error');
    expect((init as RequestInit).headers).toMatchObject({
      'Accept-Language': 'en-US,en;q=0.9',
    });
  });

  it('deduplicates, ranks deterministically, and caps results at five', async () => {
    const renderers = [
      channelRenderer('@copycat', 1),
      channelRenderer('@catalog', 2),
      channelRenderer('@cat', 3),
      channelRenderer('@catz', 4),
      channelRenderer('@caterpillar', 5),
      channelRenderer('@wildcat', 6),
      channelRenderer('@cat-copy', 3),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(searchHtml(renderers))));

    const result = await invoke({ q: 'cat' });
    expect(result.statusCode).toBe(200);
    expect((result.body as Array<{ handle: string }>).map(({ handle }) => handle))
      .toEqual(['@cat', '@catz', '@catalog', '@caterpillar', '@copycat']);
  });

  it('caches repeated normalized queries', async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(searchHtml([channelRenderer('@Agent00', 1)])),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect((await invoke({ q: 'Agent00' })).statusCode).toBe(200);
    expect((await invoke({ q: '@agent00' })).statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an opaque 502 for upstream or parser failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html>blocked</html>')));

    const result = await invoke({ q: 'channel' });
    expect(result).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to search YouTube channels.' },
    });
  });

  it('rate limits one client without making another upstream request', async () => {
    process.env.TRUST_CADDY_PROXY = '1';
    const fetchMock = vi.fn(async () =>
      htmlResponse(searchHtml([channelRenderer('@channel', 1)])),
    );
    vi.stubGlobal('fetch', fetchMock);

    for (let index = 0; index < 30; index += 1) {
      expect((await invoke({ q: 'channel' })).statusCode).toBe(200);
    }

    const limited = await invoke({ q: 'channel' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await invoke({ q: 'channel' }, 'GET', '203.0.113.11')).statusCode)
      .toBe(200);
  });

  it('coalesces same-key work and bounds distinct in-flight search keys', async () => {
    const pending: Array<ReturnType<typeof deferred<Response>>> = [];
    const fetchMock = vi.fn(() => {
      const work = deferred<Response>();
      pending.push(work);
      return work.promise;
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = searchYouTubeChannels('shared');
    const joined = searchYouTubeChannels('shared');
    const distinct = Array.from(
      { length: YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX - 1 },
      (_, index) => searchYouTubeChannels(`channel ${index}`),
    );
    await expect(searchYouTubeChannels('beyond capacity')).rejects.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(
      YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX,
    ));

    for (const work of pending) work.resolve(htmlResponse(searchHtml([])));
    await expect(Promise.all([first, joined, ...distinct])).resolves.toHaveLength(
      YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1,
    );

    const recovered = searchYouTubeChannels('recovered');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(
      YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1,
    ));
    pending.at(-1)?.resolve(htmlResponse(searchHtml([])));
    await expect(recovered).resolves.toEqual([]);
  });

  it.each([
    ['chunked/no-Length', undefined],
    ['lying small Content-Length', 1],
  ] as const)('stops an oversized %s body while streaming', async (_label, declaredLength) => {
    const oversized = oversizedStreamResponse(
      YOUTUBE_CHANNEL_SEARCH_MAX_BYTES,
      declaredLength,
    );
    vi.stubGlobal('fetch', vi.fn(async () => oversized.response));

    const result = await invoke({ q: `oversized ${declaredLength ?? 'chunked'}` });
    expect(result).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to search YouTube channels.' },
    });
    expect(oversized.cancel).toHaveBeenCalledTimes(1);
  });
});
