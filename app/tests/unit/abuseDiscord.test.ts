import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  ABUSE_STRIKE_THRESHOLD,
  ABUSE_STRIKE_WINDOW_MS,
  deliverAbuseRateLimit,
  abuseDiscordBody,
  resetAbuseDiscordForTests,
} from '@/lib/server/abuseDiscord';

const WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/test_token_value_1234567890';

describe('private abuse Discord alerts', () => {
  beforeEach(() => {
    resetAbuseDiscordForTests();
  });

  it('documents the repeated-rate-limit threshold in the alert', () => {
    expect(
      ABUSE_STRIKE_THRESHOLD,
    ).toBe(3);

    expect(
      ABUSE_STRIKE_WINDOW_MS,
    ).toBe(60_000);

    expect(
      abuseDiscordBody(
        {
          clientIp:
            '203.0.113.24',
          area:
            'tts',
          retryAfterSeconds:
            12.2,
        },
        1_700_000_000_000,
      ),
    ).toEqual({
      username: 'FlossChat',
      allowed_mentions: { parse: [] },
      embeds: [{
        title: 'Abuse-prevention limit',
        description: 'Repeated rate limits indicate possible abuse.',
        color: 0xef4444,
        fields: [
          { name: 'Area', value: 'TTS API', inline: true },
          { name: 'IP', value: '`203.0.113.24`', inline: true },
          { name: 'Lookup', value: '[AbuseIPDB](https://www.abuseipdb.com/check/203.0.113.24)', inline: true },
          { name: 'Trigger', value: '3 rejections within 60s', inline: true },
          { name: 'Retry after', value: '13s', inline: true },
        ],
        timestamp: '2023-11-14T22:13:20.000Z',
      }],
    });

    expect(
      abuseDiscordBody(
        { clientIp: 'not an ip', area: 'tts', retryAfterSeconds: 1 },
      ),
    ).toBeNull();
  });

  it('does not alert on one normal rejection and alerts only on the third strike', async () => {
    const outbound =
      vi.fn().mockResolvedValue(
        new Response(
          null,
          {
            status: 204,
          },
        ),
      );

    const event = {
      clientIp:
        '198.51.100.20',
      area:
        'fixed-provider' as const,
      retryAfterSeconds:
        44,
    };

    expect(
      await deliverAbuseRateLimit(
        event,
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now:
            1_700_000_000_000,
        },
      ),
    ).toBe(
      'suppressed',
    );

    expect(
      await deliverAbuseRateLimit(
        event,
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now:
            1_700_000_010_000,
        },
      ),
    ).toBe(
      'suppressed',
    );

    expect(
      outbound,
    ).not.toHaveBeenCalled();

    expect(
      await deliverAbuseRateLimit(
        event,
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now:
            1_700_000_020_000,
        },
      ),
    ).toBe(
      'delivered',
    );

    expect(
      outbound,
    ).toHaveBeenCalledTimes(
      1,
    );

    const [
      ,
      init,
    ] =
      outbound.mock.calls[0];

    const body =
      JSON.parse(
        String(
          init?.body,
        ),
      );

    expect(
      body.allowed_mentions,
    ).toEqual({
      parse: [],
    });

    expect(
      body.embeds[0].title,
    ).toBe(
      'Abuse-prevention limit',
    );

    expect(
      body.embeds[0].fields,
    ).toEqual(
      expect.arrayContaining([
        { name: 'Trigger', value: '3 rejections within 60s', inline: true },
        { name: 'Area', value: expect.any(String), inline: true },
        { name: 'IP', value: expect.stringMatching(/^`.+`$/), inline: true },
      ]),
    );

    expect(
      body,
    ).not.toHaveProperty(
      'content',
    );

    expect(
      await deliverAbuseRateLimit(
        event,
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now:
            1_700_000_021_000,
        },
      ),
    ).toBe(
      'deduped',
    );

    expect(
      outbound,
    ).toHaveBeenCalledTimes(
      1,
    );
  });

  it('counts resource areas independently', async () => {
    const outbound =
      vi.fn().mockResolvedValue(
        new Response(
          null,
          {
            status: 204,
          },
        ),
      );

    const base = {
      clientIp:
        '203.0.113.55',
      retryAfterSeconds:
        10,
    };

    expect(
      await deliverAbuseRateLimit(
        {
          ...base,
          area:
            'viewer',
        },
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now: 1,
        },
      ),
    ).toBe(
      'suppressed',
    );

    expect(
      await deliverAbuseRateLimit(
        {
          ...base,
          area:
            'tts',
        },
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now: 2,
        },
      ),
    ).toBe(
      'suppressed',
    );

    expect(
      await deliverAbuseRateLimit(
        {
          ...base,
          area:
            'viewer',
        },
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
          now: 3,
        },
      ),
    ).toBe(
      'suppressed',
    );

    expect(
      outbound,
    ).not.toHaveBeenCalled();
  });

  it('ignores unknown client identities', async () => {
    const outbound =
      vi.fn();

    expect(
      await deliverAbuseRateLimit(
        {
          clientIp:
            'unknown',
          area:
            'shared-stream',
          retryAfterSeconds:
            5,
        },
        {
          webhookUrl:
            WEBHOOK,
          fetch:
            outbound as typeof fetch,
        },
      ),
    ).toBe(
      'ignored',
    );

    expect(
      outbound,
    ).not.toHaveBeenCalled();
  });

  it('rejects non-Discord webhook destinations', async () => {
    const outbound =
      vi.fn();

    expect(
      await deliverAbuseRateLimit(
        {
          clientIp:
            '203.0.113.10',
          area:
            'twitch-channel-search',
          retryAfterSeconds:
            30,
        },
        {
          webhookUrl:
            'https://example.com/api/webhooks/id/token',
          fetch:
            outbound as typeof fetch,
        },
      ),
    ).toBe(
      'unconfigured',
    );

    expect(
      outbound,
    ).not.toHaveBeenCalled();
  });
});
