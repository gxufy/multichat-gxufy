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
              url: '/badges/gxufy/supporter-hand.webp',
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
      url: '/badges/gxufy/supporter-hand.webp',
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
              url: '/badges/gxufy/supporter-hand.webp',
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
              url: '/badges/gxufy/supporter-hand.webp',
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
      url: '/badges/gxufy/supporter-hand.webp',
    });

    expect(second).toContainEqual({
      type: 'community:gxufy:supporter',
      title: 'Gxufy Supporter',
      url: '/badges/gxufy/supporter-hand.webp',
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === '/api/twitch/gxufy-badges',
      ),
    ).toHaveLength(1);
  });
});
describe('GXUFY supporter badge sizes', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  async function resolveAt(slotSizePx: number, displayScale: number, reducedMotion = false) {
    const files = ([18, 36, 54, 72] as const).flatMap((width, index) => [
      { name: `${index + 1}x.webp`, staticName: `${index + 1}x.png`, width, height: width, frameCount: 96, format: 'WEBP' },
      { name: `${index + 1}x.png`, width, height: width, frameCount: 1, format: 'PNG' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => (
      String(input) === '/api/twitch/gxufy-badges'
        ? jsonResponse([{
          id: 'supporter',
          title: 'Gxufy Supporter',
          url: '/badges/gxufy/supporter-hand.webp',
          host: '/badges/gxufy/supporter',
          files,
          userIds: ['204219574'],
        }])
        : jsonResponse({}, false)
    )));
    const badges = await resolveTwitchCommunityBadges(
      { userId: '204219574', login: 'gxufy', displayName: 'Gxufy' },
      { slotSizePx, displayScale, reducedMotion },
    );
    __resetCommunityBadgeCache();
    return badges.find((badge) => badge.type.startsWith('community:gxufy:'));
  }

  it('picks the file that fits the slot and screen, like Limerino', async () => {
    expect((await resolveAt(18, 1))?.url).toBe('/badges/gxufy/supporter/1x.webp');
    expect((await resolveAt(28, 1))?.url).toBe('/badges/gxufy/supporter/2x.webp');
    expect((await resolveAt(28, 2))?.url).toBe('/badges/gxufy/supporter/4x.webp');
    expect((await resolveAt(40, 1))?.url).toBe('/badges/gxufy/supporter/3x.webp');
    const still = await resolveAt(28, 1, true);
    expect(still?.url).toBe('/badges/gxufy/supporter/2x.png');
  });

  it('ignores a sized set that is not on our own badge path', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => (
      String(input) === '/api/twitch/gxufy-badges'
        ? jsonResponse([{
          id: 'supporter', title: 'Gxufy Supporter', url: '/badges/gxufy/supporter-hand.webp',
          host: 'https://evil.example/x', files: [{ name: '1x.png', width: 18, height: 18, frameCount: 1, format: 'PNG' }],
          userIds: ['204219574'],
        }])
        : jsonResponse({}, false)
    )));
    const badges = await resolveTwitchCommunityBadges({ userId: '204219574', login: 'gxufy', displayName: 'Gxufy' });
    expect(badges.find((badge) => badge.type.startsWith('community:gxufy:'))?.url).toBe('/badges/gxufy/supporter-hand.webp');
  });
});
