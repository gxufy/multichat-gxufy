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
  formatAbuseDiscordContent,
  resetAbuseDiscordForTests,
} from '@/lib/server/abuseDiscord';

const WEBHOOK =
  'https://discord.com/api/webhooks/test-id/test-token';

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
      formatAbuseDiscordContent(
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
    ).toBe([
      ' GXUFY abuse-prevention limit',
      'Area: TTS API',
      'IP: `203.0.113.24`',
      'Reason: Repeated rate limits indicate possible abuse',
      'Trigger: 3 rejections within 60s',
      'Retry after: 13s',
      'Time: <t:1700000000:F>',
    ].join('\n'));
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
      body.content,
    ).toContain(
      'Trigger: 3 rejections within 60s',
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
