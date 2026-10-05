import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTwitchChannelPin,
} from '@/lib/twitchPinClient';

const CONNECTION_ID = '123e4567-e89b-12d3-a456-426614174000';

function payload(badges: unknown) {
  return {
    broadcaster: {
      login: 'streamer',
      displayName: 'Streamer',
    },
    pin: {
      messageId: 'pin-1',
      senderUserId: '42',
      color: '#9146FF',
      badges,
      senderUserLogin: 'viewer',
      senderUserName: 'Viewer',
      pinnedByUserLogin: 'streamer',
      pinnedByUserName: 'Streamer',
      text: 'hello',
      emotes: [],
      startsAt: '2026-09-19T18:00:00Z',
      endsAt: null,
      updatedAt: '2026-09-19T18:00:01Z',
    },
  };
}

function response(body: unknown) {
  return {
    status: 200,
    ok: true,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Twitch pin native badge validation', () => {
  it('accepts the supported native Twitch pin badges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            { type: 'broadcaster', version: '1' },
            { type: 'subscriber', version: '0' },
          ]),
        ),
      ),
    );

    const result = await fetchTwitchChannelPin(
      CONNECTION_ID,
      'streamer',
    );

    expect(result.pin?.badges).toEqual([
      { type: 'broadcaster', version: '1' },
      { type: 'subscriber', version: '0' },
    ]);
  });

  it('rejects an unknown badge type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            { type: 'staff', version: '1' },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({
      code: 'lookup-failed',
    });
  });

  it('rejects a badge with an empty version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            { type: 'moderator', version: '' },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({
      code: 'lookup-failed',
    });
  });

  it('rejects unexpected badge properties', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            {
              type: 'vip',
              version: '1',
              accessToken: 'must-not-pass-through',
            },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({
      code: 'lookup-failed',
    });
  });

  it('rejects a response with no badges array', async () => {
    const body = payload([]);
    delete (body.pin as Record<string, unknown>).badges;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(body)),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({
      code: 'lookup-failed',
    });
  });
});