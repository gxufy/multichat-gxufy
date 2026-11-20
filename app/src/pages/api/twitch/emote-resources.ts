import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';

const REQUEST_TIMEOUT_MS =
  7_000;

export const TWITCH_EMOTE_RESOURCE_MAX_BYTES =
  4 * 1024 * 1024;

const GENERIC_ERROR = {
  error:
    'Unable to load Twitch emote resources.',
};

function providerUrls(
  channelId: string,
) {
  return {
    ffzGlobal:
      'https://api.betterttv.net/3/cached/frankerfacez/emotes/global',

    ffzChannel:
      'https://api.betterttv.net/3/cached/frankerfacez/users/twitch/'
      + channelId,

    bttvGlobal:
      'https://api.betterttv.net/3/cached/emotes/global',

    bttvChannel:
      'https://api.betterttv.net/3/cached/users/twitch/'
      + channelId,

    ffzRoom:
      'https://api.frankerfacez.com/v1/_room/id/'
      + channelId,
  };
}

/*
 * Each provider is read on its own clock and remembered on its own. One slow
 * or hanging provider (FFZ's room service has hung for minutes at a time) used
 * to hold the whole bundle past the route timeout, so every overlay lost all
 * BTTV and FFZ emotes. Now a provider that does not answer in time is simply
 * missing from this answer while the others arrive.
 *
 * Answers are kept per provider URL: a good one is reused for a few minutes
 * (the global lists are shared by every channel), and if a provider later
 * fails, its last good answer keeps being served for up to an hour. A failure
 * with nothing to fall back on is retried after a minute rather than on every
 * overlay load. Overlapping requests for the same URL share one fetch.
 */
/* BTTV answers in ~5 s for a channel it has not cached yet, so emote lists
   get 6 s (inside the route's 7 s). FFZ's room only carries the custom mod/VIP
   badge, so it gets less and never holds the emotes up for long. */
export const TWITCH_EMOTE_PROVIDER_TIMEOUT_MS =
  6_000;

export const TWITCH_EMOTE_ROOM_TIMEOUT_MS =
  2_500;

export const TWITCH_EMOTE_PROVIDER_FRESH_MS =
  5 * 60_000;

export const TWITCH_EMOTE_PROVIDER_RETRY_MS =
  60_000;

export const TWITCH_EMOTE_PROVIDER_STALE_MS =
  60 * 60_000;

export const TWITCH_EMOTE_PROVIDER_CACHE_MAX =
  2_000;

/* A provider host is skipped for a minute, for every channel, only once it
   has failed to answer this many times in a row with no answer in between
   (FFZ's room service hanging). One slow lookup on an otherwise healthy host
   (BTTV on a channel it has not cached) must not pause that whole host. After
   the pause the next request tries it again; one more failure pauses it again,
   one answer clears it. */
export const TWITCH_EMOTE_PROVIDER_HOST_PAUSE_MS =
  60_000;

export const TWITCH_EMOTE_PROVIDER_HOST_PAUSE_AFTER =
  3;

const hostHealth =
  new Map<string, { failuresInARow: number; pausedUntil: number }>();

function hostPaused(host: string): boolean {
  return (hostHealth.get(host)?.pausedUntil ?? 0) > Date.now();
}

function recordHostResult(host: string, answered: boolean): void {
  if (answered) {
    hostHealth.delete(host);
    return;
  }
  const health = hostHealth.get(host) ?? { failuresInARow: 0, pausedUntil: 0 };
  health.failuresInARow += 1;
  if (health.failuresInARow >= TWITCH_EMOTE_PROVIDER_HOST_PAUSE_AFTER) {
    health.pausedUntil = Date.now() + TWITCH_EMOTE_PROVIDER_HOST_PAUSE_MS;
  }
  hostHealth.set(host, health);
}

function providerHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

type ProviderEntry = {
  value: unknown | null;
  /** Reuse without asking upstream until this time. */
  freshUntil: number;
  /** A good answer may stand in for a failed refresh until this time (0: none). */
  staleUntil: number;
};

const providerCache =
  new Map<string, ProviderEntry>();

const providerInFlight =
  new Map<string, Promise<unknown | null>>();

export function resetTwitchEmoteResourceCacheForTests(): void {
  providerCache.clear();
  providerInFlight.clear();
  hostHealth.clear();
}

function rememberProvider(
  url: string,
  entry: ProviderEntry,
): void {
  providerCache.delete(url);
  providerCache.set(url, entry);
  while (providerCache.size > TWITCH_EMOTE_PROVIDER_CACHE_MAX) {
    const oldest = providerCache.keys().next().value as string;
    providerCache.delete(oldest);
  }
}

type ProviderResult =
  | { ok: true; value: unknown }
  /** unreachable: no answer at all (timeout or network), as opposed to an HTTP error. */
  | { ok: false; unreachable: boolean };

async function fetchProviderOnce(
  url: string,
  timeoutMs: number,
): Promise<ProviderResult> {
  const host =
    providerHost(url);

  if (hostPaused(host)) {
    return { ok: false, unreachable: true };
  }

  const controller =
    new AbortController();

  let timer:
    ReturnType<typeof setTimeout> | undefined;

  const timedOut =
    new Promise<ProviderResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, unreachable: true });
      }, timeoutMs);
    });

  const attempt = (async (): Promise<ProviderResult> => {
    let response: Response;
    try {
      response =
        await fetch(
          url,
          {
            signal:
              controller.signal,
            redirect:
              'error',
            headers: {
              Accept:
                'application/json, text/plain;q=0.9, */*;q=0.8',
            },
          },
        );
    } catch {
      /* No answer at all: timeout, refused, DNS. */
      return { ok: false, unreachable: true };
    }

    if (!response.ok) {
      await discardFixedProviderBody(response);
      return { ok: false, unreachable: false };
    }

    try {
      return {
        ok: true,
        value:
          await readBoundedFixedProviderJson(
            response,
            TWITCH_EMOTE_RESOURCE_MAX_BYTES,
          ),
      };
    } catch {
      /* Too large or not JSON: the host answered; a stalled body is a timeout. */
      return { ok: false, unreachable: controller.signal.aborted };
    }
  })();

  try {
    /* Bounded even if a fetch ignores its abort signal. */
    const result = await Promise.race([attempt, timedOut]);
    recordHostResult(host, result.ok || !result.unreachable);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function refreshProvider(
  url: string,
  previous: ProviderEntry | undefined,
  timeoutMs: number,
): Promise<unknown | null> {
  const result =
    await fetchProviderOnce(url, timeoutMs);

  const now =
    Date.now();

  if (result.ok) {
    rememberProvider(url, {
      value: result.value,
      freshUntil: now + TWITCH_EMOTE_PROVIDER_FRESH_MS,
      staleUntil: now + TWITCH_EMOTE_PROVIDER_STALE_MS,
    });
    return result.value;
  }

  const fallback =
    previous && previous.staleUntil > now
      ? previous
      : undefined;

  rememberProvider(url, {
    value: fallback ? fallback.value : null,
    freshUntil: now + TWITCH_EMOTE_PROVIDER_RETRY_MS,
    staleUntil: fallback ? fallback.staleUntil : 0,
  });

  return fallback ? fallback.value : null;
}

async function readOptionalProvider(
  url: string,
  timeoutMs = TWITCH_EMOTE_PROVIDER_TIMEOUT_MS,
): Promise<unknown | null> {
  const cached =
    providerCache.get(url);

  if (cached && cached.freshUntil > Date.now()) {
    return cached.value;
  }

  const pending =
    providerInFlight.get(url);

  if (pending) return pending;

  const started =
    refreshProvider(url, cached, timeoutMs)
      .finally(() => {
        if (providerInFlight.get(url) === started) {
          providerInFlight.delete(url);
        }
      });

  providerInFlight.set(url, started);
  return started;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    req.method !== 'GET'
  ) {
    res.setHeader(
      'Allow',
      'GET',
    );

    return res
      .status(405)
      .json({
        error:
          'Method not allowed.',
      });
  }

  const channelId =
    typeof req.query
      .channelId === 'string'
      ? req.query
          .channelId
          .trim()
      : '';

  if (
    !/^\d{1,30}$/.test(
      channelId,
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          'Invalid Twitch channel id.',
      });
  }

  const upstream =
    providerUrls(
      channelId,
    );

  try {
    const body =
      await runFixedProviderWork({
        /*
         * One shared piece of work per channel. (A single fixed key shared it
         * across channels, so a request could receive another channel's
         * BTTV/FFZ emotes.) The id is validated digits and the coordinator caps
         * how many keys can be in flight.
         */
        key:
          'twitch-emote-resources:'
          + channelId,

        clientKey:
          fixedProviderClientKey(
            req,
          ),

        run: () =>
          withFixedProviderTimeout(
            REQUEST_TIMEOUT_MS,
            async () => {
              const [
                ffzGlobal,
                ffzChannel,
                bttvGlobal,
                bttvChannel,
                ffzRoom,
              ] =
                await Promise.all([
                  readOptionalProvider(
                    upstream
                      .ffzGlobal,
                  ),

                  readOptionalProvider(
                    upstream
                      .ffzChannel,
                  ),

                  readOptionalProvider(
                    upstream
                      .bttvGlobal,
                  ),

                  readOptionalProvider(
                    upstream
                      .bttvChannel,
                  ),

                  readOptionalProvider(
                    upstream
                      .ffzRoom,
                    TWITCH_EMOTE_ROOM_TIMEOUT_MS,
                  ),
                ]);

              return {
                ffzGlobal,
                ffzChannel,
                bttvGlobal,
                bttvChannel,
                ffzRoom,
              };
            },
          ),
      });

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300',
    );

    return res
      .status(200)
      .json(
        body,
      );
  } catch (error) {
    if (
      error
        instanceof
          FixedProviderAdmissionError
    ) {
      res.setHeader(
        'Retry-After',
        String(
          error
            .retryAfterSeconds,
        ),
      );

      return res
        .status(
          error
            .statusCode,
        )
        .json(
          GENERIC_ERROR,
        );
    }

    return res
      .status(502)
      .json(
        GENERIC_ERROR,
      );
  }
}
