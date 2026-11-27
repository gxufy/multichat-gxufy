/*
 * The viewer counter's polling engine, used by the /counter page
 * (web/src/lib/overlay/counter/CounterRuntime.svelte).
 *
 * Counts: the chosen server endpoint for Twitch/YouTube/TikTok (server-cached),
 * plus Kick fetched directly from the browser — Kick's API allows browsers but
 * blocks server IPs. Every number is a concurrent-viewer metric. A platform that
 * is live but whose count cannot be determined shows an unavailable marker and
 * is excluded from the combined total rather than counted as zero.
 */
import {
  SERVER_PLATFORMS,
  type PlatformCountStatus,
  type ViewerCounterChannels,
  type ViewerPlatform,
} from './viewerCounterConfig';

/** Delay between polls, measured from when the previous poll settles. */
export const COUNTER_POLL_INTERVAL_MS = 10_000;

/** How long a previously good value survives consecutive failures. */
export const COUNTER_STALE_WINDOW_MS = 5 * 60_000;

/**
 * How long one poll cycle may spend waiting on providers before committing
 * whatever it has. Bounded so the first cycle always reaches a value, and so
 * the poll interval is measured from a settlement that actually happens.
 */
export const COUNTER_REQUEST_TIMEOUT_MS = 8_000;

export type CounterServerEndpoint = '/api/viewers' | '/api/audience';

export type CounterPollingOptions = {
  channels: ViewerCounterChannels;
  serverEndpoint: CounterServerEndpoint;
  /**
   * One platform's status as soon as it answers (each provider commits on its
   * own, so a fast one never waits for a slow one). `usable` is true for a
   * real measurement or a retained last good value, false for the unavailable
   * marker.
   */
  onStatus(platform: ViewerPlatform, status: PlatformCountStatus, usable: boolean): void;
  /**
   * A whole cycle settled. If every configured provider failed with no
   * retained value, the unavailable marker may show from now on.
   */
  onCycleSettled(): void;
};

/** A good status plus when it was measured, for staleness bounding. */
type TimedStatus = { status: PlatformCountStatus; at: number };

/** Starts polling at once; returns the stop function (aborts what is in flight). */
export function startCounterPolling({
  channels,
  serverEndpoint,
  onStatus,
  onCycleSettled,
}: CounterPollingOptions): () => void {
  /* Last known good value per platform, used to bound staleness. A new
     engine (a channel change) starts from a clean slate. */
  const lastGood = new Map<ViewerPlatform, TimedStatus>();

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /* The current cycle's deadline. Held out here so stop can clear it: a
     pending abort timer after stop is a leak whether or not it fires. */
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;

  const retryAfterUntil = new Map<ViewerPlatform, number>();

  function commitPlatform(platform: ViewerPlatform, incoming?: PlatformCountStatus) {
    const now = Date.now();
    let status: PlatformCountStatus;
    let usable = false;

    if (incoming) {
      lastGood.set(platform, { status: incoming, at: now });
      status = incoming;
      usable = true;
    } else {
      const retained = lastGood.get(platform);
      if (retained && now - retained.at < COUNTER_STALE_WINDOW_MS) {
        status = retained.status;
        usable = true;
      } else {
        if (retained) lastGood.delete(platform);
        status = { state: 'unavailable' };
      }
    }

    if (cancelled) return;
    onStatus(platform, status, usable);
  }

  function rememberRetryAfter(platform: ViewerPlatform, response: Response) {
    if (response.status !== 429 && response.status !== 503) return;
    const raw = response.headers.get('retry-after');
    if (!raw) return;

    const now = Date.now();
    const seconds = Number(raw);
    let until = Number.NaN;

    if (Number.isFinite(seconds) && seconds > 0) {
      until = now + Math.min(seconds, 300) * 1_000;
    } else {
      const parsedDate = Date.parse(raw);
      if (Number.isFinite(parsedDate) && parsedDate > now) {
        until = Math.min(parsedDate, now + 5 * 60_000);
      }
    }

    if (Number.isFinite(until)) retryAfterUntil.set(platform, until);
  }

  /** One poll cycle. Never throws; partial success is preserved. */
  async function poll(): Promise<void> {
    /* One controller serves both reasons a request should stop: stop() and
     * this cycle running out of time. A deadline rather than a race, so timing
     * out also cancels the request (a race would leave the socket open and a
     * late reply could land in a later cycle). Two callers aborting one
     * controller is what AbortSignal.any would compose to anyway, and it is
     * too new to assume in the browsers OBS ships. */
    controller = new AbortController();
    const signal = controller.signal;
    const cycle = controller;
    deadline = setTimeout(() => {
      /* What already resolved is committed; the rest reject into the per-job
         catches and fall back to the stale-window policy, like any failure. */
      cycle.abort();
    }, COUNTER_REQUEST_TIMEOUT_MS);
    const jobs: Promise<void>[] = [];

    /* Twitch, YouTube and TikTok use separate requests: the server still owns
       cache sharing and coalescing; this only removes head-of-line blocking. */
    for (const platform of SERVER_PLATFORMS) {
      const name = channels[platform];
      if (!name) continue;

      if ((retryAfterUntil.get(platform) ?? 0) > Date.now()) {
        commitPlatform(platform);
        continue;
      }

      const params = new URLSearchParams([[platform, name]]);
      jobs.push(
        fetch(`${serverEndpoint}?${params.toString()}`, { signal })
          .then(async (response) => {
            if (!response.ok) {
              rememberRetryAfter(platform, response);
              commitPlatform(platform);
              return;
            }
            const data = await response.json();
            if (!data || typeof data !== 'object') {
              commitPlatform(platform);
              return;
            }
            const entry = (data as Record<string, unknown>)[platform];
            if (!entry || typeof entry !== 'object') {
              commitPlatform(platform);
              return;
            }
            const { live, viewers } = entry as { live?: unknown; viewers?: unknown };
            let status: PlatformCountStatus;
            if (live !== true) status = { state: 'offline' };
            else if (typeof viewers === 'number' && Number.isFinite(viewers)) status = { state: 'live', viewers };
            else status = { state: 'live-unknown' };
            retryAfterUntil.delete(platform);
            commitPlatform(platform, status);
          })
          .catch(() => {
            commitPlatform(platform);
          }),
      );
    }

    /* Kick stays browser-side because its public endpoint rejects the
       deployment server's IP. */
    const kick = channels.kick;
    if (kick) {
      if ((retryAfterUntil.get('kick') ?? 0) > Date.now()) {
        commitPlatform('kick');
      } else {
        const kickUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(kick)}`;
        jobs.push(
          fetch(kickUrl, { headers: { Accept: 'application/json' }, signal })
            .then(async (response) => {
              if (!response.ok) {
                rememberRetryAfter('kick', response);
                commitPlatform('kick');
                return;
              }
              const data = await response.json();
              if (!data || typeof data !== 'object') {
                commitPlatform('kick');
                return;
              }
              const stream = (data as { livestream?: unknown }).livestream;
              if (!stream || typeof stream !== 'object') {
                retryAfterUntil.delete('kick');
                commitPlatform('kick', { state: 'offline' });
                return;
              }
              const count = (stream as { viewer_count?: unknown }).viewer_count;
              retryAfterUntil.delete('kick');
              commitPlatform(
                'kick',
                typeof count === 'number' && Number.isFinite(count)
                  ? { state: 'live', viewers: count }
                  : { state: 'live-unknown' },
              );
            })
            .catch(() => {
              commitPlatform('kick');
            }),
        );
      }
    }

    await Promise.all(jobs);

    /* Settled, so the deadline has no one left to interrupt. */
    clearTimeout(deadline);
    deadline = undefined;

    if (cancelled) return;
    onCycleSettled();

    /* The next poll only once this one has settled, so polls never overlap.
       (This engine tells an embedding page nothing: the overlay is the same
       document in OBS, in a tab and in the preview.) */
    timer = setTimeout(poll, COUNTER_POLL_INTERVAL_MS);
  }

  void poll();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    /* Unmount and channel change abort at once; neither waits out a timeout. */
    if (deadline) clearTimeout(deadline);
    if (controller) controller.abort();
  };
}
