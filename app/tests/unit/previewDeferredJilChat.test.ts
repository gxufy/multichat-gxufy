import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  __resetCommunityBadgeCache,
  resolveTwitchJilChatBadges,
} from '@/lib/communityBadges';

describe('deferred Preview JilChat parity', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
    vi.restoreAllMocks();
  });

  it('uses the authoritative per-user route but displays one JilChat provider slot', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);

        if (
          url
          === '/api/twitch/jilchat-badges?userId=204219574'
        ) {
          return new Response(
            JSON.stringify([
              {
                id: 'founder',
                title: 'JilChat Founder',
                url: 'https://api.jil.chat/founder.png',
              },
              {
                id: 'month-1',
                title: 'JilChat Month 1',
                url: 'https://api.jil.chat/month-1.png',
              },
            ]),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        }

        return new Response('{}', {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      },
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolveTwitchJilChatBadges('204219574'),
    ).resolves.toEqual([
      {
        type: 'community:jilchat:founder',
        title: 'JilChat Founder',
        url: 'https://api.jil.chat/founder.png',
      },
    ]);

    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          String(input)
          === '/api/twitch/jilchat-badges?userId=204219574',
      ),
    ).toHaveLength(1);
  });
});
