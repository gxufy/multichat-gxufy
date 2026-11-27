import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCommunityBadgeCache, resolveTwitchCommunityBadges } from '@/lib/communityBadges';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FFZ_IDS = {
  badges: [
    { id: 2, name: 'bot', title: 'Bot', color: '#595959', urls: { '1': 'https://cdn.frankerfacez.com/badge/2/1', '4': 'https://cdn.frankerfacez.com/badge/2/4' } },
    { id: 3, name: 'supporter', title: 'FFZ Supporter', color: '#755000', urls: { '4': 'https://cdn.frankerfacez.com/badge/3/4' } },
    { id: 9, name: 'nourl', title: 'No Art', urls: {} },
  ],
  users: { '2': [111], '3': [222, 333] },
};

beforeEach(() => {
  __resetCommunityBadgeCache();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
    String(input) === 'https://api.frankerfacez.com/v1/badges/ids' ? jsonResponse(FFZ_IDS) : jsonResponse({}, false)
  )));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ffz = (badges: Awaited<ReturnType<typeof resolveTwitchCommunityBadges>>) =>
  badges.filter((badge) => badge.type.startsWith('community:ffz:'));

describe('FFZ badges a channel gives its chatters', () => {
  it('shows the channel’s Bot badge on its bot, in FFZ’s colour', async () => {
    const badges = await resolveTwitchCommunityBadges({ userId: '555', login: 'channel_bot', ffzRoomBadgeIds: ['2'] });
    expect(ffz(badges)).toEqual([{
      type: 'community:ffz:2',
      url: 'https://cdn.frankerfacez.com/badge/2/4',
      backgroundColor: '#595959',
    }]);
  });

  it('shows it next to the chatter’s own FFZ badge instead of replacing it', async () => {
    const badges = await resolveTwitchCommunityBadges({ userId: '222', login: 'supporter_bot', ffzRoomBadgeIds: ['2'] });
    expect(ffz(badges).map((badge) => badge.type)).toEqual(['community:ffz:3', 'community:ffz:2']);
  });

  it('never shows the same badge twice', async () => {
    const badges = await resolveTwitchCommunityBadges({ userId: '111', login: 'global_bot', ffzRoomBadgeIds: ['2', '2'] });
    expect(ffz(badges).map((badge) => badge.type)).toEqual(['community:ffz:2']);
  });

  it('ignores ids FFZ does not have or cannot draw', async () => {
    const badges = await resolveTwitchCommunityBadges({ userId: '555', login: 'someone', ffzRoomBadgeIds: ['404', '9'] });
    expect(ffz(badges)).toEqual([]);
  });

  it('changes nothing for chatters the channel gave no badge', async () => {
    const plain = await resolveTwitchCommunityBadges({ userId: '333', login: 'viewer' });
    expect(ffz(plain).map((badge) => badge.type)).toEqual(['community:ffz:3']);
  });
});
