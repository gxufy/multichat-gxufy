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

      if (url === 'https://api.moltorino.com/badges') {
        return jsonResponse({
          badges: [{
            id: 'supporter',
            tooltip: 'Moltorino Supporter',
            images: { '3x': 'https://cdn.example/moltorino.png' },
            users: [{ id: '123', username: 'TargetUser' }],
          }],
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

  it('resolves Chatty and Chatsen supporter badges by Twitch identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/twitch/chatty-badges') {
        return jsonResponse([{
          id: 'supporter', title: 'Chatty Supporter',
          url: 'https://cdn.example/chatty.png', users: ['123'], usernames: [], color: '#123456',
        }]);
      }
      if (url === '/api/twitch/chatsen-badges') {
        return jsonResponse([{
          id: 'supporter', title: 'Chatsen Supporter',
          url: 'https://cdn.example/chatsen.png', users: ['123'],
        }]);
      }
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser', 'TargetUser'));
    expect(badges).toEqual(expect.arrayContaining([
      {
        type: 'community:chatty:supporter',
        url: 'https://cdn.example/chatty.png',
        backgroundColor: '#123456',
      },
      {
        type: 'community:chatsen:supporter',
        url: 'https://cdn.example/chatsen.png',
      },
    ]));
  });

  it('integrates PurpleTV, FFZ:AP, and cached JilChat badges by immutable Twitch id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/twitch/ffzap-badges') {
        return jsonResponse([{
          id: 'supporter', title: 'FFZ:AP Supporter',
          url: 'https://api.ffzap.com/v1/user/badge/123/3', users: ['123'], color: '#123456',
        }]);
      }
      if (url === '/api/twitch/purpletv-badges') {
        return jsonResponse([{
          id: 'donor', title: 'PurpleTV Donor Badge',
          url: 'https://nopbreak.ru/shared/badge.png', users: ['123'],
        }]);
      }
      if (url === '/api/twitch/jilchat-badges?userId=123') {
        return jsonResponse([{
          id: 'carrot', title: 'JilChat Carrot',
          url: 'https://api.jil.chat/uploads/carrot.png',
        }]);
      }
      return jsonResponse({}, false);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser', 'TargetUser'));
    const second = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser', 'TargetUser'));
    expect(first).toEqual(expect.arrayContaining([
      {
        type: 'community:ffzap:supporter', title: 'FFZ:AP Supporter',
        url: 'https://api.ffzap.com/v1/user/badge/123/3', backgroundColor: '#123456',
      },
      {
        type: 'community:purpletv:donor', title: 'PurpleTV Donor Badge',
        url: 'https://nopbreak.ru/shared/badge.png',
      },
      {
        type: 'community:jilchat:carrot', title: 'JilChat Carrot',
        url: 'https://api.jil.chat/uploads/carrot.png',
      },
    ]));
    expect(second).toEqual(first);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/twitch/jilchat-badges?')).length).toBe(1);
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
      if (url === '/api/twitch/purpletv-badges') return jsonResponse({}, false);
      if (url.startsWith('/api/twitch/jilchat-badges?')) return jsonResponse({}, false);
      return jsonResponse({}, false);
    }));

    const badges = await resolveTwitchCommunityBadges(twitchIdentity('123', 'targetuser', 'TargetUser'));
    expect(badges).toContainEqual({
      type: 'community:ffzap:supporter', title: 'FFZ:AP Supporter',
      url: 'https://api.ffzap.com/v1/user/badge/123/3',
    });
    expect(badges.some((badge) => badge.type.startsWith('community:purpletv:'))).toBe(false);
    expect(badges.some((badge) => badge.type.startsWith('community:jilchat:'))).toBe(false);
  });

  it('places ordered Limerino badges first and selects art for the rendered slot', async () => {
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
    expect(badges.slice(0, 2)).toEqual([
      {
        type: 'community:limerino:first', title: 'First Limerino',
        url: 'https://api.limerino.com/v1/badges/art/first/1/72px.webp',
        fallbackUrl: 'https://api.limerino.com/v1/badges/art/first/1/72px.png',
      },
      {
        type: 'community:limerino:second', title: 'Second Limerino',
        url: 'https://api.limerino.com/v1/badges/art/second/1/72px.webp',
        fallbackUrl: 'https://api.limerino.com/v1/badges/art/second/1/72px.png',
      },
    ]);
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

});
