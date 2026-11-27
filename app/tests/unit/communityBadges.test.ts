import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCommunityBadgeCache,
  applyLimerinoLiveUpdate,
  communityBadgeListSizes,
  measureCommunityBadgeLists,
  LIMERINO_RELOAD_SPREAD_MS,
  COMMUNITY_BADGE_RESPONSE_MAX_BYTES,
  CUSTOM_HOMIES_RESPONSE_MAX_BYTES,
  JILCHAT_CLIENT_MAX_CONCURRENT,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

function twitchIdentity(userId: string, login: string, displayName = login) {
  return { userId, login, displayName };
}

describe('Twitch community badges', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  it('stacks badges from independent providers and keeps the newest Bluzyrino match', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://api.chatterino.com/badges') {
        return jsonResponse({
          badges: [{
            tooltip: 'Chatterino Supporter',
            image3: 'https://cdn.example/chatterino.png',
            users: ['123'],
          }],
        });
      }

      if (url === 'https://api.moltorino.com/v2/badges') {
        return jsonResponse({
          badges: [
            {
              id: 'supporter',
              tooltip: 'Moltorino Supporter',
              priority: 100,
              images: { '3x': 'https://cdn.example/moltorino.png' },
            },
            {
              id: 'supporter-plus',
              tooltip: 'Moltorino Supporter+',
              priority: 90,
              images: { '3x': 'https://cdn.example/moltorino-plus.png' },
            },
          ],
          users: { '123': { badges: ['supporter-plus', 'supporter'], activeBadge: 'supporter' } },
        });
      }

      if (url === 'https://bluzyrino-badge-registry.blu901-55.workers.dev/v1/badges') {
        return jsonResponse({
          bchat: {
            badges: [
              {
                id: 'old-supporter',
                tooltip: 'Old Bluzyrino',
                image_url_4x: 'https://cdn.example/blue-old.png',
                users: [{ id: '123', login: 'targetuser' }],
              },
              {
                id: 'new-supporter',
                tooltip: 'New Bluzyrino',
                image_url_4x: 'https://cdn.example/blue-new.png',
                users: [{ id: '123', login: 'targetuser' }],
              },
            ],
          },
        });
      }

      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser', 'TargetUser'));

    expect(badges).toEqual(expect.arrayContaining([
      {
        type: 'community:chatterino:chatterino-supporter',
        url: 'https://cdn.example/chatterino.png',
      },
      {
        type: 'community:moltorino:supporter',
        url: 'https://cdn.example/moltorino.png',
      },
      {
        type: 'community:bluzyrino:new-supporter',
        url: 'https://cdn.example/blue-new.png',
      },
    ]));
    expect(badges.some((badge) => badge.url === 'https://cdn.example/blue-old.png')).toBe(false);
    expect(badges.some((badge) => badge.url === 'https://cdn.example/moltorino-plus.png')).toBe(false);
  });

  it('keeps simultaneous Homies badges while collapsing ordinary provider inventory', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://itzalex.github.io/badges') {
        return jsonResponse({
          badges: [
            {
              id: 'homies-one',
              tooltip: 'Homies One',
              image3: 'https://cdn.example/homies-one.png',
              users: ['123'],
            },
            {
              id: 'homies-two',
              tooltip: 'Homies Two',
              image3: 'https://cdn.example/homies-two.png',
              users: ['123'],
            },
          ],
        });
      }

      if (url === 'https://itzalex.github.io/badges2') {
        return jsonResponse({ badges: [] });
      }

      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(
      twitchIdentity('123', 'targetuser', 'TargetUser'),
    );

    const homies = badges.filter(
      (badge) => badge.type.startsWith('community:homies:'),
    );

    expect(homies).toEqual([
      {
        type: 'community:homies:homies-one',
        url: 'https://cdn.example/homies-one.png',
      },
      {
        type: 'community:homies:homies-two',
        url: 'https://cdn.example/homies-two.png',
      },
    ]);
  });
  it('falls back to a case-insensitive username mapping when a provider lacks Twitch ids', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.frankerfacez.com/v1/badges') {
        return jsonResponse({
          badges: [{ id: 7, title: 'FFZ Supporter', urls: { '4': 'https://cdn.example/ffz.png' } }],
          users: { '7': ['TargetUser'] },
        });
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('999', 'targetuser', 'TargetUser'));
    expect(badges).toContainEqual({
      type: 'community:ffz:7',
      url: 'https://cdn.example/ffz.png',
    });
  });

  it('prefers the official FFZ badge when a mirror returns the exact same art', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.frankerfacez.com/v1/badges') {
        return jsonResponse({
          badges: [{ id: 7, title: 'FFZ Supporter', urls: { '4': 'https://cdn.example/ffz.png' } }],
          users: { '7': ['TargetUser'] },
        });
      }
      if (url === 'https://turteg-api.xslash.ovh/v1/ffz/badges') {
        return jsonResponse({
          badges: [{
            id: 99,
            title: 'Mirrored FFZ Supporter',
            image: 'https://cdn.example/ffz.png',
            users: ['123'],
          }],
        });
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser'));

    expect(badges.filter((badge) => badge.url === 'https://cdn.example/ffz.png')).toEqual([
      {
        type: 'community:ffz:7',
        url: 'https://cdn.example/ffz.png',
      },
    ]);
  });

  it('keeps only one FFZ-family badge per chatter even when ids and image URLs differ', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.frankerfacez.com/v1/badges') {
        return jsonResponse({
          badges: [
            { id: 7, title: 'Old FFZ Supporter', urls: { '4': 'https://cdn.example/ffz-old.png' } },
            { id: 8, title: 'Current FFZ Supporter', urls: { '4': 'https://cdn.example/ffz-current.png' } },
          ],
          users: {
            '7': ['TargetUser'],
            '8': ['TargetUser'],
          },
        });
      }
      if (url === 'https://turteg-api.xslash.ovh/v1/ffz/badges') {
        return jsonResponse({
          badges: [{
            id: 99,
            title: 'Mirrored FFZ Supporter',
            image: 'https://mirror.example/ffz-supporter.png',
            users: ['123'],
          }],
        });
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser'));
    const ffzFamily = badges.filter((badge) =>
      badge.type.startsWith('community:ffz:') || badge.type.startsWith('community:turteg:'),
    );

    expect(ffzFamily).toEqual([
      {
        type: 'community:ffz:8',
        url: 'https://cdn.example/ffz-current.png',
      },
    ]);
  });

  it('resolves Chatty and keeps Chatsen to its first owned provider slot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/twitch/chatty-badges') {
        return jsonResponse([{
          id: 'supporter',
          title: 'Chatty Supporter',
          url: 'https://cdn.example/chatty.png',
          users: ['123'],
          usernames: [],
          color: '#123456',
        }]);
      }

      if (url === '/api/twitch/chatsen-badges') {
        return jsonResponse([
          {
            id: 'chatsen_5e8edd851d2fdfbd7415232c67367cc3',
            title: 'Chatsen Developer',
            url: 'https://cdn.example/chatsen-developer.png',
            users: ['123'],
            usernames: ['targetuser'],
          },
          {
            id: 'chatsen_ba0ee6c93838feda513230066533e1de',
            title: 'Chatsen Early Bird',
            url: 'https://cdn.example/chatsen-early-bird.png',
            users: ['123'],
            usernames: ['targetuser'],
          },
        ]);
      }

      return jsonResponse({}, false);
    }));

    const badges =
      await resolveTwitchCommunityBadges(
        twitchIdentity(
          '123',
          'targetuser',
          'TargetUser',
        ),
      );

    expect(badges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'community:chatty:supporter',
          url: 'https://cdn.example/chatty.png',
          backgroundColor: '#123456',
        }),
      ]),
    );

    expect(
      badges.filter((badge) =>
        badge.type.startsWith(
          'community:chatsen:',
        ),
      ),
    ).toEqual([
      expect.objectContaining({
        type:
          'community:chatsen:chatsen-5e8edd851d2fdfbd7415232c67367cc3',
        title: 'Chatsen Developer',
        url:
          'https://cdn.example/chatsen-developer.png',
      }),
    ]);
  });
  it('integrates FFZ:AP and cached JilChat badges by immutable Twitch id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/twitch/ffzap-badges') {
        return jsonResponse([{
          id: 'supporter',
          title: 'FFZ:AP Supporter',
          url: 'https://api.ffzap.com/v1/user/badge/123/3',
          users: ['123'],
          color: '#123456',
        }]);
      }

      if (url === '/api/twitch/jilchat-badges?userId=123') {
        return jsonResponse([{
          id: 'carrot',
          title: 'JilChat Carrot',
          url: 'https://api.jil.chat/uploads/carrot.png',
        }]);
      }

      return jsonResponse({}, false);
    });

    vi.stubGlobal('fetch', fetchMock);

    const first =
      await resolveTwitchCommunityBadges(
        twitchIdentity(
          '123',
          'targetuser',
          'TargetUser',
        ),
      );

    const second =
      await resolveTwitchCommunityBadges(
        twitchIdentity(
          '123',
          'targetuser',
          'TargetUser',
        ),
      );

    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'community:ffzap:supporter',
          title: 'FFZ:AP Supporter',
          url:
            'https://api.ffzap.com/v1/user/badge/123/3',
          backgroundColor: '#123456',
        }),
        expect.objectContaining({
          type: 'community:jilchat:carrot',
          title: 'JilChat Carrot',
          url:
            'https://api.jil.chat/uploads/carrot.png',
        }),
      ]),
    );

    expect(second).toEqual(first);

    expect(
      fetchMock.mock.calls.filter(
        ([url]) =>
          String(url).startsWith(
            '/api/twitch/jilchat-badges?',
          ),
      ),
    ).toHaveLength(1);
  });
  it('keeps every active Enhancer badge assigned to the same Twitch id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/twitch/enhancer-badges') {
        return jsonResponse([
          {
            id: 'patron',
            title: 'Patron',
            url: 'https://cdn.enhancer.at/badge/patron/72.webp',
            users: ['123'],
            priority: 0,
          },
          {
            id: 'tester',
            title: 'Enhancer Tester',
            url: 'https://cdn.enhancer.at/badge/tester/72.webp',
            users: ['123'],
            priority: 997,
          },
          {
            id: 'developer',
            title: 'Enhancer Developer',
            url: 'https://cdn.enhancer.at/badge/developer/72.webp',
            users: ['999'],
            priority: 999,
          },
        ]);
      }

      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(
      twitchIdentity('123', 'targetuser', 'TargetUser'),
    );

    expect(
      badges.filter((badge) =>
        badge.type.startsWith('community:enhancer:'),
      ),
    ).toEqual([
      {
        type: 'community:enhancer:patron',
        title: 'Patron',
        url: 'https://cdn.enhancer.at/badge/patron/72.webp',
      },
      {
        type: 'community:enhancer:tester',
        title: 'Enhancer Tester',
        url: 'https://cdn.enhancer.at/badge/tester/72.webp',
      },
    ]);

    expect(
      badges.some(
        (badge) =>
          badge.type === 'community:enhancer:developer',
      ),
    ).toBe(false);
  });
  it('treats provider catalogs as definitions and assigns badges only to their owners', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.chatterino.com/badges') {
        return jsonResponse({
          badges: [{
            id: 'purple-star',
            tooltip: 'Purple Star',
            image3: 'https://cdn.example/purple-star.png',
            users: ['111'],
          }],
        });
      }
      if (url === '/api/twitch/chatty-badges') {
        return jsonResponse([{
          id: 'blue-shield',
          title: 'Blue Shield',
          url: 'https://cdn.example/blue-shield.png',
          users: ['222'],
          usernames: [],
          color: '',
        }]);
      }
      return jsonResponse({}, false);
    }));

    const firstOwner = await resolveTwitchCommunityBadges(twitchIdentity('111', 'firstowner', 'FirstOwner'));
    const secondOwner = await resolveTwitchCommunityBadges(twitchIdentity('222', 'secondowner', 'SecondOwner'));
    const nonOwner = await resolveTwitchCommunityBadges(twitchIdentity('333', 'nonowner', 'NonOwner'));

    expect(firstOwner).toEqual([{
      type: 'community:chatterino:purple-star',
      url: 'https://cdn.example/purple-star.png',
    }]);
    expect(secondOwner).toEqual([{
      type: 'community:chatty:blue-shield',
      url: 'https://cdn.example/blue-shield.png',
    }]);
    expect(nonOwner).toEqual([]);
  });

  it('keeps successful vanity providers when one provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/twitch/ffzap-badges') {
        return jsonResponse([{
          id: 'supporter', title: 'FFZ:AP Supporter',
          url: 'https://api.ffzap.com/v1/user/badge/123/3', users: ['123'],
        }]);
      }
      if (url.startsWith('/api/twitch/jilchat-badges?')) return jsonResponse({}, false);
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser', 'TargetUser'));
    expect(badges).toContainEqual({
      type: 'community:ffzap:supporter', title: 'FFZ:AP Supporter',
      url: 'https://api.ffzap.com/v1/user/badge/123/3',
    });
    expect(badges.some((badge) => badge.type.startsWith('community:jilchat:'))).toBe(false);
  });

  it('renders only the first displayed Limerino badge and selects art for the rendered slot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/twitch/limerino-badges') {
        const files = [18, 36, 54, 72].flatMap((width) => [
          { name: `${width}px.webp`, staticName: `${width}px.png`, width, height: width, frameCount: 3, format: 'WEBP' },
          { name: `${width}px.png`, width, height: width, frameCount: 1, format: 'PNG' },
        ]);
        return jsonResponse([
          {
            id: 'first', title: 'First Limerino',
            host: 'https://api.limerino.com/v1/badges/art/first/1', files, users: ['123'],
          },
          {
            id: 'second', title: 'Second Limerino',
            host: 'https://api.limerino.com/v1/badges/art/second/1', files, users: ['123'],
          },
        ]);
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'ignoredusername', 'IgnoredUsername'), {
      slotSizePx: 28,
      displayScale: 2,
      reducedMotion: false,
    });
    const limerino = badges.filter(
      (badge) => badge.type.startsWith('community:limerino:'),
    );

    expect(limerino).toEqual([
      {
        type: 'community:limerino:first',
        title: 'First Limerino',
        url: 'https://api.limerino.com/v1/badges/art/first/1/72px.webp',
        fallbackUrl: 'https://api.limerino.com/v1/badges/art/first/1/72px.png',
      },
    ]);
  });

  it('takes live Limerino changes: patches move users between badges, a reload fetches the list again', async () => {
    const files = [18, 36, 54, 72].map((width) => ({ name: `${width}px.png`, width, height: width, frameCount: 1, format: 'PNG' }));
    const list = (first: string[], second: string[]) => [
      { id: 'first', title: 'First Limerino', host: 'https://api.limerino.com/v1/badges/art/first/1', files, users: first },
      { id: 'second', title: 'Second Limerino', host: 'https://api.limerino.com/v1/badges/art/second/1', files, users: second },
    ];
    const requested: string[] = [];
    let served = list(['42'], ['77']);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/twitch/limerino-badges')) {
        requested.push(url);
        return jsonResponse(served);
      }
      return jsonResponse({}, false);
    }));
    const shown = async (userId: string) => (await resolveTwitchCommunityBadges(twitchIdentity(userId, `user${userId}`)))
      .filter((badge) => badge.type.startsWith('community:limerino:'))
      .map((badge) => badge.type.replace('community:limerino:', ''));

    expect(await shown('42')).toEqual(['first']);
    applyLimerinoLiveUpdate({ t: 'patch', users: { 42: 'second', 77: null, 5: 'first', bad: 'first' } });
    expect(await shown('42')).toEqual(['second']);
    expect(await shown('77')).toEqual([]);
    expect(await shown('5')).toEqual(['first']);
    expect(requested).toEqual(['/api/twitch/limerino-badges']);

    vi.useFakeTimers();
    try {
      served = list([], ['42', '9']);
      applyLimerinoLiveUpdate({ t: 'reload', v: 3 }, () => 0.5);
      applyLimerinoLiveUpdate({ t: 'reload', v: 'x' });
      await vi.advanceTimersByTimeAsync(LIMERINO_RELOAD_SPREAD_MS / 2 - 1);
      expect(requested).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(requested).toEqual(['/api/twitch/limerino-badges', '/api/twitch/limerino-badges?v=3']);
    } finally {
      vi.useRealTimers();
    }
    expect(await shown('9')).toEqual(['second']);
    /* A badge this overlay has not heard of yet: it fetches the list again. */
    vi.useFakeTimers();
    try {
      applyLimerinoLiveUpdate({ t: 'patch', users: { 9: 'brand-new' } }, () => 0);
      await vi.advanceTimersByTimeAsync(1);
      expect(requested).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records each whole list\'s size next to its limit (no per-chatter lookups) and warns once past 75%', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const big = { badges: [{ tooltip: 'Big', image3: 'https://cdn.example/big.png', users: ['1'], pad: 'x'.repeat(3_300_000) }] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.chatterino.com/badges') return jsonResponse(big);
      if (url === 'https://unii.molto.lol/badges') return jsonResponse({ UChat: [], YAUTC: [] });
      if (url.startsWith('/api/twitch/limerino-badges')) return jsonResponse([]);
      return jsonResponse({}, false);
    }));
    const rows = await measureCommunityBadgeLists();
    const byList = new Map(rows.map((row) => [row.list, row]));
    expect(rows[0].list).toBe('api.chatterino.com/badges');
    expect(byList.get('api.chatterino.com/badges')).toMatchObject({ cap: COMMUNITY_BADGE_RESPONSE_MAX_BYTES });
    expect(byList.get('api.chatterino.com/badges')!.bytes).toBeGreaterThan(3_300_000);
    expect(byList.get('unii.molto.lol/badges')!.bytes).toBeLessThan(100);
    expect(byList.has('/api/twitch/limerino-badges')).toBe(true);
    expect(rows.some((row) => row.list.includes('?'))).toBe(false);
    const warnings = warn.mock.calls.map(([text]) => String(text)).filter((text) => text.includes('badge list'));
    expect(warnings).toEqual(['[overlay] badge list api.chatterino.com/badges is 79% of its 4 MB limit']);
    await measureCommunityBadgeLists();
    expect(communityBadgeListSizes()).toHaveLength(rows.length);
    warn.mockRestore();
  });

  it('loads the custom Homies list after it grows past the shared size cap', async () => {
    const padding = Array.from({ length: 14_000 }, (_, index) => ({
      badgeFileType: 'image/webp',
      badgeId: `filler-${index}`,
      tooltip: `Filler badge number ${index} with a long enough tooltip to add bulk`,
      userId: String(900_000_000 + index),
      username: `filler_user_${index}`,
      image1: `https://cdn.example/custom/filler-${index}/18.webp`,
      image2: `https://cdn.example/custom/filler-${index}/36.webp`,
      image3: `https://cdn.example/custom/filler-${index}/72.webp`,
    }));
    const body = JSON.stringify({ badges: [
      ...padding,
      {
        badgeFileType: 'image/webp',
        badgeId: 'animated-custom',
        tooltip: 'Animated Custom Badge',
        userId: '935000001',
        username: 'animated_custom_user',
        image1: 'https://cdn.example/custom/animated/18.webp',
        image2: 'https://cdn.example/custom/animated/36.webp',
        image3: 'https://cdn.example/custom/animated/72.webp',
      },
    ] });
    const size = new TextEncoder().encode(body).byteLength;
    expect(size).toBeGreaterThan(COMMUNITY_BADGE_RESPONSE_MAX_BYTES);
    expect(size).toBeLessThan(CUSTOM_HOMIES_RESPONSE_MAX_BYTES);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://chatterinohomies.com/api/badges/list') {
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(
      twitchIdentity('935000001', 'animated_custom_user'),
    );

    expect(badges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Animated Custom Badge',
        url: 'https://cdn.example/custom/animated/72.webp',
      }),
    ]));
  });

  it('still rejects other community badge lists above the shared size cap', async () => {
    const users = Array.from({ length: 400_000 }, (_, index) => String(100_000_000 + index));
    const body = JSON.stringify({ badges: [{
      id: 'oversized',
      tooltip: 'Oversized List Badge',
      image3: 'https://cdn.example/oversized.png',
      users: ['123', ...users],
    }] });
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(COMMUNITY_BADGE_RESPONSE_MAX_BYTES);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://api.chatterino.com/badges') {
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'oversized_user'));

    expect(badges.some((badge) => badge.title === 'Oversized List Badge')).toBe(false);
  });

  it('matches immutable id, canonical login, and display name as separate aliases', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.chatterino.com/badges') {
        return jsonResponse({ badges: [{
          id: 'by-id',
          tooltip: 'By ID',
          image3: 'https://cdn.example/by-id.png',
          users: ['123'],
        }] });
      }
      if (url === 'https://chatterinohomies.com/api/badges/list') {
        return jsonResponse({ badges: [{
          badgeId: 'by-login',
          tooltip: 'By Login',
          image3: 'https://cdn.example/by-login.png',
          username: 'canonical_login',
        }] });
      }
      if (url === 'https://api.frankerfacez.com/v1/badges') {
        return jsonResponse({
          badges: [
            { id: 2, title: 'By Display', urls: { '4': 'https://cdn.example/by-display.png' } },
            { id: 3, title: 'Concatenated', urls: { '4': 'https://cdn.example/concatenated.png' } },
          ],
          users: {
            '2': ['Localized Name'],
            '3': ['canonical_login (Localized Name)'],
          },
        });
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges({
      userId: '123',
      login: 'canonical_login',
      displayName: 'Localized Name',
    });

    expect(badges.map((badge) => badge.url)).toEqual(expect.arrayContaining([
      'https://cdn.example/by-id.png',
      'https://cdn.example/by-login.png',
      'https://cdn.example/by-display.png',
    ]));
    expect(badges.some((badge) => badge.url === 'https://cdn.example/concatenated.png')).toBe(false);
  });

  it('accepts the current Folhinha dev field without inventing ownership', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://api.folhinhabot.com/plus') {
        return jsonResponse({
          badges: { dev: { '4': 'https://cdn.example/folhinha-dev.png' } },
          dev: [{ userId: '123', currAlias: 'owner' }],
        });
      }
      return jsonResponse({}, false);
    }));

    const owner = await resolveTwitchCommunityBadges(twitchIdentity('123', 'owner'));
    const nonOwner = await resolveTwitchCommunityBadges(twitchIdentity('999', 'viewer'));

    expect(owner).toContainEqual({
      type: 'community:folhinha:dev-0',
      url: 'https://cdn.example/folhinha-dev.png',
    });
    expect(nonOwner.some((badge) => badge.type.startsWith('community:folhinha:'))).toBe(false);
  });

  it('keeps successful provider catalogs cached while retrying failed ones', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://api.chatterino.com/badges') {
        return jsonResponse({
          badges: [{
            id: 'supporter',
            tooltip: 'Chatterino Supporter',
            image3: 'https://cdn.example/chatterino.png',
            users: ['123'],
          }],
        });
      }


      if (url.startsWith('/api/twitch/jilchat-badges?')) {
        return jsonResponse([]);
      }

      return jsonResponse({}, false);
    });

    vi.stubGlobal('fetch', fetchMock);

    await resolveTwitchCommunityBadges(
      twitchIdentity('123', 'targetuser', 'TargetUser'),
    );

    now += 5 * 60_000 + 1;

    await resolveTwitchCommunityBadges(
      twitchIdentity('123', 'targetuser', 'TargetUser'),
    );

    const callsTo = (url: string) =>
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === url,
      );

    expect(callsTo('https://api.chatterino.com/badges'))
      .toHaveLength(1);

  });

  it('backs off repeated failed JilChat ownership lookups', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/api/twitch/jilchat-badges?userId=123') {
        return jsonResponse({}, false);
      }

      return jsonResponse({}, false);
    });

    vi.stubGlobal('fetch', fetchMock);

    await resolveTwitchCommunityBadges(
      twitchIdentity('123', 'targetuser', 'TargetUser'),
    );

    await resolveTwitchCommunityBadges(
      twitchIdentity('123', 'targetuser', 'TargetUser'),
    );

    expect(
      fetchMock.mock.calls.filter(
        ([url]) =>
          String(url) ===
          '/api/twitch/jilchat-badges?userId=123',
      ),
    ).toHaveLength(1);
  });

  it('bounds concurrent JilChat ownership requests without dropping users', async () => {
    let activeJilChat = 0;
    let maxActiveJilChat = 0;
    let totalJilChat = 0;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);

        if (url.startsWith('/api/twitch/jilchat-badges?')) {
          totalJilChat += 1;
          activeJilChat += 1;
          maxActiveJilChat =
            Math.max(maxActiveJilChat, activeJilChat);

          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          });

          activeJilChat -= 1;
          return jsonResponse([]);
        }

        return jsonResponse({}, false);
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    const userCount =
      JILCHAT_CLIENT_MAX_CONCURRENT + 8;

    await Promise.all(
      Array.from(
        { length: userCount },
        (_, index) =>
          resolveTwitchCommunityBadges(
            twitchIdentity(
              String(10_000 + index),
              `viewer${index}`,
              `Viewer${index}`,
            ),
          ),
      ),
    );

    expect(maxActiveJilChat)
      .toBeLessThanOrEqual(
        JILCHAT_CLIENT_MAX_CONCURRENT,
      );

    expect(totalJilChat).toBe(userCount);
  });

  it('prefers official FFZ Subwoofer over an earlier client mirror', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (
          input:
            RequestInfo
            | URL,
        ) => {
          const url =
            String(
              input,
            );

          /*
           * Chatterino is loaded before FFZ and simulates the surviving mirror
           * seen in the live Djrr13 row.
           */
          if (
            url ===
              'https://api.chatterino.com/badges'
          ) {
            return jsonResponse({
              badges: [
                {
                  id:
                    'ffz-supporter-mirror',

                  tooltip:
                    'FFZ Supporter',

                  image3:
                    'https://mirror.example/ffz-supporter.png',

                  users:
                    ['123'],
                },
              ],
            });
          }

          /*
           * The ids endpoint intentionally fails so loadFFZ exercises its
           * username fallback exactly like the existing FFZ tests.
           */
          if (
            url ===
              'https://api.frankerfacez.com/v1/badges'
          ) {
            return jsonResponse({
              badges: [
                {
                  id: 3,

                  title:
                    'FFZ Supporter',

                  urls: {
                    '4':
                      'https://cdn.example/ffz-supporter.png',
                  },
                },

                {
                  id: 4,

                  title:
                    'FFZ Subwoofer',

                  urls: {
                    '4':
                      'https://cdn.example/ffz-subwoofer.png',
                  },
                },
              ],

              users: {
                '3':
                  ['TargetUser'],

                '4':
                  ['TargetUser'],
              },
            });
          }

          return jsonResponse(
            {},
            false,
          );
        },
      ),
    );

    const badges =
      await resolveTwitchCommunityBadges(
        twitchIdentity(
          '123',
          'targetuser',
          'TargetUser',
        ),
      );

    expect(
      badges.some(
        (badge) =>
          badge.type ===
            'community:chatterino:ffz-supporter-mirror',
      ),
    ).toBe(false);

    expect(
      badges.filter(
        (badge) =>
          badge.type.startsWith(
            'community:ffz:',
          )
          || badge.type.startsWith(
            'community:turteg:',
          ),
      ),
    ).toEqual([
      {
        type:
          'community:ffz:4',

        url:
          'https://cdn.example/ffz-subwoofer.png',
      },
    ]);
  });

});
