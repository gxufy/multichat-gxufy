import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  __resetPreviewsBadgeCache,
  getPreviewsTwitchDataset,
  parsePreviewsTwitchDataset,
  PREVIEWS_APP_ID,
} from '@/lib/server/previewsBadges';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

afterEach(() => {
  __resetPreviewsBadgeCache();
  vi.unstubAllGlobals();
});

describe('Previews badge dataset', () => {
  it('parses the Twitch hash-to-month assignment table', () => {
    expect(
      parsePreviewsTwitchDataset({
        subs: {
          id: 'example',
          v: 3608,
          updated_at: '2026-10-20',
          subs: {
            yt: {},
            ttv: {
              [HASH_A]: 0,
              [HASH_B]: 21,
              invalid: 999,
              ['c'.repeat(64)]: -1,
            },
            kick: {},
          },
        },
      }),
    ).toEqual({
      version: 3608,
      updatedAt: '2026-10-20',
      twitch: {
        [HASH_A]: 0,
        [HASH_B]: 21,
      },
    });
  });

  it('uses only the stable gxufy app id for the upstream request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          subs: {
            id: 'example',
            v: 3608,
            updated_at: '2026-10-20',
            subs: {
              yt: {},
              ttv: {
                [HASH_A]: 14,
              },
              kick: {},
            },
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const first = await getPreviewsTwitchDataset();
    const second = await getPreviewsTwitchDataset();

    expect(first.twitch[HASH_A]).toBe(14);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(
      'https://previews-app.com/subs/get-updates-v6/',
    );

    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    expect(JSON.parse(String(init.body))).toEqual({
      u: PREVIEWS_APP_ID,
    });
  });

  it('rejects responses without the versioned Twitch dataset', () => {
    expect(() =>
      parsePreviewsTwitchDataset({
        updates: [],
      }),
    ).toThrow('Missing Previews subscriber dataset');
  });
});