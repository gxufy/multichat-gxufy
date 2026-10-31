import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  __resetCommunityBadgeCache,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';

function jsonResponse(
  body: unknown,
  ok = true,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status:
        ok ? 200 : 502,
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
}

afterEach(() => {
  __resetCommunityBadgeCache();
  vi.unstubAllGlobals();
});

describe(
  'same-origin bChat and BadgeHQ client routing',
  () => {
    it(
      'never asks the browser to fetch either provider catalog cross-origin',
      async () => {
        const fetchMock =
          vi.fn(
            async (
              input:
                RequestInfo | URL,
            ) => {
              const url =
                String(input);

              if (
                url
                === '/api/twitch/bchat-badges'
              ) {
                return jsonResponse([
                  {
                    id: 'bchat-one',
                    title:
                      'bChat One',
                    url:
                      'https://cdn.example.com/bchat.png',
                    users: ['123'],
                  },
                ]);
              }

              if (
                url
                === '/api/twitch/badgehq-badges'
              ) {
                return jsonResponse([
                  {
                    id: 'hq-one',
                    title:
                      'BadgeHQ One',
                    url:
                      'https://www.badgehq.xyz/badges/hq.png',
                    users: ['123'],
                  },
                ]);
              }

              return jsonResponse(
                {},
                false,
              );
            },
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        const badges =
          await resolveTwitchCommunityBadges({
            userId: '123',
            login: 'target',
            displayName: 'Target',
          });

        expect(
          badges.some(
            (badge) =>
              badge.type
              === 'community:bchat:bchat-one',
          ),
        ).toBe(true);

        expect(
          badges.some(
            (badge) =>
              badge.type
              === 'community:badgehq:hq-one',
          ),
        ).toBe(true);

        const requested =
          fetchMock.mock.calls.map(
            ([input]) =>
              String(input),
          );

        expect(
          requested,
        ).toContain(
          '/api/twitch/bchat-badges',
        );

        expect(
          requested,
        ).toContain(
          '/api/twitch/badgehq-badges',
        );

        expect(
          requested,
        ).not.toContain(
          'https://www.itsbr0dyy.dev/api/badges',
        );

        expect(
          requested,
        ).not.toContain(
          'https://www.badgehq.xyz/api/v1/badges',
        );
      },
    );
  },
);
