import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import handler, {
  SUPPORT_TWITCH_USER_MAX_BYTES,
  __resetSupportTwitchUserResourcesForTests,
} from '@/pages/api/twitch/support-user';

import {
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

const originalFlag =
  process.env
    .GXUFY_SUPPORT_PAGE_ENABLED;

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(body),
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
  login = 'gxufy',
  method = 'GET',
) {
  let statusCode = 200;
  let body: unknown;
  const headers =
    new Map<
      string,
      string
    >();

  const req = {
    method,
    query: {
      login,
    },
    headers: {},
    socket: {
      remoteAddress:
        '203.0.113.44',
    },
  } as unknown as
    NextApiRequest;

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
  } as unknown as
    NextApiResponse;

  return Promise
    .resolve(
      handler(
        req,
        res,
      ),
    )
    .then(
      () => ({
        statusCode,
        body,
        headers,
      }),
    );
}

beforeEach(() => {
  process.env
    .GXUFY_SUPPORT_PAGE_ENABLED =
      '1';

  __resetSupportTwitchUserResourcesForTests();
  resetFixedProviderResourcesForTests();
});

afterEach(() => {
  if (
    originalFlag === undefined
  ) {
    delete process.env
      .GXUFY_SUPPORT_PAGE_ENABLED;
  } else {
    process.env
      .GXUFY_SUPPORT_PAGE_ENABLED =
        originalFlag;
  }

  __resetSupportTwitchUserResourcesForTests();
  resetFixedProviderResourcesForTests();
  vi.unstubAllGlobals();
});

describe(
  'private support Twitch verifier',
  () => {
    it(
      'is unreachable while the support page feature is disabled',
      async () => {
        delete process.env
          .GXUFY_SUPPORT_PAGE_ENABLED;

        const fetchMock =
          vi.fn();

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          await invoke(),
        ).toMatchObject({
          statusCode: 404,
          body: {
            error:
              'Not found.',
          },
        });

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'returns only a matching Twitch identity through the fixed server boundary',
      async () => {
        const fetchMock =
          vi.fn(
            async (
              _input:
                RequestInfo
                | URL,
              init?:
                RequestInit,
            ) => {
              const request =
                JSON.parse(
                  String(
                    init?.body,
                  ),
                );

              expect(
                request
                  .variables
                  .login,
              ).toBe(
                'gxufy',
              );

              return jsonResponse({
                data: {
                  user: {
                    id: '123',
                    login:
                      'gxufy',
                    displayName:
                      'Gxufy',
                    profileImageURL:
                      'https://cdn.example/g.png',
                  },
                },
              });
            },
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          await invoke(
            '  @GXUFY  ',
          ),
        ).toMatchObject({
          statusCode: 200,
          body: {
            id: '123',
            login:
              'gxufy',
            displayName:
              'Gxufy',
            profileImageUrl:
              'https://cdn.example/g.png',
          },
        });

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        const init = fetchMock.mock.calls[0][1] as RequestInit;

        expect(
          init.redirect,
        ).toBe(
          'error',
        );
      },
    );

    it(
      'returns 404 for an unknown Twitch login and caches that miss',
      async () => {
        const fetchMock =
          vi.fn(
            async () =>
              jsonResponse({
                data: {
                  user: null,
                },
              }),
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          (
            await invoke(
              'missinguser',
            )
          ).statusCode,
        ).toBe(404);

        expect(
          (
            await invoke(
              'missinguser',
            )
          ).statusCode,
        ).toBe(404);

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      'rejects malformed logins before upstream work',
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
              'ab',
            )
          ).statusCode,
        ).toBe(400);

        expect(
          (
            await invoke(
              'bad/name',
            )
          ).statusCode,
        ).toBe(400);

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects mismatched and unsafe Twitch responses generically',
      async () => {
        const fetchMock =
          vi.fn()
            .mockResolvedValueOnce(
              jsonResponse({
                data: {
                  user: {
                    id: '123',
                    login:
                      'different',
                    displayName:
                      'Different',
                  },
                },
              }),
            )
            .mockResolvedValueOnce(
              jsonResponse({
                data: {
                  user: {
                    id: '124',
                    login:
                      'unsafeuser',
                    displayName:
                      'Unsafe',
                    profileImageURL:
                      'http://bad.example/u.png',
                  },
                },
              }),
            );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        expect(
          (
            await invoke(
              'mismatch',
            )
          ).statusCode,
        ).toBe(502);

        expect(
          (
            await invoke(
              'unsafeuser',
            )
          ).statusCode,
        ).toBe(502);
      },
    );

    it(
      'bounds malformed and oversized Twitch responses',
      async () => {
        const fetchMock =
          vi.fn()
            .mockResolvedValueOnce(
              new Response(
                '{private malformed body',
              ),
            )
            .mockResolvedValueOnce(
              new Response(
                'x',
                {
                  headers: {
                    'Content-Length':
                      String(
                        SUPPORT_TWITCH_USER_MAX_BYTES
                        + 1,
                      ),
                  },
                },
              ),
            );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        for (
          const login
          of [
            'malformed',
            'oversized',
          ]
        ) {
          const result =
            await invoke(
              login,
            );

          expect(
            result,
          ).toMatchObject({
            statusCode: 502,
            body: {
              error:
                'Unable to verify Twitch account.',
            },
          });

          expect(
            JSON.stringify(
              result.body,
            ),
          ).not.toContain(
            'private malformed body',
          );
        }
      },
    );
  },
);
