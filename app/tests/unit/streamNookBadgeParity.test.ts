import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCommunityBadgeCache,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chat-client badge provider parity', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  it('covers every supported chat-client badge provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.frankerfacez.com/v1/badges/ids') {
        return jsonResponse({
          badges: [{ id: 1, title: 'FFZ Developer', urls: { '4': 'https://cdn.example/ffz.png' } }],
          users: { '1': [123] },
        });
      }
      if (url === 'https://api.betterttv.net/3/cached/badges') {
        return jsonResponse([{
          providerId: '123',
          badge: { description: 'BTTV Developer', svg: 'https://cdn.example/bttv.svg' },
        }]);
      }
      if (url === 'https://api.chatterino.com/badges') {
        return jsonResponse({ badges: [{
          tooltip: 'Chatterino Supporter', image3: 'https://cdn.example/chatterino.png', users: ['123'],
        }] });
      }
      if (url === 'https://itzalex.github.io/badges') {
        return jsonResponse({ badges: [{
          tooltip: 'Homies Supporter', image3: 'https://cdn.example/homies.png', users: ['123'],
        }] });
      }
      if (url === 'https://itzalex.github.io/badges2') {
        return jsonResponse({ badges: [] });
      }
      if (url === '/api/twitch/chatsen-badges') {
        return jsonResponse([{ id: 'supporter', title: 'Chatsen Supporter', url: 'https://cdn.example/chatsen.png', users: ['123'] }]);
      }
      if (url === '/api/twitch/chatty-badges') {
        return jsonResponse([{ id: 'supporter', title: 'Chatty Supporter', url: 'https://cdn.example/chatty.png', users: ['123'], usernames: [] }]);
      }
      if (url === '/api/twitch/dankchat-badges') {
        return jsonResponse([{ type: 'DankChat Supporter', url: 'https://cdn.example/dankchat.png', users: ['123'] }]);
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges({ userId: '123', login: 'targetuser', displayName: 'TargetUser' });
    const providers = new Set(
      badges
        .map((badge) => /^community:([^:]+):/.exec(badge.type)?.[1])
        .filter(Boolean),
    );

    for (const provider of ['ffz', 'bttv', 'chatterino', 'homies', 'chatsen', 'chatty', 'dankchat']) {
      expect(providers.has(provider)).toBe(true);
    }
  });

  it('prefers the StreamNook bulk applied-badge registry without per-user traffic', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (
        url ===
        'https://streamnook.app/api/v1/cosmetics/badges/users'
      ) {
        return jsonResponse({
          badges: [
            {
              id: 'streamnook',
              version: 'streamnook-lumen',
              slug: 'streamnook-lumen',
              name: 'Lumen',
              image_url:
                'https://cdn.example/streamnook-lumen.webp',
              image_url_2:
                'https://cdn.example/streamnook-lumen.webp',
              image_url_4:
                'https://cdn.example/streamnook-lumen.webp',
              active_userids: ['123'],
            },
            {
              id: 'streamnook',
              version: 'streamnook-default',
              slug: 'streamnook-default',
              name: 'StreamNook Member',
              image_url:
                'https://cdn.example/streamnook-default.webp',
              active_userids: [],
            },
          ],
          users: {
            '123': {
              badges: [
                'streamnook-default',
                'streamnook-lumen',
              ],
              applied: 'streamnook-lumen',
            },
          },
          ttl_seconds: 300,
        });
      }

      if (
        url.startsWith(
          'https://streamnook.app/api/v1/cosmetics/users?',
        )
      ) {
        throw new Error(
          'Per-user StreamNook fallback should not run',
        );
      }

      if (url.startsWith('/api/twitch/jilchat-badges?')) {
        return jsonResponse([]);
      }

      return jsonResponse({}, false);
    });

    vi.stubGlobal('fetch', fetchMock);

    const [member, nonMember] = await Promise.all([
      resolveTwitchCommunityBadges({
        userId: '123',
        login: 'member',
        displayName: 'Member',
      }),
      resolveTwitchCommunityBadges({
        userId: '456',
        login: 'viewer',
        displayName: 'Viewer',
      }),
    ]);

    expect(member).toContainEqual({
      type: 'community:streamnook:streamnook-lumen',
      title: 'Lumen',
      url: 'https://cdn.example/streamnook-lumen.webp',
    });

    expect(
      nonMember.some((badge) =>
        badge.type.startsWith('community:streamnook:'),
      ),
    ).toBe(false);

    const bulkCalls = fetchMock.mock.calls.filter(
      ([input]) =>
        String(input) ===
        'https://streamnook.app/api/v1/cosmetics/badges/users',
    );

    const perUserCalls = fetchMock.mock.calls.filter(
      ([input]) =>
        String(input).startsWith(
          'https://streamnook.app/api/v1/cosmetics/users?',
        ),
    );

    expect(bulkCalls).toHaveLength(1);
    expect(perUserCalls).toHaveLength(0);

    await resolveTwitchCommunityBadges({
      userId: '456',
      login: 'viewer',
      displayName: 'Viewer',
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          String(input) ===
          'https://streamnook.app/api/v1/cosmetics/badges/users',
      ),
    ).toHaveLength(1);

    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          String(input).startsWith(
            'https://streamnook.app/api/v1/cosmetics/users?',
          ),
      ),
    ).toHaveLength(0);
  });
  it('batches StreamNook users, renders the equipped badge, and caches non-members', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://streamnook.app/api/v1/cosmetics/users?')) {
        const parsed = new URL(url);
        const ids = (parsed.searchParams.get('ids') ?? '').split(',').filter(Boolean);

        expect(parsed.searchParams.get('kind')).toBe('badge');
        expect(parsed.searchParams.get('expand')).toBe('1');

        return jsonResponse({
          users: Object.fromEntries(ids.map((id) => [
            id,
            id === '123'
              ? {
                  twitch_user_id: id,
                  member: true,
                  equipped: { badge: 'streamnook-lumen' },
                  badge: 'streamnook-lumen',
                  owned: ['streamnook-lumen'],
                }
              : {
                  twitch_user_id: id,
                  member: false,
                  equipped: {},
                  badge: null,
                  owned: [],
                },
          ])),
          cosmetics: {
            'streamnook-lumen': {
              slug: 'streamnook-lumen',
              name: 'Lumen',
              description: 'StreamNook badge',
              kind: 'badge',
              slot: 'badge',
              image_url: 'https://cdn.example/streamnook-lumen.webp',
              animated: false,
              surfaces: ['chat', 'profile'],
            },
          },
        });
      }

      if (url.startsWith('/api/twitch/jilchat-badges?')) {
        return jsonResponse([]);
      }

      return jsonResponse({}, false);
    });

    vi.stubGlobal('fetch', fetchMock);

    const [member, nonMember] = await Promise.all([
      resolveTwitchCommunityBadges({
        userId: '123',
        login: 'member',
        displayName: 'Member',
      }),
      resolveTwitchCommunityBadges({
        userId: '456',
        login: 'viewer',
        displayName: 'Viewer',
      }),
    ]);

    expect(member).toContainEqual({
      type: 'community:streamnook:streamnook-lumen',
      title: 'Lumen',
      url: 'https://cdn.example/streamnook-lumen.webp',
    });

    expect(
      nonMember.some((badge) =>
        badge.type.startsWith('community:streamnook:'),
      ),
    ).toBe(false);

    const streamNookCalls = () =>
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith(
          'https://streamnook.app/api/v1/cosmetics/users?',
        ),
      );

    expect(streamNookCalls()).toHaveLength(1);

    await resolveTwitchCommunityBadges({
      userId: '456',
      login: 'viewer',
      displayName: 'Viewer',
    });

    expect(streamNookCalls()).toHaveLength(1);
  });
  it('keeps successive StreamNook batches at least 250 ms apart', async () => {
    vi.useFakeTimers();

    try {
      const streamNookStartedAt: number[] = [];

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith('https://streamnook.app/api/v1/cosmetics/users?')) {
          streamNookStartedAt.push(Date.now());

          const parsed = new URL(url);
          const ids = (parsed.searchParams.get('ids') ?? '')
            .split(',')
            .filter(Boolean);

          return jsonResponse({
            users: Object.fromEntries(ids.map((id) => [
              id,
              {
                twitch_user_id: id,
                member: false,
                equipped: {},
                badge: null,
                owned: [],
              },
            ])),
            cosmetics: {},
          });
        }

        if (url.startsWith('/api/twitch/jilchat-badges?')) {
          return jsonResponse([]);
        }

        return jsonResponse({}, false);
      });

      vi.stubGlobal('fetch', fetchMock);

      /*
       * 201 unique users force two StreamNook requests:
       * the documented maximum batch of 200, then one queued user.
       */
      const work = Array.from({ length: 201 }, (_, index) => {
        const userId = String(100000 + index);

        return resolveTwitchCommunityBadges({
          userId,
          login: `viewer${index}`,
          displayName: `Viewer${index}`,
        });
      });

      await vi.advanceTimersByTimeAsync(25);

      expect(streamNookStartedAt).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(249);

      expect(streamNookStartedAt).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);

      expect(streamNookStartedAt).toHaveLength(2);
      expect(
        streamNookStartedAt[1]! - streamNookStartedAt[0]!,
      ).toBeGreaterThanOrEqual(250);

      await Promise.all(work);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps official FFZ and drops Chatty when Chatty re-hosts the same FFZ title', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.frankerfacez.com/v1/badges/ids') {
        return jsonResponse({
          badges: [{ id: 7, title: 'FFZ Supporter', urls: { '4': 'https://cdn.example/ffz.png' } }],
          users: { '7': [123] },
        });
      }
      if (url === '/api/twitch/chatty-badges') {
        return jsonResponse([{
          id: 'ffz-supporter',
          title: 'FFZ Supporter',
          url: 'https://cdn.example/chatty-rehost.png',
          users: ['123'],
          usernames: [],
        }]);
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges({ userId: '123', login: 'targetuser', displayName: 'TargetUser' });
    expect(badges).toContainEqual({
      type: 'community:ffz:7',
      url: 'https://cdn.example/ffz.png',
    });
    expect(badges.some((badge) => badge.type.startsWith('community:chatty:'))).toBe(false);
  });
});
