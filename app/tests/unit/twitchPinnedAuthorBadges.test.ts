import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getConnection = vi.hoisted(() => vi.fn());
const refreshConnection = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/twitchConnectionReader', () => ({
  getTwitchConnection: getConnection,
}));

vi.mock('@/lib/server/twitchConnectionRefresher', () => ({
  refreshStoredTwitchConnection: refreshConnection,
}));

import { getStoredTwitchPinnedAuthorBadges } from '@/lib/server/twitchStoredPinnedAuthorBadges';

const CONNECTION_ID = '123e4567-e89b-12d3-a456-426614174000';

function connection(overrides: Record<string, unknown> = {}) {
  return {
    twitchUserId: '100',
    accessToken: 'token-1',
    scopes: ['moderator:read:chat_messages'],
    ...overrides,
  };
}

function ok(data: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as Response;
}

beforeEach(() => {
  getConnection.mockReset();
  refreshConnection.mockReset();
  getConnection.mockResolvedValue(connection());
  process.env.TWITCH_CLIENT_ID = 'test-client';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TWITCH_CLIENT_ID;
});

describe('getStoredTwitchPinnedAuthorBadges', () => {
  it('infers the broadcaster badge without loading the OAuth connection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getStoredTwitchPinnedAuthorBadges(CONNECTION_ID, '100', '100'),
    ).resolves.toEqual([
      { type: 'broadcaster', version: '1' },
    ]);

    expect(getConnection).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps old baseline-scope connections working without role requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    getConnection.mockResolvedValue(
      connection({
        twitchUserId: '100',
        scopes: ['moderator:read:chat_messages'],
      }),
    );

    await expect(
      getStoredTwitchPinnedAuthorBadges(CONNECTION_ID, '100', '41'),
    ).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshConnection).not.toHaveBeenCalled();
  });

  it('resolves moderator, VIP, and subscriber membership for the pinned author', async () => {
    getConnection.mockResolvedValue(
      connection({
        twitchUserId: '100',
        scopes: [
          'moderator:read:chat_messages',
          'moderation:read',
          'channel:read:vips',
          'channel:read:subscriptions',
        ],
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      expect(url.searchParams.get('broadcaster_id')).toBe('100');
      expect(url.searchParams.get('user_id')).toBe('42');

      return ok([{ user_id: '42' }]);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getStoredTwitchPinnedAuthorBadges(CONNECTION_ID, '100', '42'),
    ).resolves.toEqual([
      { type: 'moderator', version: '1' },
      { type: 'vip', version: '1' },
      { type: 'subscriber', version: '0' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).toContain('/helix/moderation/moderators');
    expect(paths).toContain('/helix/channels/vips');
    expect(paths).toContain('/helix/subscriptions');
  });

  it('refreshes once after a 401 and retries the authorized role lookup', async () => {
    getConnection.mockResolvedValue(
      connection({
        accessToken: 'stale-token',
        scopes: [
          'moderator:read:chat_messages',
          'moderation:read',
        ],
      }),
    );

    refreshConnection.mockResolvedValue({
      twitchUserId: '100',
      accessToken: 'fresh-token',
      scopes: [
        'moderator:read:chat_messages',
        'moderation:read',
      ],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce(ok([{ user_id: '43' }]));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getStoredTwitchPinnedAuthorBadges(CONNECTION_ID, '100', '43'),
    ).resolves.toEqual([
      { type: 'moderator', version: '1' },
    ]);

    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer stale-token',
        'Client-Id': 'test-client',
      },
    });

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer fresh-token',
        'Client-Id': 'test-client',
      },
    });
  });

  it('does not query channel roles when the stored account is not the broadcaster', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    getConnection.mockResolvedValue(
      connection({
        twitchUserId: '999',
        scopes: [
          'moderator:read:chat_messages',
          'moderation:read',
          'channel:read:vips',
          'channel:read:subscriptions',
        ],
      }),
    );

    await expect(
      getStoredTwitchPinnedAuthorBadges(CONNECTION_ID, '100', '44'),
    ).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshConnection).not.toHaveBeenCalled();
  });
});