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

import handler
  from '@/pages/api/twitch/emote-resources';

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
