import {
  normalizeClientIp,
} from '@/lib/server/clientIdentity';

export const ABUSE_DISCORD_WEBHOOK_ENV =
  'GXUFY_ABUSE_DISCORD_WEBHOOK_URL';

const DELIVERY_TIMEOUT_MS = 4_000;

/*
 * A protective 429 is not automatically abuse. Normal overlay startup can
 * briefly fan out across several server resources. Require repeated rejected
 * work from the same client and resource area before creating an alert.
 */
export const ABUSE_STRIKE_WINDOW_MS = 60_000;
export const ABUSE_STRIKE_THRESHOLD = 3;
const ABUSE_STRIKE_MAX_ENTRIES = 2_048;

const DEDUPE_TTL_MS = 60_000;
const DEDUPE_MAX_ENTRIES = 2_048;
const DELIVERY_WINDOW_MS = 60_000;
const DELIVERY_MAX_PER_WINDOW = 20;

export type AbuseArea =
  | 'fixed-provider'
  | 'viewer'
  | 'tts'
  | 'shared-stream'
  | 'twitch-channel-search'
  | 'kick-channel-search'
  | 'youtube-channel-search'
  | 'tiktok-channel-search';

export type AbuseRateLimitEvent = {
  clientIp: string;
  area: AbuseArea;
  retryAfterSeconds: number;
};

export type AbuseDeliveryResult =
  | 'delivered'
  | 'deduped'
  | 'suppressed'
  | 'unconfigured'
  | 'ignored'
  | 'failed';

const recentEvents =
  new Map<string, number>();

type AbuseStrikeBucket = {
  count: number;
  startedAt: number;
};

const abuseStrikes =
  new Map<string, AbuseStrikeBucket>();

let recentDeliveries:
  number[] = [];

function validDiscordWebhookUrl(
  value: string,
): boolean {
  try {
    const url =
      new URL(value);

    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return false;
    }

    if (
      url.hostname !== 'discord.com'
      && url.hostname !== 'discordapp.com'
    ) {
      return false;
    }

    return /^\/api\/webhooks\/[^/]+\/[^/]+$/.test(
      url.pathname,
    );
  } catch {
    return false;
  }
}

function areaLabel(
  area: AbuseArea,
): string {
  switch (area) {
    case 'fixed-provider':
      return 'Fixed-provider API';
    case 'viewer':
      return 'Viewer API';
    case 'tts':
      return 'TTS API';
    case 'shared-stream':
      return 'Shared stream API';
    case 'twitch-channel-search':
      return 'Twitch channel search';
    case 'kick-channel-search':
      return 'Kick channel search';
    case 'youtube-channel-search':
      return 'YouTube channel search';
    case 'tiktok-channel-search':
      return 'TikTok channel search';
  }
}

function positiveRetrySeconds(
  value: number,
): number {
  if (
    !Number.isFinite(value)
    || value <= 0
  ) {
    return 1;
  }

  return Math.min(
    86_400,
    Math.ceil(value),
  );
}

export function formatAbuseDiscordContent(
  event: AbuseRateLimitEvent,
  now = Date.now(),
): string | null {
  const clientIp =
    normalizeClientIp(
      event.clientIp,
    );

  if (!clientIp) {
    return null;
  }

  const timestamp =
    Math.floor(now / 1_000);

  return [
    ' GXUFY abuse-prevention limit',
    `Area: ${areaLabel(event.area)}`,
    `IP: \`${clientIp}\``,
    'Reason: Repeated rate limits indicate possible abuse',
    `Trigger: ${ABUSE_STRIKE_THRESHOLD} rejections within ${ABUSE_STRIKE_WINDOW_MS / 1_000}s`,
    `Retry after: ${positiveRetrySeconds(event.retryAfterSeconds)}s`,
    `Time: <t:${timestamp}:F>`,
  ].join('\n');
}

function prune(
  now: number,
): void {
  const cutoff =
    now - DEDUPE_TTL_MS;

  for (
    const [key, timestamp]
    of recentEvents
  ) {
    if (timestamp <= cutoff) {
      recentEvents.delete(key);
    }
  }

  const strikeCutoff =
    now - ABUSE_STRIKE_WINDOW_MS;

  for (
    const [key, bucket]
    of abuseStrikes
  ) {
    if (
      bucket.startedAt <=
      strikeCutoff
    ) {
      abuseStrikes.delete(key);
    }
  }

  recentDeliveries =
    recentDeliveries.filter(
      (timestamp) =>
        timestamp >
        now - DELIVERY_WINDOW_MS,
    );
}

function admitStrike(
  event: AbuseRateLimitEvent,
  now: number,
): boolean {
  const clientIp =
    normalizeClientIp(
      event.clientIp,
    );

  if (!clientIp) {
    return false;
  }

  prune(now);

  const key =
    `${clientIp}:${event.area}`;

  let bucket =
    abuseStrikes.get(key);

  if (!bucket) {
    while (
      abuseStrikes.size >=
      ABUSE_STRIKE_MAX_ENTRIES
    ) {
      const oldest =
        abuseStrikes.keys().next();

      if (oldest.done) break;

      abuseStrikes.delete(
        oldest.value,
      );
    }

    bucket = {
      count: 0,
      startedAt: now,
    };

    abuseStrikes.set(
      key,
      bucket,
    );
  } else {
    abuseStrikes.delete(key);
    abuseStrikes.set(
      key,
      bucket,
    );
  }

  bucket.count += 1;

  return (
    bucket.count >=
    ABUSE_STRIKE_THRESHOLD
  );
}

function admit(
  event: AbuseRateLimitEvent,
  now: number,
): boolean {
  const clientIp =
    normalizeClientIp(
      event.clientIp,
    );

  if (!clientIp) {
    return false;
  }

  prune(now);

  const key =
    `${clientIp}:${event.area}`;

  const previous =
    recentEvents.get(key);

  if (
    previous !== undefined
    && previous >
      now - DEDUPE_TTL_MS
  ) {
    return false;
  }

  if (
    recentDeliveries.length >=
    DELIVERY_MAX_PER_WINDOW
  ) {
    return false;
  }

  recentEvents.delete(key);
  recentEvents.set(
    key,
    now,
  );

  while (
    recentEvents.size >
    DEDUPE_MAX_ENTRIES
  ) {
    const oldest =
      recentEvents.keys().next();

    if (oldest.done) break;

    recentEvents.delete(
      oldest.value,
    );
  }

  recentDeliveries.push(now);

  return true;
}

export async function deliverAbuseRateLimit(
  event: AbuseRateLimitEvent,
  options: {
    webhookUrl?: string;
    fetch?: typeof fetch;
    now?: number;
  } = {},
): Promise<AbuseDeliveryResult> {
  const webhookUrl =
    options.webhookUrl
    ?? process.env[
      ABUSE_DISCORD_WEBHOOK_ENV
    ]
    ?? '';

  if (
    !webhookUrl
    || !validDiscordWebhookUrl(
      webhookUrl,
    )
  ) {
    return 'unconfigured';
  }

  const now =
    options.now
    ?? Date.now();

  const content =
    formatAbuseDiscordContent(
      event,
      now,
    );

  if (!content) {
    return 'ignored';
  }

  if (
    !admitStrike(
      event,
      now,
    )
  ) {
    return 'suppressed';
  }

  if (
    !admit(
      event,
      now,
    )
  ) {
    return 'deduped';
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      DELIVERY_TIMEOUT_MS,
    );

  try {
    const response =
      await (
        options.fetch
        ?? fetch
      )(
        webhookUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            content,
            allowed_mentions: {
              parse: [],
            },
          }),
          signal:
            controller.signal,
        },
      );

    return response.ok
      ? 'delivered'
      : 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

export function queueAbuseRateLimit(
  event: AbuseRateLimitEvent,
): void {
  const webhookUrl =
    process.env[
      ABUSE_DISCORD_WEBHOOK_ENV
    ]
    ?? '';

  /*
   * Local development/tests normally do not have the private webhook.
   * Do nothing rather than producing noisy warnings.
   */
  if (
    !validDiscordWebhookUrl(
      webhookUrl,
    )
  ) {
    return;
  }

  void deliverAbuseRateLimit(
    event,
    {
      webhookUrl,
    },
  );
}

export function resetAbuseDiscordForTests(): void {
  recentEvents.clear();
  abuseStrikes.clear();
  recentDeliveries = [];
}
