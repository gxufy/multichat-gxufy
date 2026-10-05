import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTwitchPinnedMessage } from '../../src/lib/server/twitchPinnedMessage';

const ORIGINAL_CLIENT_ID = process.env.TWITCH_CLIENT_ID;

function twitchResponse(message: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          message_id: 'message-1',
          broadcaster_id: '100',
          sender_user_id: '200',
          sender_user_login: 'viewer',
          sender_user_name: 'Viewer',
          pinned_by_user_id: '100',
          pinned_by_user_login: 'streamer',
          pinned_by_user_name: 'Streamer',
          message,
          starts_at: '2026-09-19T20:00:00Z',
          ends_at: '2026-09-19T20:05:00Z',
          updated_at: '2026-09-19T20:00:00Z',
        },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

describe('fetchTwitchPinnedMessage native emotes', () => {
  beforeEach(() => {
    process.env.TWITCH_CLIENT_ID = 'client-id';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();

    if (ORIGINAL_CLIENT_ID === undefined) {
      delete process.env.TWITCH_CLIENT_ID;
    } else {
      process.env.TWITCH_CLIENT_ID = ORIGINAL_CLIENT_ID;
    }
  });

  it('converts Twitch emote fragments to code-point offsets and CDN artwork', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        twitchResponse({
          text: '\u{1F44B} hi bleedPurple!',
          fragments: [
            {
              type: 'text',
              text: '\u{1F44B} hi ',
              cheermote: null,
              emote: null,
              mention: null,
            },
            {
              type: 'emote',
              text: 'bleedPurple',
              cheermote: null,
              emote: {
                id: '62835',
                emote_set_id: '0',
                owner_id: '0',
                format: ['static'],
              },
              mention: null,
            },
            {
              type: 'text',
              text: '!',
              cheermote: null,
              emote: null,
              mention: null,
            },
          ],
        }),
      ),
    );

    const result = await fetchTwitchPinnedMessage('token', '100', '100');

    expect(result.status).toBe('ok');

    if (result.status !== 'ok' || result.pin === null) {
      throw new Error('Expected an active Twitch pin.');
    }

    expect(result.pin.emotes).toEqual([
      {
        begin: 5,
        end: 16,
        text: 'bleedPurple',
        url: 'https://static-cdn.jtvnw.net/emoticons/v2/62835/default/dark/3.0',
      },
    ]);
  });

  it('rejects fragments whose text does not reconstruct message.text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        twitchResponse({
          text: 'Hello bleedPurple',
          fragments: [
            {
              type: 'text',
              text: 'Hello ',
              cheermote: null,
              emote: null,
              mention: null,
            },
            {
              type: 'emote',
              text: 'Kappa',
              cheermote: null,
              emote: {
                id: '25',
                emote_set_id: '0',
                owner_id: '0',
                format: ['static'],
              },
              mention: null,
            },
          ],
        }),
      ),
    );

    await expect(
      fetchTwitchPinnedMessage('token', '100', '100'),
    ).rejects.toThrow('Twitch pinned message lookup failed.');
  });

  it('rejects an emote fragment without a usable emote id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        twitchResponse({
          text: 'Kappa',
          fragments: [
            {
              type: 'emote',
              text: 'Kappa',
              cheermote: null,
              emote: {
                id: '',
                emote_set_id: '0',
                owner_id: '0',
                format: ['static'],
              },
              mention: null,
            },
          ],
        }),
      ),
    );

    await expect(
      fetchTwitchPinnedMessage('token', '100', '100'),
    ).rejects.toThrow('Twitch pinned message lookup failed.');
  });
});
