import {
  beforeEach,
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
      status: ok ? 200 : 404,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

describe('GXUFY community badge integration', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  it('assigns the GXUFY supporter badge by Twitch numeric user ID', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === '/api/twitch/gxufy-badges') {
          return jsonResponse([
            {
              id: 'supporter',
              title: 'Gxufy Supporter',
              url: '/badges/gxufy/supporter.webp',
              userIds: ['204219574'],
            },
          ]);
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const badges = await resolveTwitchCommunityBadges({
      userId: '204219574',
      login: 'gxufy',
      displayName: 'Gxufy',
    });

    expect(badges).toContainEqual({
      type: 'community:gxufy:supporter',
      title: 'Gxufy Supporter',
      url: '/badges/gxufy/supporter.webp',
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === '/api/twitch/gxufy-badges',
      ),
    ).toHaveLength(1);
  });

  it('does not assign the badge to other Twitch users', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === '/api/twitch/gxufy-badges') {
          return jsonResponse([
            {
              id: 'supporter',
              title: 'Gxufy Supporter',
              url: '/badges/gxufy/supporter.webp',
              userIds: ['204219574'],
            },
          ]);
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const badges = await resolveTwitchCommunityBadges({
      userId: '123456789',
      login: 'someoneelse',
      displayName: 'SomeoneElse',
    });

    expect(
      badges.some(
        (badge) => badge.type === 'community:gxufy:supporter',
      ),
    ).toBe(false);
  });

  it('reuses one cached GXUFY dataset across repeated lookups', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === '/api/twitch/gxufy-badges') {
          return jsonResponse([
            {
              id: 'supporter',
              title: 'Gxufy Supporter',
              url: '/badges/gxufy/supporter.webp',
              userIds: ['204219574'],
            },
          ]);
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveTwitchCommunityBadges({
      userId: '204219574',
      login: 'gxufy',
      displayName: 'Gxufy',
    });

    const second = await resolveTwitchCommunityBadges({
      userId: '204219574',
      login: 'GXUFY',
      displayName: 'GXUFY',
    });

    expect(first).toContainEqual({
      type: 'community:gxufy:supporter',
      title: 'Gxufy Supporter',
      url: '/badges/gxufy/supporter.webp',
    });

    expect(second).toContainEqual({
      type: 'community:gxufy:supporter',
      title: 'Gxufy Supporter',
      url: '/badges/gxufy/supporter.webp',
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === '/api/twitch/gxufy-badges',
      ),
    ).toHaveLength(1);
  });
});