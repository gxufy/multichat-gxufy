import type {
  HypeTrainEventData,
  HypeTrainKind,
} from './types';

export const HYPE_TRAIN_IDLE_POLL_MS =
  60_000;

export const HYPE_TRAIN_ACTIVE_POLL_MS =
  15_000;

export const HYPE_TRAIN_MAX_BACKOFF_MS =
  10 * 60_000;

export const HYPE_TRAIN_HIDE_AFTER_MS =
  5_000;

/* A sub, gift or cheer in chat asks for the train sooner (poke): after this
   long, so Twitch has counted it, and never sooner than this after the last
   look, so a gift bomb makes one request, not dozens. */
export const HYPE_TRAIN_POKE_DELAY_MS =
  2_000;

export const HYPE_TRAIN_POKE_MIN_GAP_MS =
  4_000;

/** Stops the poller; `poke()` asks for the train soon (a contribution just showed in chat). */
export type TwitchHypeTrainPoller =
  (() => void) & { poke(): void };

type ActiveResponse = {
  active: true;
  level: number;
  progress: number;
  goal: number;
  /* Turned into this viewer's clock as the answer arrives. */
  endsAt?: number;
  startedAt?: number;
  kind?: HypeTrainKind;
  shared?: boolean;
  record?: boolean;
  treasure?: { percent: number; level: number };
};

const KINDS: readonly HypeTrainKind[] = ['regular', 'golden-kappa', 'treasure', 'mythic', 'community', 'pinata'];

/** A countdown that moved less than this is the same one (answers take a moment to arrive). */
const SAME_END_MS = 2_000;

type InactiveResponse = {
  active: false;
};

type ApiResponse =
  | ActiveResponse
  | InactiveResponse;

export type TwitchHypeTrainEvent =
  HypeTrainEventData;

export interface TwitchHypeTrainPollerOptions {
  channel: string;
  onEvent(
    event: TwitchHypeTrainEvent,
  ): void;
  fetchImpl?: typeof fetch;
}

function safeInteger(
  value: unknown,
  minimum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum
  );
}

function parseResponse(
  value: unknown,
): ApiResponse | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const record =
    value as
      Record<string, unknown>;

  if (
    record.active === false
  ) {
    return {
      active: false,
    };
  }

  if (
    record.active !== true ||
    !safeInteger(
      record.level,
      1,
    ) ||
    !safeInteger(
      record.progress,
      0,
    ) ||
    !safeInteger(
      record.goal,
      0,
    )
  ) {
    return null;
  }

  const now = Date.now();
  const parsed: ActiveResponse = {
    active: true,
    level: record.level,
    progress:
      record.progress,
    goal: record.goal,
  };
  if (safeInteger(record.endsInMs, 0) && record.endsInMs <= 60 * 60_000) {
    parsed.endsAt = now + record.endsInMs;
  }
  if (safeInteger(record.startedAgoMs, 0)) {
    parsed.startedAt = now - record.startedAgoMs;
  }
  if (typeof record.kind === 'string' && (KINDS as readonly string[]).includes(record.kind) && record.kind !== 'regular') {
    parsed.kind = record.kind as HypeTrainKind;
  }
  if (record.shared === true) parsed.shared = true;
  if (record.record === true) parsed.record = true;
  const treasure = record.treasure as Record<string, unknown> | null | undefined;
  if (
    treasure && typeof treasure === 'object'
    && safeInteger(treasure.percent, 1) && treasure.percent <= 100
    && safeInteger(treasure.level, 1)
  ) {
    parsed.treasure = { percent: treasure.percent, level: treasure.level };
  }
  return parsed;
}

/** The event for a running train, with only the details it has. */
function progressEvent(train: ActiveResponse): TwitchHypeTrainEvent {
  return {
    phase: 'progress',
    level: train.level,
    progress: train.progress,
    goal: train.goal,
    ...(train.endsAt !== undefined ? { endsAt: train.endsAt } : {}),
    ...(train.startedAt !== undefined ? { startedAt: train.startedAt } : {}),
    ...(train.kind ? { kind: train.kind } : {}),
    ...(train.shared ? { shared: true } : {}),
    ...(train.record ? { record: true } : {}),
    ...(train.treasure ? { treasure: train.treasure } : {}),
  };
}

function sameState(
  a: ActiveResponse | null,
  b: ActiveResponse,
): boolean {
  return (
    a?.level === b.level &&
    a.progress === b.progress &&
    a.goal === b.goal &&
    a.kind === b.kind &&
    a.shared === b.shared &&
    a.record === b.record &&
    a.treasure?.percent === b.treasure?.percent &&
    a.treasure?.level === b.treasure?.level &&
    (a.endsAt === undefined) === (b.endsAt === undefined) &&
    Math.abs((a.endsAt ?? 0) - (b.endsAt ?? 0)) < SAME_END_MS
  );
}

export function startTwitchHypeTrainPoller(
  options:
    TwitchHypeTrainPollerOptions,
): TwitchHypeTrainPoller {
  const channel =
    options.channel
      .trim()
      .toLowerCase()
      .replace(/^@/, '');

  const fetchImpl =
    options.fetchImpl ??
    fetch;

  let stopped = false;

  let timer:
    ReturnType<
      typeof setTimeout
    >
    | null = null;

  let controller:
    AbortController
    | null = null;

  let delay =
    HYPE_TRAIN_IDLE_POLL_MS;

  let lastSent:
    ActiveResponse
    | null = null;

  /* When the next look is due, and how the last one went. */
  let nextAt = 0;
  let lastPollAt = 0;
  let inFlight = false;
  let pokedInFlight = false;
  let failing = false;

  function scheduleAt(at: number): void {
    if (stopped) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    nextAt = at;

    timer = setTimeout(
      () => {
        timer = null;
        void poll();
      },
      Math.max(0, at - Date.now()),
    );
  }

  function schedule(): void {
    scheduleAt(Date.now() + delay);
  }

  /* A contribution showed in chat: look soon (a train may have started or
     moved), unless a look is already due sooner. While lookups fail, the
     usual back-off stands. */
  function poke(): void {
    if (stopped || failing) {
      return;
    }

    if (inFlight) {
      pokedInFlight = true;
      return;
    }

    const at = Math.max(
      Date.now() + HYPE_TRAIN_POKE_DELAY_MS,
      lastPollAt + HYPE_TRAIN_POKE_MIN_GAP_MS,
    );

    if (timer && nextAt <= at) {
      return;
    }

    scheduleAt(at);
  }

  async function poll(): Promise<void> {
    if (stopped) {
      return;
    }

    controller =
      new AbortController();

    inFlight = true;
    lastPollAt = Date.now();

    try {
      const response =
        await fetchImpl(
          '/api/twitch/hypetrain?channel=' +
            encodeURIComponent(
              channel,
            ),
          {
            method: 'GET',
            headers: {
              Accept:
                'application/json',
            },
            cache: 'no-store',
            signal:
              controller.signal,
          },
        );

      if (!response.ok) {
        throw new Error(
          'Hype Train lookup failed.',
        );
      }

      const parsed =
        parseResponse(
          await response.json(),
        );

      if (!parsed) {
        throw new Error(
          'Malformed Hype Train response.',
        );
      }

      if (stopped) {
        return;
      }

      failing = false;

      if (parsed.active) {
        delay =
          HYPE_TRAIN_ACTIVE_POLL_MS;

        if (
          !sameState(
            lastSent,
            parsed,
          )
        ) {
          lastSent = parsed;

          options.onEvent(
            progressEvent(parsed),
          );
        }
      } else {
        delay =
          HYPE_TRAIN_IDLE_POLL_MS;

        if (lastSent) {
          options.onEvent({
            ...progressEvent(lastSent),
            phase: 'end',
            hideAfterMs:
              HYPE_TRAIN_HIDE_AFTER_MS,
          });

          lastSent = null;
        }
      }
    } catch {
      if (stopped) {
        return;
      }

      failing = true;
      pokedInFlight = false;

      delay = Math.min(
        Math.max(
          delay,
          HYPE_TRAIN_IDLE_POLL_MS,
        ) * 2,
        HYPE_TRAIN_MAX_BACKOFF_MS,
      );
    } finally {
      controller = null;
      inFlight = false;

      if (pokedInFlight) {
        /* A contribution showed while this look was out: look once more. */
        pokedInFlight = false;
        scheduleAt(
          Math.max(
            Date.now() + HYPE_TRAIN_POKE_DELAY_MS,
            lastPollAt + HYPE_TRAIN_POKE_MIN_GAP_MS,
          ),
        );
      } else {
        schedule();
      }
    }
  }

  void poll();

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    controller?.abort();
    controller = null;
  };

  return Object.assign(stop, { poke });
}