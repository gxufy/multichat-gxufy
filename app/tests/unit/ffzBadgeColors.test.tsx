import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  __resetCommunityBadgeCache,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';
import { renderBadges } from '@/lib/render';
import type { UnifiedMessage } from '@/lib/types';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(cleanup);

describe('FFZ badge colors', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  it('preserves FFZ supporter/subwoofer colors and paints them behind the transparent badge art', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.frankerfacez.com/v1/badges') {
        return jsonResponse({
          badges: [
            {
              id: 3,
              name: 'supporter',
              title: 'FFZ Supporter',
              color: '#755000',
              urls: { '4': 'https://cdn.example/ffz-supporter.png' },
            },
            {
              id: 4,
              name: 'subwoofer',
              title: 'FFZ Subwoofer',
              color: '#369BEA',
              urls: { '4': 'https://cdn.example/ffz-subwoofer.png' },
            },
          ],
          users: {
            '3': ['SupporterUser'],
            '4': ['SubwooferUser'],
          },
        });
      }
      return jsonResponse({}, false);
    }));

    const supporter = await resolveTwitchCommunityBadges('1', 'SupporterUser');
    const subwoofer = await resolveTwitchCommunityBadges('2', 'SubwooferUser');

    expect(supporter).toContainEqual({
      type: 'community:ffz:3',
      url: 'https://cdn.example/ffz-supporter.png',
      backgroundColor: '#755000',
    });
    expect(subwoofer).toContainEqual({
      type: 'community:ffz:4',
      url: 'https://cdn.example/ffz-subwoofer.png',
      backgroundColor: '#369BEA',
    });

    const message: UnifiedMessage = {
      platform: 'twitch',
      id: 'ffz-color',
      senderId: '1',
      username: 'SupporterUser',
      color: '#ffffff',
      badges: supporter,
      text: 'hello',
      emotes: [],
      timestamp: Date.now(),
      kind: 'chat',
    };

    const { container } = render(<>{renderBadges(message, [])}</>);
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.style.backgroundColor).toBe('rgb(117, 80, 0)');
  });
});
