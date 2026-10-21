import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, {
  __resetTikTokChannelSearchRateLimitForTests,
} from '@/pages/api/tiktok/channel-search';
import {
  TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX,
  TIKTOK_CHANNEL_SEARCH_MAX_BYTES,
  __resetTikTokChannelSearchCacheForTests,
  searchTikTokChannels,
} from '@/lib/server/tiktokChannelSearch';

const originalVercel = process.env.VERCEL;
const originalTrustedCaddy = process.env.TRUST_CADDY_PROXY;

const SAFE_AVATAR =
  'https://p16-common-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/avatar.jpeg';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function hydrationHtml(detail: unknown): string {
  return [
    '<!doctype html><html><head>',
    '<script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">',
    JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.user-detail': detail,
      },
    }),
    '</script></head><body></body></html>',
  ].join('');
}

function profileDetail(
  overrides: {
    user?: Record<string, unknown>;
    stats?: Record<string, unknown>;
    statsV2?: Record<string, unknown>;
    statusCode?: number;
  } = {},
) {
  return {
    statusCode: overrides.statusCode ?? 0,
    userInfo: {
      user: {
        id: '107955',
        uniqueId: 'tiktok',
        nickname: 'TikTok',
        avatarMedium: SAFE_AVATAR,
        verified: true,
        ...overrides.user,
      },
      stats: {
        followerCount: 95_900_000,
        ...overrides.stats,
      },
      statsV2: {
        followerCount: '95853133',
        ...overrides.statsV2,
      },
    },
  };
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

function invoke(
  query: Record<string, string | string[]> = { q: 'tiktok' },
  method = 'GET',
  ip = '203.0.113.20',
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
  __resetTikTokChannelSearchRateLimitForTests();
  __resetTikTokChannelSearchCacheForTests();
});

afterEach(() => {
  __resetTikTokChannelSearchRateLimitForTests();
  __resetTikTokChannelSearchCacheForTests();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalTrustedCaddy === undefined) delete process.env.TRUST_CADDY_PROXY;
  else process.env.TRUST_CADDY_PROXY = originalTrustedCaddy;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TikTok channel search API', () => {
  it('rejects unsupported methods and invalid or unsafe queries before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const method = await invoke({ q: 'tiktok' }, 'POST');
    expect(method.statusCode).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');

    const invalidQueries: Array<Record<string, string | string[]>> = [
      { q: 'tt' },
      { q: 'bad-name' },
      { q: ['tiktok', 'duplicate'] },
      { q: 'https://example.com/@tiktok' },
      { q: 'https://www.tiktok.com/search/user' },
      { q: 'https://www.tiktok.com.evil.example/@tiktok' },
      { q: 'https://www.tiktok.com@127.0.0.1/@tiktok' },
      { q: `https://www.tiktok.com/@${'x'.repeat(60)}` },
    ];

    for (const query of invalidQueries) {
      expect((await invoke(query)).statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes username, @username, and profile URLs to one cached lookup', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => htmlResponse(hydrationHtml(profileDetail())));
    vi.stubGlobal('fetch', fetchMock);

    const queries = [
      'TikTok',
      '@TikTok',
      'https://www.tiktok.com/@TikTok',
      'https://tiktok.com/@TikTok',
    ];
    for (const query of queries) {
      expect((await invoke({ q: query })).statusCode).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toBe('https://www.tiktok.com/@tiktok');
    expect((init as RequestInit).cache).toBe('no-store');
    expect((init as RequestInit).redirect).toBe('error');
    expect((init as RequestInit).headers).toMatchObject({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    expect((init as RequestInit).headers).not.toHaveProperty('Cookie');
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('returns one safe suggestion from the observed hydration shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse(hydrationHtml(profileDetail()))),
    );

    const result = await invoke({ q: 'tiktok' });
    expect(result.statusCode).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(result.body).toEqual([
      {
        username: 'tiktok',
        display_name: 'TikTok',
        thumbnail_url: SAFE_AVATAR,
        followers_count: 95_853_133,
        verified: true,
        is_live: false,
      },
    ]);
    expect((result.body as unknown[])).toHaveLength(1);
  });

  it('returns an empty result for the observed nonexistent-profile status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse(hydrationHtml({ statusCode: 10_221 }))),
    );

    const result = await invoke({ q: 'not_a_real_tiktok_user' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([]);
  });

  it.each([
    ['an unrelated HTTPS host', 'https://example.com/avatar.jpeg'],
    ['an insecure TikTok CDN URL', SAFE_AVATAR.replace('https:', 'http:')],
  ])('drops %s without losing the account', async (_label, avatar) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse(hydrationHtml(profileDetail({
        user: { avatarMedium: avatar },
      })))),
    );

    const result = await invoke({ q: 'tiktok' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([
      expect.objectContaining({
        username: 'tiktok',
        thumbnail_url: null,
      }),
    ]);
  });

  it('returns an opaque 502 for missing or malformed hydration', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<html>blocked</html>'))
      .mockResolvedValueOnce(htmlResponse(
        '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{bad json}</script>',
      ));
    vi.stubGlobal('fetch', fetchMock);

    for (const query of ['blockeduser', 'malformeduser']) {
      const result = await invoke({ q: query });
      expect(result).toMatchObject({
        statusCode: 502,
        body: { error: 'Unable to search TikTok channels.' },
      });
    }
  });

  it('aborts a timed-out upstream request and returns a safe 502', async () => {
    vi.useFakeTimers();
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        upstreamSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }));

    const pending = invoke({ q: 'timeoutuser' });
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to search TikTok channels.' },
    });
  });

  it('deduplicates concurrent requests for the same normalized username', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = invoke({ q: 'TikTok' }, 'GET', '203.0.113.21');
    const second = invoke({ q: '@tiktok' }, 'GET', '203.0.113.22');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    resolveFetch?.(htmlResponse(hydrationHtml(profileDetail())));
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rate limits one client without making another upstream request', async () => {
    process.env.TRUST_CADDY_PROXY = '1';
    const fetchMock = vi.fn(async () =>
      htmlResponse(hydrationHtml(profileDetail())),
    );
    vi.stubGlobal('fetch', fetchMock);

    for (let index = 0; index < 30; index += 1) {
      expect((await invoke({ q: 'tiktok' })).statusCode).toBe(200);
    }

    const limited = await invoke({ q: 'tiktok' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await invoke({ q: 'tiktok' }, 'GET', '203.0.113.23')).statusCode)
      .toBe(200);
  });

  it('bounds distinct in-flight usernames and frees capacity after settlement', async () => {
    const pending: Array<ReturnType<typeof deferred<Response>>> = [];
    const fetchMock = vi.fn(() => {
      const work = deferred<Response>();
      pending.push(work);
      return work.promise;
    });
    vi.stubGlobal('fetch', fetchMock);

    const requests = Array.from(
      { length: TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX },
      (_, index) => searchTikTokChannels(`user${String(index).padStart(3, '0')}`),
    );
    await expect(searchTikTokChannels('beyondcapacity')).rejects.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(
      TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX,
    ));

    for (let index = 0; index < pending.length; index += 1) {
      pending[index].resolve(htmlResponse(hydrationHtml(profileDetail({
        user: { uniqueId: `user${String(index).padStart(3, '0')}` },
      }))));
    }
    await expect(Promise.all(requests)).resolves.toHaveLength(
      TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX,
    );

    const recovered = searchTikTokChannels('recovered');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(
      TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1,
    ));
    pending.at(-1)?.resolve(htmlResponse(hydrationHtml(profileDetail({
      user: { uniqueId: 'recovered' },
    }))));
    await expect(recovered).resolves.toEqual([
      expect.objectContaining({ username: 'recovered' }),
    ]);
  });

  it.each([
    ['chunked/no-Length', undefined],
    ['lying small Content-Length', 1],
  ] as const)('stops an oversized %s UTF-8 body while streaming', async (_label, declaredLength) => {
    const oversized = oversizedStreamResponse(
      TIKTOK_CHANNEL_SEARCH_MAX_BYTES,
      declaredLength,
    );
    vi.stubGlobal('fetch', vi.fn(async () => oversized.response));

    const result = await invoke({ q: `oversized${declaredLength ?? 'chunked'}` });
    expect(result).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to search TikTok channels.' },
    });
    expect(oversized.cancel).toHaveBeenCalledTimes(1);
  });
});
