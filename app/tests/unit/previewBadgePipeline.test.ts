import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_BADGE_CATALOG,
  __resetPreviewBadgeCache,
  loadPreviewBadgeResources,
} from '@/features/multichat/previewBadgeLibrary';

const twitchBody = {
  badges: {
    'moderator/1': 'https://cdn.example/global-mod.png',
    'subscriber/6': 'https://cdn.example/channel-sub.png',
  },
  roomId: '42',
};

const sevenTVBody = {
  data: {
    cosmetics: {
      badges: [{ id: 'seven-badge', tooltip: '7TV badge', host: { url: '//cdn.7tv.app/badge/seven-badge' } }],
    },
  },
};

const kickBody = {
  id: 8,
  user_id: 9,
  slug: 'kick-channel',
  chatroom: { id: 10 },
  subscriber_badges: [
    { id: 11, months: 1, badge_image: { src: 'https://cdn.example/kick-sub-1.png' } },
    { id: 12, months: 6, badge_image: { src: 'javascript:bad' } },
  ],
  user: { id: 9, username: 'kick-channel' },
};

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

afterEach(() => {
  __resetPreviewBadgeCache();
  vi.unstubAllGlobals();
});

describe('preview multi-provider badge pipeline', () => {
  it('loads Twitch global/channel, FFZ, 7TV, and validated Kick channel art after invocation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/twitch/badges?')) return response(twitchBody);
      if (url === 'https://7tv.io/v3/gql') return response(sevenTVBody);
      if (url === '/api/kick/channel?channel=kick-channel') return response(kickBody);
      if (url === 'https://kick.com/api/v2/channels/kick-channel') return response(kickBody);
      if (url === 'https://api.frankerfacez.com/v1/_room/id/42') {
        return response({ room: { moderator_badge: true, vip_badge: true } });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const resources = await loadPreviewBadgeResources({
      twitch: 'Twitch_Channel',
      kick: '@Kick-Channel',
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(resources.twitchBadges).toMatchObject(twitchBody.badges);
    expect(resources.ffzBadges).toEqual({
      'moderator/1': 'https://cdn.frankerfacez.com/room-badge/mod/id/42/4/rounded',
      'vip/1': 'https://cdn.frankerfacez.com/room-badge/vip/id/42/4',
    });
    expect(resources.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'seven-badge', provider: '7TV' }),
      expect.objectContaining({ id: 'twitch-moderator/1', provider: 'Twitch' }),
      expect.objectContaining({ id: 'kick-subscriber-1', provider: 'Kick' }),
    ]));
    expect(resources.kickChannel?.subscriber_badges).toHaveLength(1);
    expect(resources.failedProviders).toEqual([]);
  });

  it('keeps successful providers when another provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/twitch/badges?')) return response({}, false);
      if (url === 'https://7tv.io/v3/gql') return response(sevenTVBody);
      throw new Error('offline');
    }));

    const resources = await loadPreviewBadgeResources({ twitch: 'channel' });
    expect(resources.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'seven-badge', provider: '7TV' }),
    ]));
    expect(resources.assets.length).toBeGreaterThan(PREVIEW_BADGE_CATALOG.length);
    expect(resources.failedProviders).toContain('Twitch');
  });

  it('coalesces concurrent requests for the same channels', async () => {
    let resolveSevenTV!: () => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://7tv.io/v3/gql') {
        return new Promise<Response>((resolve) => {
          resolveSevenTV = () => resolve(response(sevenTVBody));
        });
      }
      if (url.startsWith('/api/twitch/badges?')) return Promise.resolve(response(twitchBody));
      if (url.includes('frankerfacez.com')) return Promise.resolve(response({ room: {} }));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = loadPreviewBadgeResources({ twitch: 'channel' });
    const second = loadPreviewBadgeResources({ twitch: 'channel' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveSevenTV();
    expect(await first).toBe(await second);
  });
});
