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

import handler from '@/pages/api/twitch/hypetrain';

import {
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function response(
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status: 200,
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
  let statusCode = 200;
  let body: unknown;

  const headers =
    new Map<string, string>();

  const req = {
    method,
    query,
    headers: {},
    socket: {
      remoteAddress:
        '127.0.0.1',
    },
  } as unknown as NextApiRequest;

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

    status(code: number) {
      statusCode = code;
      return this;
    },

    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as NextApiResponse;

  return handler(
    req,
    res,
  ).then(() => ({
    statusCode,
    body,
    headers,
  }));
}

beforeEach(() => {
  resetFixedProviderResourcesForTests();
});

afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(
  'anonymous Twitch Hype Train API',
  () => {
    it(
      'returns the live level progress and goal',
      async () => {
        const fetchMock =
          vi.fn(
            async (
              _input: RequestInfo | URL,
              _init?: RequestInit,
            ) =>
              response({
                data: {
                  user: {
                    channel: {
                      hypeTrain: {
                        execution: {
                          isActive:
                            true,
                          progress: {
                            goal:
                              5000,
                            progression:
                              3600,
                            level: {
                              value:
                                3,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              }),
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        const result =
          await invoke({
            channel:
              'streamer',
          });

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual({
          active: true,
          level: 3,
          progress: 3600,
          goal: 5000,
        });

        expect(
          String(
            fetchMock.mock
              .calls[0][0],
          ),
        ).toBe(
          'https://gql.twitch.tv/gql',
        );

        expect(
          fetchMock.mock
            .calls[0][1],
        ).toMatchObject({
          method: 'POST',
          redirect: 'error',
        });
      },
    );

    it(
      'returns inactive without inventing train values',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              response({
                data: {
                  user: {
                    channel: {
                      hypeTrain: {
                        execution:
                          null,
                      },
                    },
                  },
                },
              }),
          ),
        );

        const result =
          await invoke({
            channel:
              'streamer',
          });

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual({
          active: false,
        });
      },
    );

    it(
      'rejects invalid requests before Twitch is contacted',
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
        ).toBe(405);

        expect(
          (
            await invoke({
              channel:
                'bad/channel',
            })
          ).statusCode,
        ).toBe(400);

        expect(
          (
            await invoke({
              channel: [
                'streamer',
              ],
            })
          ).statusCode,
        ).toBe(400);

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'fails closed on unexpected GQL data',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              response({
                data: {
                  user: {
                    broken: true,
                  },
                },
              }),
          ),
        );

        const result =
          await invoke({
            channel:
              'streamer',
          });

        expect(
          result.statusCode,
        ).toBe(502);

        expect(
          result.body,
        ).toEqual({
          error:
            'Unable to load Twitch Hype Train status.',
        });
      },
    );
  },
);