import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import handler, {
  TWITCH_EMOTE_PROVIDER_FRESH_MS,
  TWITCH_EMOTE_PROVIDER_HOST_PAUSE_AFTER,
  TWITCH_EMOTE_PROVIDER_TIMEOUT_MS,
  TWITCH_EMOTE_ROOM_TIMEOUT_MS,
  resetTwitchEmoteResourceCacheForTests,
} from '@/pages/api/twitch/emote-resources';

import {
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function response(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(
      body,
    ),
    {
      status,

      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
}

function invoke(
  query:
    Record<
      string,
      string | string[]
    > = {},
  method = 'GET',
) {
  let statusCode =
    200;

  let body:
    unknown;

  const headers =
    new Map<
      string,
      string
    >();

  const req = {
    method,
    query,
    headers: {},

    socket: {
      remoteAddress:
        '127.0.0.1',
    },
  } as unknown as
    NextApiRequest;

  const res = {
    setHeader(
      name: string,
      value: string,
    ) {
      headers.set(
        name,
        value,
      );
    },

    status(
      code: number,
    ) {
      statusCode =
        code;

      return this;
    },

    json(
      value: unknown,
    ) {
      body =
        value;

      return this;
    },
  } as unknown as
    NextApiResponse;

  return handler(
    req,
    res,
  ).then(
    () => ({
      statusCode,
      body,
      headers,
    }),
  );
}

beforeEach(
  () => {
    resetFixedProviderResourcesForTests();
    resetTwitchEmoteResourceCacheForTests();
  },
);

afterEach(
  () => {
    resetFixedProviderResourcesForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe(
  'Twitch emote resource API',
  () => {
    it(
      'rejects methods and invalid ids before touching an upstream',
      async () => {
        const fetchMock =
          vi.fn();

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          (
            await invoke(
              {},
              'POST',
            )
          ).statusCode,
        ).toBe(
          405,
        );

        expect(
          (
            await invoke({
              channelId:
                'bad/id',
            })
          ).statusCode,
        ).toBe(
          400,
        );

        expect(
          fetchMock,
        ).not
          .toHaveBeenCalled();
      },
    );

    it(
      'fans one browser request out only to the five fixed provider URLs',
      async () => {
        const expected =
          new Map<
            string,
            unknown
          >([
            [
              'https://api.betterttv.net/3/cached/frankerfacez/emotes/global',
              ['ffz-global'],
            ],

            [
              'https://api.betterttv.net/3/cached/frankerfacez/users/twitch/42',
              ['ffz-channel'],
            ],

            [
              'https://api.betterttv.net/3/cached/emotes/global',
              ['bttv-global'],
            ],

            [
              'https://api.betterttv.net/3/cached/users/twitch/42',
              {
                channelEmotes: [
                  'bttv-channel',
                ],
              },
            ],

            [
              'https://api.frankerfacez.com/v1/_room/id/42',
              {
                room: {
                  moderator_badge:
                    true,
                },
              },
            ],
          ]);

        const fetchMock =
          vi.fn(
            async (
              input:
                RequestInfo
                | URL,

              init?:
                RequestInit,
            ) => {
              expect(
                init
                  ?.redirect,
              ).toBe(
                'error',
              );

              const url =
                String(
                  input,
                );

              if (
                !expected.has(
                  url,
                )
              ) {
                throw new Error(
                  'unexpected URL '
                  + url,
                );
              }

              return response(
                expected.get(
                  url,
                ),
              );
            },
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        const result =
          await invoke({
            channelId:
              '42',
          });

        expect(
          result
            .statusCode,
        ).toBe(
          200,
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          5,
        );

        expect(
          result.body,
        ).toEqual({
          ffzGlobal:
            ['ffz-global'],

          ffzChannel:
            ['ffz-channel'],

          bttvGlobal:
            ['bttv-global'],

          bttvChannel: {
            channelEmotes: [
              'bttv-channel',
            ],
          },

          ffzRoom: {
            room: {
              moderator_badge:
                true,
            },
          },
        });

        expect(
          result.headers.get(
            'Cache-Control',
          ),
        ).toContain(
          's-maxage=60',
        );
      },
    );

    it(
      'keeps healthy neighbors when one fixed provider returns an error',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async (
              input:
                RequestInfo
                | URL,
            ) => {
              const url =
                String(
                  input,
                );

              if (
                url.endsWith(
                  '/frankerfacez/emotes/global',
                )
              ) {
                return response(
                  {
                    error:
                      'offline',
                  },
                  503,
                );
              }

              return response({
                source:
                  url,
              });
            },
          ),
        );

        const result =
          await invoke({
            channelId:
              '42',
          });

        expect(
          result
            .statusCode,
        ).toBe(
          200,
        );

        const body =
          (result.body as Record<string, unknown>);

        expect(
          body.ffzGlobal,
        ).toBeNull();

        expect(
          body.ffzChannel,
        ).not
          .toBeNull();

        expect(
          body.bttvGlobal,
        ).not
          .toBeNull();

        expect(
          body.bttvChannel,
        ).not
          .toBeNull();

        expect(
          body.ffzRoom,
        ).not
          .toBeNull();
      },
    );
  },
);

describe('Twitch emote resources under provider trouble', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers with the healthy providers when one never answers (FFZ room hanging)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.frankerfacez.com')) return new Promise<Response>(() => {});
      return response({ source: url });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = invoke({ channelId: '42' });
    await vi.advanceTimersByTimeAsync(TWITCH_EMOTE_ROOM_TIMEOUT_MS + 10);
    const result = await pending;

    expect(result.statusCode).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.ffzRoom).toBeNull();
    expect(body.ffzGlobal).not.toBeNull();
    expect(body.ffzChannel).not.toBeNull();
    expect(body.bttvGlobal).not.toBeNull();
    expect(body.bttvChannel).not.toBeNull();

    /* After failing to answer several times in a row, the hanging host is
       skipped for everyone instead of each channel waiting on it again. */
    for (let i = 1; i < TWITCH_EMOTE_PROVIDER_HOST_PAUSE_AFTER; i += 1) {
      const more = invoke({ channelId: String(100 + i) });
      await vi.advanceTimersByTimeAsync(TWITCH_EMOTE_ROOM_TIMEOUT_MS + 10);
      await more;
    }
    fetchMock.mockClear();
    const next = await invoke({ channelId: '43' });
    expect(next.statusCode).toBe(200);
    expect(fetchMock.mock.calls.map(([u]) => String(u)).some((u) => u.includes('api.frankerfacez.com'))).toBe(false);
  });

  it('does not skip a healthy host because one of its lookups was slow (BTTV on an uncached channel)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/frankerfacez/users/twitch/42')) return new Promise<Response>(() => {});
      return response({ source: url });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = invoke({ channelId: '42' });
    await vi.advanceTimersByTimeAsync(TWITCH_EMOTE_PROVIDER_TIMEOUT_MS + 10);
    expect(((await pending).body as Record<string, unknown>).ffzChannel).toBeNull();

    const next = await invoke({ channelId: '43' });
    const body = next.body as Record<string, { source: string } | null>;
    expect(body.bttvChannel?.source).toBe('https://api.betterttv.net/3/cached/users/twitch/43');
    expect(body.ffzChannel?.source).toBe('https://api.betterttv.net/3/cached/frankerfacez/users/twitch/43');
  });

  it('waits long enough for BTTV\'s first answer on an uncached channel (about 5 s)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/frankerfacez/users/twitch/42')) {
        await new Promise((resolve) => setTimeout(resolve, 5_100));
        return response(['slow-but-real']);
      }
      return response({ source: url });
    }));
    const pending = invoke({ channelId: '42' });
    await vi.advanceTimersByTimeAsync(5_200);
    expect(((await pending).body as Record<string, unknown>).ffzChannel).toEqual(['slow-but-real']);
  });

  it('never gives one channel another channel\'s emotes, even when requests overlap', async () => {
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/users/twitch/42')) await firstGate;
      return response({ source: url });
    }));

    const first = invoke({ channelId: '42' });
    const second = invoke({ channelId: '43' });
    const secondResult = await second;
    releaseFirst();
    const firstResult = await first;

    expect((secondResult.body as Record<string, { source: string }>).bttvChannel.source)
      .toBe('https://api.betterttv.net/3/cached/users/twitch/43');
    expect((firstResult.body as Record<string, { source: string }>).bttvChannel.source)
      .toBe('https://api.betterttv.net/3/cached/users/twitch/42');
  });

  it('reuses good answers, and keeps serving the last good one while a provider is down', async () => {
    vi.useFakeTimers();
    let bttvDown = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (bttvDown && url.endsWith('/cached/emotes/global')) return response({ error: 'down' }, 503);
      return response({ source: url, version: bttvDown ? 2 : 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await invoke({ channelId: '42' });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    /* Within the fresh window: no upstream requests at all. */
    fetchMock.mockClear();
    const again = await invoke({ channelId: '42' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(again.body).toEqual(first.body);

    /* Later, BTTV global fails: its last good list is still served. */
    vi.setSystemTime(Date.now() + TWITCH_EMOTE_PROVIDER_FRESH_MS + 1_000);
    bttvDown = true;
    const later = await invoke({ channelId: '42' });
    const body = later.body as Record<string, { version: number } | null>;
    expect(body.bttvGlobal?.version).toBe(1);
    expect(body.bttvChannel?.version).toBe(2);
  });
});
