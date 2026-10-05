/* Twitch pinned-message poller (browser-side).
 *
 * Wraps fetchTwitchChannelPin in a self-scheduling poll loop: the next
 * request is queued only once the previous one settles, so requests can
 * never overlap. One AbortController is live at a time; stop() aborts it.
 *
 * Twitch exposes no anonymous pin events (see lib/connectors/twitch.ts),
 * so polling the authorized pins API is the only way to surface a pin.
 *
 * Error policy follows TwitchPinApiError.code:
 *   invalid-request / channel-not-found → report once, stop permanently
 *   lookup-failed                       → report, retry with backoff
 */
import {
  fetchTwitchChannelPin,
  TwitchPinApiError,
  type TwitchPinApiMessage,
  type TwitchPinApiResult,
} from './twitchPinClient';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Delay between successful polls. */
const DEFAULT_INTERVAL_MS = 15_000;

/** Floor applied to a caller-supplied interval. */
const MIN_INTERVAL_MS = 5_000;

/** First retry delay after a lookup-failed response. */
const BACKOFF_START_MS = 2_000;

/** Ceiling for exponential backoff. */
const BACKOFF_MAX_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Options accepted by {@link startTwitchPinPoller}. */
export type TwitchPinPollerOptions = {
  /** UUID-formatted connection ID from the OAuth callback. */
  connectionId: string;
  /** Twitch channel login to watch. */
  login: string;
  /**
   * Called after every successful poll — with the pin, or `null` when
   * nothing is pinned, so a consumer can clear a pin it already shows.
   */
  onPin(pin: TwitchPinApiMessage | null): void;
  /**
   * Called on every failed poll. `fatal` is true when polling has
   * stopped permanently and no further callback will fire.
   */
  onError?(error: TwitchPinApiError, fatal: boolean): void;
  /** Delay between successful polls. Floored at {@link MIN_INTERVAL_MS}. */
  intervalMs?: number;
};

/**
 * Stops the poller. Idempotent — extra calls are no-ops.
 *
 * Prevents future polling, clears any pending timer, and aborts the
 * in-flight request.
 */
export type StopTwitchPinPoller = () => void;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Normalize an unknown throw into a TwitchPinApiError. */
function toPinApiError(error: unknown): TwitchPinApiError {
  if (error instanceof TwitchPinApiError) return error;
  return new TwitchPinApiError('Twitch pin lookup failed.', 0, 'lookup-failed');
}

/**
 * Resolve the effective poll interval.
 *
 * Non-finite input (NaN, Infinity) falls back to the default rather than
 * reaching setTimeout, where it would coerce to 0 and busy-loop. Finite
 * values below the floor are clamped.
 */
function resolveIntervalMs(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return DEFAULT_INTERVAL_MS;
  }
  return Math.max(MIN_INTERVAL_MS, requested);
}

/**
 * Invoke a consumer callback, swallowing anything it throws.
 *
 * A fault in consumer code must never reject the poll promise, alter the
 * schedule, or be mistaken for a transport failure. Nothing about the
 * error is logged — it may carry pin text or other caller data.
 */
function safeCallback(invoke: () => void): void {
  try {
    invoke();
  } catch {
    /* consumer fault — deliberately ignored */
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Begin polling the pins API for *login* and return a stop function.
 *
 * The first poll runs immediately; each later poll is scheduled only
 * after the previous one settles, so at most one request is ever in
 * flight. Backoff resets to the normal interval after any success.
 */
export function startTwitchPinPoller(
  opts: TwitchPinPollerOptions,
): StopTwitchPinPoller {
  const intervalMs = resolveIntervalMs(opts.intervalMs);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let backoffMs = 0;

  /** Queue the next poll unless the poller has been stopped. */
  function schedule(delayMs: number): void {
    if (stopped) return;
    timer = setTimeout(poll, delayMs);
  }

  /**
   * Apply the retry-or-stop transition for a failed poll.
   *
   * Timer, backoff, and stopped state are all settled before the consumer
   * is notified, so the transition holds regardless of what onError does.
   */
  function handleFailure(error: TwitchPinApiError): void {
    if (
      error.code === 'invalid-request' ||
      error.code === 'channel-not-found'
    ) {
      stopped = true;
      safeCallback(() => opts.onError?.(error, true));
      return;
    }

    // lookup-failed, or an abort we did not cause — transient, so retry.
    backoffMs = backoffMs === 0
      ? BACKOFF_START_MS
      : Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    schedule(backoffMs);
    safeCallback(() => opts.onError?.(error, false));
  }

  async function poll(): Promise<void> {
    timer = null;
    if (stopped) return;

    controller = new AbortController();

    let result: TwitchPinApiResult;

    try {
      result = await fetchTwitchChannelPin(
        opts.connectionId,
        opts.login,
        controller.signal,
      );
    } catch (error) {
      // Once stopped, every rejection is cleanup — including the
      // AbortError stop() itself raised. An abort while still active is
      // not ours, so it falls through to the transient retry path.
      if (stopped) return;
      handleFailure(toPinApiError(error));
      return;
    } finally {
      controller = null;
    }

    // stop() may have landed while the request was in flight.
    if (stopped) return;

    // onPin is called outside the try so a consumer fault can never be
    // read as a transport failure.
    backoffMs = 0;
    schedule(intervalMs);
    safeCallback(() => opts.onPin(result.pin));
  }

  void poll();

  return function stop(): void {
    stopped = true;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    if (controller !== null) {
      controller.abort();
      controller = null;
    }
  };
}
