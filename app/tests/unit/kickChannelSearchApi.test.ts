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
  __resetKickChannelSearchRateLimitForTests,
} from '@/pages/api/kick/channel-search';

import {
  KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX,
  KICK_CHANNEL_PROFILE_MAX_BYTES,
  KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX,
  KICK_CHANNEL_SEARCH_MAX_BYTES,
  __kickChannelSearchResourceStatsForTests,
  __resetKickChannelSearchCacheForTests,
  searchKickChannels,
} from '@/lib/server/kickChannelSearch';

const originalVercel = process.env.VERCEL;
const originalTrustedCaddy = process.env.TRUST_CADDY_PROXY;
const KICK_TYPESENSE_TEST_URL = 'https://search.kick.com/multi_search';

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function typesenseHit(
  slug: string,
  overrides:
    Partial<Record<string, unknown>> = {},
) {
  return {
    document: {
      id: '1',
      slug,
      username:
        slug.toUpperCase(),
      followers_count: 50,
      is_live: false,
      verified: false,
      is_banned: false,
      ...overrides,
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

function invoke(
  query:
    Record<
      string,
      string | string[]
    > = {
      q: 'channel',
    },

  method = 'GET',

  ip =
    '203.0.113.10',
) {
  let statusCode = 200;
  let body: unknown;

  const headers =
    new Map<string, string>();

  const trustedCaddy = process.env.TRUST_CADDY_PROXY === '1';
  const req = {
    method,
    query,

    headers: {
      'x-forwarded-for': '198.51.100.240',
      'x-real-ip': '198.51.100.241',
      'x-gxufy-client-ip': ip,
    },

    socket: {
      remoteAddress:
        trustedCaddy
          ? '127.0.0.1'
          : ip,
    },
  } as unknown as NextApiRequest;

  const res = {
    setHeader(
      name: string,
      value:
        | string
        | number
        | readonly string[],
    ) {
      headers.set(
        name.toLowerCase(),
        String(value),
      );

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

  return Promise.resolve(
    handler(req, res),
  ).then(() => ({
    statusCode,
    body,
    headers,
  }));
}

beforeEach(() => {
  delete process.env.VERCEL;
  delete process.env.TRUST_CADDY_PROXY;
  process.env.KICK_TYPESENSE_SEARCH_KEY =
    'public-test-key';

  __resetKickChannelSearchRateLimitForTests();
  __resetKickChannelSearchCacheForTests();
});

afterEach(() => {
  delete process.env
    .KICK_TYPESENSE_SEARCH_KEY;

  __resetKickChannelSearchRateLimitForTests();
  __resetKickChannelSearchCacheForTests();

  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalTrustedCaddy === undefined) delete process.env.TRUST_CADDY_PROXY;
  else process.env.TRUST_CADDY_PROXY = originalTrustedCaddy;

  vi.unstubAllGlobals();
});

describe(
  'Kick channel search API',
  () => {
    it(
      'rejects invalid requests before fetching',
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
              { q: 'valid' },
              'POST',
            )
          ).statusCode,
        ).toBe(405);

        expect(
          (
            await invoke({
              q: 'ab',
            })
          ).statusCode,
        ).toBe(400);

        expect(
          (
            await invoke({
              q: 'bad/name',
            })
          ).statusCode,
        ).toBe(400);

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'uses Typesense, ranks results, caps at five, and exposes only safe fields',
      async () => {
        const fetchMock =
          vi.fn(
            async (
              input:
                RequestInfo | URL,
              init?: RequestInit,
            ) => {
              expect(
                String(input),
              ).toBe(
                'https://search.kick.com/multi_search',
              );

              expect(
                init?.method,
              ).toBe('POST');

              expect(
                init?.redirect,
              ).toBe('error');

              const headers =
                init?.headers as Record<
                  string,
                  string
                >;

              expect(
                headers[
                  'X-Typesense-Api-Key'
                ],
              ).toBe(
                'public-test-key',
              );

              expect(
                JSON.parse(
                  String(
                    init?.body,
                  ),
                ),
              ).toEqual({
                searches: [
                  {
                    preset:
                      'channel_search',
                    q: 'cat',
                  },
                ],
              });

              return jsonResponse({
                results: [
                  {
                    found: 6,

                    hits: [
                      typesenseHit(
                        'wildcat',
                      ),

                      typesenseHit(
                        'catalog',
                      ),

                      typesenseHit(
                        'cat',
                      ),

                      typesenseHit(
                        'catz',
                        {
                          is_live: true,
                          followers_count:
                            1200,
                          verified: true,
                        },
                      ),

                      typesenseHit(
                        'caterpillar',
                      ),

                      typesenseHit(
                        'copycat',
                      ),
                    ],
                  },
                ],
              });
            },
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        const result =
          await invoke({
            q: '  @CAT  ',
          });

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual([
          {
            slug: 'cat',
            display_name:
              'CAT',
            thumbnail_url:
              null,
            is_live: false,
            followers_count:
              50,
            verified: false,
          },

          {
            slug: 'catz',
            display_name:
              'CATZ',
            thumbnail_url:
              null,
            is_live: true,
            followers_count:
              1200,
            verified: true,
          },

          {
            slug:
              'catalog',
            display_name:
              'CATALOG',
            thumbnail_url:
              null,
            is_live: false,
            followers_count:
              50,
            verified: false,
          },

          {
            slug:
              'caterpillar',
            display_name:
              'CATERPILLAR',
            thumbnail_url:
              null,
            is_live: false,
            followers_count:
              50,
            verified: false,
          },

          {
            slug:
              'copycat',
            display_name:
              'COPYCAT',
            thumbnail_url:
              null,
            is_live: false,
            followers_count:
              50,
            verified: false,
          },
        ]);
      },
    );

    it(
      'filters banned channels',
      async () => {
        vi.stubGlobal(
          'fetch',

          vi.fn(async () =>
            jsonResponse({
              results: [
                {
                  hits: [
                    typesenseHit(
                      'goodchannel',
                    ),

                    typesenseHit(
                      'badchannel',
                      {
                        is_banned:
                          true,
                      },
                    ),
                  ],
                },
              ],
            }),
          ),
        );

        const result =
          await invoke({
            q: 'channel',
          });

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          JSON.stringify(
            result.body,
          ),
        ).not.toContain(
          'badchannel',
        );
      },
    );

    it(
      'returns 502 when Typesense fails',
      async () => {
        vi.stubGlobal(
          'fetch',

          vi.fn(async () =>
            jsonResponse(
              {
                message:
                  'Unauthorized',
              },
              401,
            ),
          ),
        );

        const result =
          await invoke({
            q: 'channel',
          });

        expect(
          result.statusCode,
        ).toBe(502);

        expect(
          result.body,
        ).toEqual({
          error:
            'Unable to search Kick channels.',
        });
      },
    );

    it(
      'returns an opaque 502 for malformed Typesense JSON',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response('{private malformed body')),
        );

        const result = await invoke({ q: 'malformed' });
        expect(result).toMatchObject({
          statusCode: 502,
          body: { error: 'Unable to search Kick channels.' },
        });
        expect(JSON.stringify(result.body)).not.toContain('private malformed body');
      },
    );

    it(
      'keeps the suggestion when the avatar lookup fails',
      async () => {
        vi.stubGlobal(
          'fetch',

          vi.fn(async (
            input:
              RequestInfo | URL,
            init?: RequestInit,
          ) => {
            if (
              String(input) ===
              'https://search.kick.com/multi_search'
            ) {
              return jsonResponse({
                results: [
                  {
                    hits: [
                      typesenseHit(
                        'channel',
                      ),
                    ],
                  },
                ],
              });
            }

            expect(init?.redirect).toBe('error');

            return jsonResponse(
              {
                error:
                  'Profile lookup failed',
              },
              403,
            );
          }),
        );

        const result =
          await invoke({
            q: 'channel',
          });

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual([
          {
            slug:
              'channel',

            display_name:
              'CHANNEL',

            thumbnail_url:
              null,

            is_live:
              false,

            followers_count:
              50,

            verified:
              false,
          },
        ]);
      },
    );

    it(
      'caches repeated queries',
      async () => {
        const fetchMock =
          vi.fn(async () =>
            jsonResponse({
              results: [
                {
                  hits: [
                    typesenseHit(
                      'channel',
                    ),
                  ],
                },
              ],
            }),
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          (
            await invoke({
              q: 'channel',
            })
          ).statusCode,
        ).toBe(200);

        expect(
          (
            await invoke({
              q: 'channel',
            })
          ).statusCode,
        ).toBe(200);

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      'rate limits one client',
      async () => {
        process.env.TRUST_CADDY_PROXY = '1';
        vi.stubGlobal(
          'fetch',

          vi.fn(async () =>
            jsonResponse({
              results: [
                {
                  hits: [
                    typesenseHit(
                      'channel',
                    ),
                  ],
                },
              ],
            }),
          ),
        );

        for (
          let index = 0;
          index < 30;
          index += 1
        ) {
          expect(
            (
              await invoke({
                q: 'channel',
              })
            ).statusCode,
          ).toBe(200);
        }

        const limited =
          await invoke({
            q: 'channel',
          });

        expect(
          limited.statusCode,
        ).toBe(429);

        expect(
          Number(
            limited.headers.get(
              'retry-after',
            ),
          ),
        ).toBeGreaterThan(0);

        expect(
          (
            await invoke(
              { q: 'channel' },
              'GET',
              '203.0.113.11',
            )
          ).statusCode,
        ).toBe(200);
      },
    );

    it(
      'coalesces same-key work and bounds distinct in-flight search keys',
      async () => {
        const pending: Array<ReturnType<typeof deferred<Response>>> = [];
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
          expect(String(input)).toBe(KICK_TYPESENSE_TEST_URL);
          const work = deferred<Response>();
          pending.push(work);
          return work.promise;
        });
        vi.stubGlobal('fetch', fetchMock);

        const first = searchKickChannels('shared');
        const joined = searchKickChannels('shared');
        const distinct = Array.from(
          { length: KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX - 1 },
          (_, index) => searchKickChannels(`channel${index}`),
        );
        await expect(searchKickChannels('beyondcapacity')).rejects.toThrow();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(
          KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX,
        ));

        for (const work of pending) {
          work.resolve(jsonResponse({ results: [{ hits: [] }] }));
        }
        await expect(Promise.all([first, joined, ...distinct])).resolves.toHaveLength(
          KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1,
        );

        const recovered = searchKickChannels('recovered');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(
          KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX + 1,
        ));
        pending.at(-1)?.resolve(jsonResponse({ results: [{ hits: [] }] }));
        await expect(recovered).resolves.toEqual([]);
      },
    );

    it(
      'bounds profile in-flight work without failing the search result',
      async () => {
        const profileWork: Array<ReturnType<typeof deferred<Response>>> = [];
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url === KICK_TYPESENSE_TEST_URL) {
            const query = (JSON.parse(String(init?.body)) as {
              searches: Array<{ q: string }>;
            }).searches[0].q;
            return Promise.resolve(jsonResponse({
              results: [{
                hits: Array.from({ length: 5 }, (_, index) => (
                  typesenseHit(`${query}_${index}`)
                )),
              }],
            }));
          }

          const work = deferred<Response>();
          profileWork.push(work);
          return work.promise;
        });
        vi.stubGlobal('fetch', fetchMock);

        const searches = Array.from(
          { length: KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX / 5 },
          (_, index) => searchKickChannels(`batch${index}`),
        );
        await vi.waitFor(() => expect(profileWork).toHaveLength(
          KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX,
        ));
        expect(__kickChannelSearchResourceStatsForTests().profileInFlight).toBe(
          KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX,
        );

        const overflow = await searchKickChannels('overflow');
        expect(overflow).toHaveLength(5);
        expect(overflow.every((result) => result.thumbnail_url === null)).toBe(true);
        expect(profileWork).toHaveLength(KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX);

        for (const work of profileWork) {
          work.resolve(jsonResponse({ data: {} }));
        }
        await expect(Promise.all(searches)).resolves.toHaveLength(
          KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX / 5,
        );
        await vi.waitFor(() => expect(
          __kickChannelSearchResourceStatsForTests().profileInFlight,
        ).toBe(0));
      },
    );

    it(
      'rejects oversized search JSON and degrades oversized profile JSON to no avatar',
      async () => {
        const searchCancel = vi.fn();
        let stage = 0;
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === KICK_TYPESENSE_TEST_URL) {
            stage += 1;
            if (stage === 1) {
              return new Response(new ReadableStream<Uint8Array>({
                pull(controller) {
                  controller.enqueue(new Uint8Array(KICK_CHANNEL_SEARCH_MAX_BYTES));
                  controller.enqueue(new Uint8Array([1]));
                },
                cancel: searchCancel,
              }));
            }
            return jsonResponse({ results: [{ hits: [typesenseHit('profilelimit')] }] });
          }
          return new Response('x', {
            headers: { 'Content-Length': String(KICK_CHANNEL_PROFILE_MAX_BYTES + 1) },
          });
        });
        vi.stubGlobal('fetch', fetchMock);

        expect((await invoke({ q: 'oversizedsearch' })).statusCode).toBe(502);
        expect(searchCancel).toHaveBeenCalledTimes(1);
        const profileLimited = await invoke({ q: 'profilelimit' });
        expect(profileLimited).toMatchObject({
          statusCode: 200,
          body: [expect.objectContaining({
            slug: 'profilelimit',
            thumbnail_url: null,
          })],
        });
      },
    );
  },
);
