import {
  afterEach,
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
  BADGEHQ_BADGES_MAX_BYTES,
  BADGEHQ_BADGES_URL,
} from '@/pages/api/twitch/badgehq-badges';

import {
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function jsonResponse(
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
}

function invoke(
  method = 'GET',
) {
  let statusCode = 200;
  let body: unknown;

  const headers =
    new Map<string, string>();

  const req = {
    method,
    query: {},
    headers: {},
    socket: {
      remoteAddress:
        '203.0.113.10',
    },
  } as unknown as NextApiRequest;

  const res = {
    setHeader(
      name: string,
      value: string,
    ) {
      headers.set(name, value);
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

  return Promise
    .resolve(handler(req, res))
    .then(() => ({
      statusCode,
      body,
      headers,
    }));
}

afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.unstubAllGlobals();
});

describe(
  'BadgeHQ badge API boundary',
  () => {
    it(
      'normalizes BadgeHQ ownership, priority, and BadgeHQ-owned badge assets',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async (
              input:
                RequestInfo | URL,
              init?: RequestInit,
            ) => {
              expect(
                String(input),
              ).toBe(
                BADGEHQ_BADGES_URL,
              );

              expect(
                init?.redirect,
              ).toBe('error');

              return jsonResponse({
                badges: [
                  {
                    id: 'later',
                    tooltip:
                      'Later Badge',
                    priority: 20,
                    images: {
                      '1x':
                        '/badges/later.png',
                    },
                  },
                  {
                    id: 'first',
                    tooltip:
                      'First Badge',
                    priority: 10,
                    images: {
                      '3x':
                        'https://badgehq.jessekettle.xyz/badges/v1/first-3.png?v=3',
                    },
                  },
                  {
                    id: 'hidden',
                    tooltip:
                      'Hidden Badge',
                    listed: false,
                    images: {
                      '1x':
                        '/badges/hidden.png',
                    },
                  },
                  {
                    id: 'external',
                    tooltip:
                      'External Badge',
                    images: {
                      '1x':
                        'https://attacker.com/badges/x.png',
                    },
                  },
                ],

                users: {
                  '123': {
                    badges: [
                      'later',
                      'first',
                      'hidden',
                      'external',
                    ],
                  },

                  '0004': {
                    badges: ['first'],
                  },
                },
              });
            },
          ),
        );

        const result =
          await invoke();

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual([
          {
            id: 'first',
            title:
              'First Badge',
            url:
              'https://badgehq.jessekettle.xyz/badges/v1/first-3.png?v=3',
            users: ['123'],
          },
          {
            id: 'later',
            title:
              'Later Badge',
            url:
              'https://www.badgehq.xyz/badges/later.png',
            users: ['123'],
          },
        ]);

        expect(
          JSON.stringify(
            result.body,
          ),
        ).not.toContain(
          'attacker.com',
        );

        expect(
          result.headers.get(
            'Cache-Control',
          ),
        ).toContain(
          's-maxage=1800',
        );
      },
    );

    it(
      'keeps at most four BadgeHQ assignments for one user',
      async () => {
        const badges =
          Array.from(
            { length: 6 },
            (_, index) => ({
              id: `b${index}`,
              tooltip:
                `Badge ${index}`,
              priority: index,
              images: {
                '1x':
                  `/badges/b${index}.png`,
              },
            }),
          );

        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              jsonResponse({
                badges,
                users: {
                  '123': {
                    badges:
                      badges.map(
                        (badge) =>
                          badge.id,
                      ),
                  },
                },
              }),
          ),
        );

        const result =
          await invoke();

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toHaveLength(4);
      },
    );

    it(
      'rejects non-GET methods without contacting BadgeHQ',
      async () => {
        const fetchMock =
          vi.fn();

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          (
            await invoke('POST')
          ).statusCode,
        ).toBe(405);

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'bounds the upstream body before parsing',
      async () => {
        const cancel = vi.fn();

        const response =
          new Response(
            new ReadableStream<
              Uint8Array
            >({
              pull(controller) {
                controller.enqueue(
                  new Uint8Array(
                    BADGEHQ_BADGES_MAX_BYTES,
                  ),
                );

                controller.enqueue(
                  new Uint8Array([1]),
                );
              },

              cancel,
            }),
          );

        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () => response,
          ),
        );

        expect(
          await invoke(),
        ).toMatchObject({
          statusCode: 502,
        });

        expect(
          cancel,
        ).toHaveBeenCalledTimes(1);
      },
    );
  },
);
