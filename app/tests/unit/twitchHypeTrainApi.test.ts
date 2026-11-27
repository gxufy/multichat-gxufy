import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';

import handler from '@/api/twitch/hypetrain';

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
  } as unknown as ApiRequest;

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
  } as unknown as ApiResponse;

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
describe('Twitch Hype Train details (countdown, kind, treasure)', () => {
  const NOW = Date.parse('2026-11-22T23:00:00.000Z');

  const rich = (execution: Record<string, unknown>) => ({
    data: {
      user: {
        id: '204219574',
        channel: {
          hypeTrain: {
            execution: {
              isActive: true,
              progress: { goal: 5000, progression: 3600, level: { value: 3 } },
              ...execution,
            },
          },
        },
      },
    },
  });

  const routed = (answers: { rich?: unknown; plain?: unknown; kind?: unknown | Error }) =>
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes('allActiveHypeTrainStatuses')) {
        if (answers.kind instanceof Error) throw answers.kind;
        return response(answers.kind ?? { data: { allActiveHypeTrainStatuses: [] } });
      }
      if (query.includes('expiresAt')) return response(answers.rich);
      return response(answers.plain);
    });

  it('adds the countdown and the train age as times from now, and the kind from its own query', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetchMock = routed({
      rich: rich({ startedAt: '2026-11-22T22:58:00.000Z', expiresAt: '2026-11-22T23:03:30.000Z', isTreasureTrain: false }),
      kind: {
        data: {
          allActiveHypeTrainStatuses: [
            { hypeTrainType: 'REGULAR', isGoldenKappaTrain: false, isAllTimeHighTrain: false, isSharedTrain: false, channel: { id: '1' } },
            { hypeTrainType: 'GOLDEN_KAPPA', isGoldenKappaTrain: true, isAllTimeHighTrain: true, isSharedTrain: true, channel: { id: '204219574' } },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke({ channel: 'gxufy' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      active: true, level: 3, progress: 3600, goal: 5000,
      endsInMs: 210_000, startedAgoMs: 120_000,
      kind: 'golden-kappa', shared: true, record: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).variables).toEqual({ ids: ['204219574'] });
  });

  it('a treasure train carries its gift discount', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.stubGlobal('fetch', routed({
      rich: rich({ expiresAt: '2026-11-22T23:01:00.000Z', isTreasureTrain: true, treasureTrainDetails: { discountPercentage: 25, discountLevelThreshold: 3 } }),
      kind: { data: { allActiveHypeTrainStatuses: [{ hypeTrainType: 'REGULAR', channel: { id: '204219574' } }] } },
    }));
    expect((await invoke({ channel: 'gxufy' })).body).toEqual({
      active: true, level: 3, progress: 3600, goal: 5000, endsInMs: 60_000,
      kind: 'treasure', treasure: { percent: 25, level: 3 },
    });
  });

  it('keeps working with level and progress only if Twitch refuses the richer query', async () => {
    const fetchMock = routed({
      rich: { errors: [{ message: 'Cannot query field "expiresAt" on type "HypeTrainExecution".' }] },
      plain: rich({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke({ channel: 'gxufy' });
    expect(result.body).toEqual({ active: true, level: 3, progress: 3600, goal: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a regular train when the kind cannot be told, and ignores wild or missing times', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.stubGlobal('fetch', routed({
      rich: rich({ startedAt: 'yesterday', expiresAt: '2026-11-22T22:00:00.000Z' }),
      kind: new Error('network'),
    }));
    expect((await invoke({ channel: 'gxufy' })).body).toEqual({
      active: true, level: 3, progress: 3600, goal: 5000, endsInMs: 0,
    });
  });

  it('asks nothing more when no train runs', async () => {
    const fetchMock = routed({ rich: { data: { user: { id: '1', channel: { hypeTrain: { execution: null } } } } } });
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke({ channel: 'gxufy' })).body).toEqual({ active: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
