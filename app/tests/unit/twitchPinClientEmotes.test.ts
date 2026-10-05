import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchTwitchChannelPin } from '@/lib/twitchPinClient';

const CONNECTION_ID = '123e4567-e89b-12d3-a456-426614174000';

function payload(emotes: unknown) {
  return {
    broadcaster: {
      login: 'streamer',
      displayName: 'Streamer',
    },
    pin: {
      messageId: 'pin-1',
      senderUserId: '42',
      color: '#9146FF',
      badges: [],
      senderUserLogin: 'viewer',
      senderUserName: 'Viewer',
      pinnedByUserLogin: 'streamer',
      pinnedByUserName: 'Streamer',
      text: '\u{1F44B} hi bleedPurple!',
      emotes,
      startsAt: '2026-09-19T18:00:00Z',
      endsAt: null,
      updatedAt: '2026-09-19T18:00:01Z',
    },
  };
}

function response(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Twitch pin native emote validation', () => {
  it('accepts valid code-point offsets and Twitch CDN artwork', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            {
              begin: 5,
              end: 16,
              text: 'bleedPurple',
              url: 'https://static-cdn.jtvnw.net/emoticons/v2/62835/default/dark/3.0',
            },
          ]),
        ),
      ),
    );

    const result = await fetchTwitchChannelPin(CONNECTION_ID, 'streamer');

    expect(result.pin?.emotes).toEqual([
      {
        begin: 5,
        end: 16,
        text: 'bleedPurple',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/62835/default/dark/3.0',
      },
    ]);
  });

  it('rejects an emote whose offsets do not match its text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            {
              begin: 4,
              end: 15,
              text: 'bleedPurple',
              url: 'https://static-cdn.jtvnw.net/emoticons/v2/62835/default/dark/3.0',
            },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({ code: 'lookup-failed' });
  });

  it('rejects overlapping native emotes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            {
              begin: 5,
              end: 16,
              text: 'bleedPurple',
              url: 'https://static-cdn.jtvnw.net/emoticons/v2/62835/default/dark/3.0',
            },
            {
              begin: 10,
              end: 16,
              text: 'Purple',
              url: 'https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/3.0',
            },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({ code: 'lookup-failed' });
  });

  it('rejects non-Twitch emote artwork URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            {
              begin: 5,
              end: 16,
              text: 'bleedPurple',
              url: 'https://evil.example/62835/default/dark/3.0',
            },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({ code: 'lookup-failed' });
  });

  it('rejects unexpected emote properties', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          payload([
            {
              begin: 5,
              end: 16,
              text: 'bleedPurple',
              url: 'https://static-cdn.jtvnw.net/emoticons/v2/62835/default/dark/3.0',
              accessToken: 'should-never-be-here',
            },
          ]),
        ),
      ),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({ code: 'lookup-failed' });
  });

  it('rejects a response with no emotes array', async () => {
    const body = payload([]);
    delete (body.pin as Record<string, unknown>).emotes;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(body)),
    );

    await expect(
      fetchTwitchChannelPin(CONNECTION_ID, 'streamer'),
    ).rejects.toMatchObject({ code: 'lookup-failed' });
  });
});
