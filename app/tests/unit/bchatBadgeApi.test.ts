import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';

import handler, {
  BCHAT_BADGES_FALLBACK,
  BCHAT_BADGES_MAX_BYTES,
  BCHAT_BADGES_URL,
} from '@/api/twitch/bchat-badges';

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
  } as unknown as ApiRequest;

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
  } as unknown as ApiResponse;

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
  'bChat badge API boundary',
  () => {
    it(
      'normalizes valid bChat assignments behind the same-origin API',
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
                BCHAT_BADGES_URL,
              );

              expect(
                init?.redirect,
              ).toBe('error');

              return jsonResponse({
                badges: {
                  supporter: {
                    title:
                      'bChat Supporter',
                    users: [
                      '123',
                      456,
                      'not-a-user-id',
                    ],
                    images: {
                      '1x':
                        'https://cdn.itsbr0dyy.dev/badges/supporter-1.png',
                      '4x':
                        'https://cdn.itsbr0dyy.dev/badges/supporter-4.png',
                    },
                  },

                  compromised: {
                    title:
                      'Compromised',
                    users: ['789'],
                    images: {
                      '4x':
                        'http://127.0.0.1/private.png',
                    },
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
            id: 'supporter',
            title:
              'bChat Supporter',
            url:
              'https://cdn.itsbr0dyy.dev/badges/supporter-4.png',
            users: [
              '123',
              '456',
            ],
          },
        ]);

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
      'uses the last-known-good snapshot when bChat rejects the server request',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              new Response(
                'Forbidden',
                {
                  status: 403,
                  headers: {
                    'Content-Type':
                      'text/plain',
                  },
                },
              ),
          ),
        );

        const result =
          await invoke();

        expect(
          result.statusCode,
        ).toBe(200);

        expect(
          result.body,
        ).toEqual(
          BCHAT_BADGES_FALLBACK,
        );

        expect(
          result.headers.get(
            'Cache-Control',
          ),
        ).toContain(
          's-maxage=300',
        );
      },
    );

    it(
      'rejects non-GET methods without contacting bChat',
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
      'rejects malformed payloads',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              jsonResponse([]),
          ),
        );

        expect(
          await invoke(),
        ).toMatchObject({
          statusCode: 502,
          body: {
            error:
              'Unable to load bChat badges.',
          },
        });
      },
    );

    it(
      'does not fall back for malformed upstream JSON',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              new Response(
                '{',
                {
                  status: 200,
                  headers: {
                    'Content-Type':
                      'application/json',
                  },
                },
              ),
          ),
        );

        expect(
          await invoke(),
        ).toMatchObject({
          statusCode: 502,
          body: {
            error:
              'Unable to load bChat badges.',
          },
        });
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
                    BCHAT_BADGES_MAX_BYTES,
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

describe('bChat fallback snapshot', () => {
  it('stays well-formed: unique ids, numeric Twitch ids, safe image urls, nobody listed twice in one badge', async () => {
    const { isSafeRemoteMediaUrl } = await import('@/lib/remoteMediaUrl');
    const ids = BCHAT_BADGES_FALLBACK.map((badge) => badge.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['admins', 'supporters', 'liptongod', 'tuk7', 'JOixio']));
    for (const badge of BCHAT_BADGES_FALLBACK) {
      expect(badge.title.trim()).not.toBe('');
      expect(isSafeRemoteMediaUrl(badge.url)).toBe(true);
      expect(badge.users.every((id) => /^\d{1,25}$/.test(id))).toBe(true);
      expect(new Set(badge.users).size).toBe(badge.users.length);
    }
  });
});
