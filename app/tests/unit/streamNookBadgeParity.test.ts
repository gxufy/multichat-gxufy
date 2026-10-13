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

    const badges = await resolveTwitchCommunityBadges('123', 'TargetUser');
    const providers = new Set(
      badges
        .map((badge) => /^community:([^:]+):/.exec(badge.type)?.[1])
        .filter(Boolean),
    );

    for (const provider of ['ffz', 'bttv', 'chatterino', 'homies', 'chatsen', 'chatty', 'dankchat']) {
      expect(providers.has(provider)).toBe(true);
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

    const badges = await resolveTwitchCommunityBadges('123', 'TargetUser');
    expect(badges).toContainEqual({
      type: 'community:ffz:7',
      url: 'https://cdn.example/ffz.png',
    });
    expect(badges.some((badge) => badge.type.startsWith('community:chatty:'))).toBe(false);
  });
});
