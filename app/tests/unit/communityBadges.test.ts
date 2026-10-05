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

    const badges = await resolveTwitchCommunityBadges('123', 'TargetUser');

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

    const badges = await resolveTwitchCommunityBadges('999', 'targetuser');
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

    const badges = await resolveTwitchCommunityBadges('123', 'targetuser');

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

    const badges = await resolveTwitchCommunityBadges('123', 'targetuser');
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

    const badges = await resolveTwitchCommunityBadges('123', 'TargetUser');
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

    const first = await resolveTwitchCommunityBadges('123', 'TargetUser');
    const second = await resolveTwitchCommunityBadges('123', 'TargetUser');
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

    const badges = await resolveTwitchCommunityBadges('123', 'TargetUser');
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

    const badges = await resolveTwitchCommunityBadges('123', 'IgnoredUsername', {
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

});
