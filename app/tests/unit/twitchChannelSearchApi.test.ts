import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, {
  __resetTwitchChannelSearchRateLimitForTests,
} from '@/pages/api/twitch/channel-search';
import {
  TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX,
  TWITCH_CHANNEL_SEARCH_MAX_BYTES,
  __resetTwitchChannelSearchCacheForTests,
  searchTwitchChannels,
} from '@/lib/server/twitchChannelSearch';
import {
  TWITCH_APP_TOKEN_MAX_BYTES,
  __resetTwitchAppAccessTokenForTests,
} from '@/lib/server/twitchAppAccessToken';

const originalVercel = process.env.VERCEL;
const originalTrustedCaddy = process.env.TRUST_CADDY_PROXY;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function channel(
  broadcaster_login: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    broadcaster_login,
    display_name: broadcaster_login.toUpperCase(),
    thumbnail_url: `https://static-cdn.jtvnw.net/${broadcaster_login}.png`,
    is_live: false,
    game_name: 'Just Chatting',
    id: `id-${broadcaster_login}`,
    title: `title-${broadcaster_login}`,
    ...overrides,
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

  return Promise.resolve(handler(req, res)).then(() => ({ statusCode, body, headers }));
}

function successfulFetch(searchData: unknown[]) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://id.twitch.tv/oauth2/token') {
      return jsonResponse({
        access_token: 'server-app-token',
        expires_in: 3_600,
        token_type: 'bearer',
      });
    }
    if (url.startsWith('https://api.twitch.tv/helix/search/channels?')) {
      return jsonResponse({ data: searchData, pagination: {} });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

beforeEach(() => {
  delete process.env.VERCEL;
  delete process.env.TRUST_CADDY_PROXY;
  process.env.TWITCH_CLIENT_ID = 'server-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'server-client-secret';
  __resetTwitchChannelSearchRateLimitForTests();
  __resetTwitchChannelSearchCacheForTests();
  __resetTwitchAppAccessTokenForTests();
});

afterEach(() => {
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  __resetTwitchChannelSearchRateLimitForTests();
  __resetTwitchChannelSearchCacheForTests();
  __resetTwitchAppAccessTokenForTests();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalTrustedCaddy === undefined) delete process.env.TRUST_CADDY_PROXY;
  else process.env.TRUST_CADDY_PROXY = originalTrustedCaddy;
  vi.unstubAllGlobals();
});

describe('Twitch channel search API', () => {
  it('rejects unsupported methods and malformed or short queries before fetching', async () => {
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

  it('normalizes, ranks, caps, and allowlists the returned channel fields', async () => {
    const fetchMock = successfulFetch([
      channel('copycat'),
      channel('caterpillar'),
      channel('cat'),
      channel('catalog'),
      channel('catz', { is_live: true, game_name: 'VALORANT' }),
      channel('wildcat'),
      channel('bobcat'),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await invoke({ q: '  @CAT  ' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([
      {
        broadcaster_login: 'cat',
        display_name: 'CAT',
        thumbnail_url: 'https://static-cdn.jtvnw.net/cat.png',
        is_live: false,
        game_name: 'Just Chatting',
      },
      {
        broadcaster_login: 'catz',
        display_name: 'CATZ',
        thumbnail_url: 'https://static-cdn.jtvnw.net/catz.png',
        is_live: true,
        game_name: 'VALORANT',
      },
      {
        broadcaster_login: 'catalog',
        display_name: 'CATALOG',
        thumbnail_url: 'https://static-cdn.jtvnw.net/catalog.png',
        is_live: false,
        game_name: 'Just Chatting',
      },
      {
        broadcaster_login: 'caterpillar',
        display_name: 'CATERPILLAR',
        thumbnail_url: 'https://static-cdn.jtvnw.net/caterpillar.png',
        is_live: false,
        game_name: 'Just Chatting',
      },
      {
        broadcaster_login: 'bobcat',
        display_name: 'BOBCAT',
        thumbnail_url: 'https://static-cdn.jtvnw.net/bobcat.png',
        is_live: false,
        game_name: 'Just Chatting',
      },
    ]);

    const tokenCall = fetchMock.mock.calls[0];
    expect(String(tokenCall[0])).toBe('https://id.twitch.tv/oauth2/token');
    expect(String((tokenCall[1] as RequestInit).body)).toContain('client_secret=server-client-secret');
    expect((tokenCall[1] as RequestInit).redirect).toBe('error');

    const searchCall = fetchMock.mock.calls[1];
    const searchUrl = new URL(String(searchCall[0]));
    expect(searchUrl.searchParams.get('query')).toBe('cat');
    expect(searchUrl.searchParams.get('first')).toBe('20');
    expect((searchCall[1] as RequestInit).headers).toEqual({
      Authorization: 'Bearer server-app-token',
      'Client-Id': 'server-client-id',
    });
    expect((searchCall[1] as RequestInit).redirect).toBe('error');
    expect(JSON.stringify(result.body)).not.toContain('server-client-secret');
    expect(JSON.stringify(result.body)).not.toContain('server-app-token');
  });

  it('reuses both the query cache and the app token cache', async () => {
    const fetchMock = successfulFetch([channel('channel')]);
    vi.stubGlobal('fetch', fetchMock);

    expect((await invoke({ q: 'channel' })).statusCode).toBe(200);
    expect((await invoke({ q: 'channel' })).statusCode).toBe(200);
    expect((await invoke({ q: 'different' })).statusCode).toBe(200);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url === 'https://id.twitch.tv/oauth2/token')).toHaveLength(1);
    expect(urls.filter((url) => url.startsWith('https://api.twitch.tv/helix/search/channels?')))
      .toHaveLength(2);
  });

  it('invalidates a rejected app token and retries the search once', async () => {
    let tokenRequests = 0;
    let searchRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://id.twitch.tv/oauth2/token') {
        tokenRequests += 1;
        return jsonResponse({
          access_token: `app-token-${tokenRequests}`,
          expires_in: 3_600,
          token_type: 'bearer',
        });
      }
      searchRequests += 1;
      return searchRequests === 1
        ? jsonResponse({}, 401)
        : jsonResponse({ data: [channel('channel')] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await invoke({ q: 'channel' });
    expect(result.statusCode).toBe(200);
    expect(tokenRequests).toBe(2);
    expect(searchRequests).toBe(2);
    const searchCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith('https://api.twitch.tv/helix/search/channels?'),
    );
    expect((searchCalls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer app-token-1',
    });
    expect((searchCalls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer app-token-2',
    });
  });

  it('rate limits one client without making another upstream request', async () => {
    process.env.TRUST_CADDY_PROXY = '1';
    const fetchMock = successfulFetch([channel('channel')]);
    vi.stubGlobal('fetch', fetchMock);

    for (let index = 0; index < 30; index += 1) {
      expect((await invoke({ q: 'channel' })).statusCode).toBe(200);
    }
    const limited = await invoke({ q: 'channel' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect((await invoke({ q: 'channel' }, 'GET', '203.0.113.11')).statusCode).toBe(200);
  });

  it('returns an opaque upstream error for malformed Twitch data', async () => {
    vi.stubGlobal('fetch', successfulFetch([channel('UPPERCASE')]));
    const result = await invoke({ q: 'channel' });
    expect(result).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to search Twitch channels.' },
    });
  });

  it('coalesces same-key work and bounds distinct in-flight search keys', async () => {
    const searches: Array<ReturnType<typeof deferred<Response>>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://id.twitch.tv/oauth2/token') {
        return jsonResponse({
          access_token: 'server-app-token',
          expires_in: 3_600,
          token_type: 'bearer',
        });
      }
      const work = deferred<Response>();
      searches.push(work);
      return work.promise;
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = searchTwitchChannels('shared');
    const joined = searchTwitchChannels('shared');
    const distinct = Array.from(
      { length: TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX - 1 },
      (_, index) => searchTwitchChannels(`channel${index}`),
    );
    await expect(searchTwitchChannels('beyondcapacity')).rejects.toThrow();
    await vi.waitFor(() => expect(searches).toHaveLength(TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX));

    for (const work of searches) work.resolve(jsonResponse({ data: [] }));
    await expect(Promise.all([first, joined, ...distinct])).resolves.toHaveLength(
      TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1,
    );

    const recovered = searchTwitchChannels('recovered');
    await vi.waitFor(() => expect(searches).toHaveLength(TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1));
    searches.at(-1)?.resolve(jsonResponse({ data: [] }));
    await expect(recovered).resolves.toEqual([]);
  });

  it('rejects malformed and oversized token/search JSON generically', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('x', {
        headers: { 'Content-Length': String(TWITCH_APP_TOKEN_MAX_BYTES + 1) },
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'server-app-token',
        expires_in: 3_600,
        token_type: 'bearer',
      }))
      .mockResolvedValueOnce(new Response('{private malformed body'))
      .mockResolvedValueOnce(new Response('x', {
        headers: { 'Content-Length': String(TWITCH_CHANNEL_SEARCH_MAX_BYTES + 1) },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const tokenFailure = await invoke({ q: 'tokenfailure' });
    const malformed = await invoke({ q: 'malformed' });
    const oversized = await invoke({ q: 'oversized' });
    expect(tokenFailure.statusCode).toBe(502);
    expect(malformed.statusCode).toBe(502);
    expect(oversized.statusCode).toBe(502);
    expect(JSON.stringify(malformed.body)).not.toContain('private malformed body');
  });
});
