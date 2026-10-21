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

const SOMEUSER_HASH =
  '0fb265a4573777a0442ec4c6edeaf707'
  + '216a2f5b16aacb85b55558a228c45017';

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

describe('Previews community badge integration', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  it('resolves a Twitch login through the Previews hash dataset', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);

        if (url === '/api/twitch/previews-badges') {
          return jsonResponse({
            version: 3608,
            updatedAt: null,
            twitch: {
              [SOMEUSER_HASH]: 21,
            },
          });
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const badges = await resolveTwitchCommunityBadges({
      userId: '',
      login: 'SomeUser',
      displayName: 'Localized Display Name',
    });

    expect(badges).toContainEqual({
      type: 'community:previews:subscriber-12',
      title: 'Previews Subscriber  21mo',
      url: '/badges/previews/badge_m12.webp',
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          String(input) === '/api/twitch/previews-badges',
      ),
    ).toHaveLength(1);
  });

  it('does not substitute displayName for the canonical Twitch login', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === '/api/twitch/previews-badges') {
          return jsonResponse({
            version: 3608,
            updatedAt: null,
            twitch: {
              [SOMEUSER_HASH]: 21,
            },
          });
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const badges = await resolveTwitchCommunityBadges({
      userId: '',
      displayName: 'SomeUser',
    });

    expect(
      badges.some(
        (badge) =>
          badge.type.startsWith('community:previews:'),
      ),
    ).toBe(false);

    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          String(input) === '/api/twitch/previews-badges',
      ),
    ).toBe(false);
  });

  it('shares one cached Previews dataset across repeated chatter lookups', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input) === '/api/twitch/previews-badges') {
          return jsonResponse({
            version: 3608,
            updatedAt: null,
            twitch: {
              [SOMEUSER_HASH]: 3,
            },
          });
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveTwitchCommunityBadges({
      userId: '',
      login: 'someuser',
    });

    const second = await resolveTwitchCommunityBadges({
      userId: '',
      login: 'SOMEUSER',
    });

    expect(first).toContainEqual({
      type: 'community:previews:subscriber-3',
      title: 'Previews Subscriber  3mo',
      url: '/badges/previews/badge_m3.webp',
    });

    expect(second).toContainEqual({
      type: 'community:previews:subscriber-3',
      title: 'Previews Subscriber  3mo',
      url: '/badges/previews/badge_m3.webp',
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          String(input) === '/api/twitch/previews-badges',
      ),
    ).toHaveLength(1);
  });
});