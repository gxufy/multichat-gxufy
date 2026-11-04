import type {
  HypeTrainEventData,
} from './types';

export const HYPE_TRAIN_IDLE_POLL_MS =
  60_000;

export const HYPE_TRAIN_ACTIVE_POLL_MS =
  15_000;

export const HYPE_TRAIN_MAX_BACKOFF_MS =
  10 * 60_000;

export const HYPE_TRAIN_HIDE_AFTER_MS =
  5_000;

type ActiveResponse = {
  active: true;
  level: number;
  progress: number;
  goal: number;
};

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

  return {
    active: true,
    level: record.level,
    progress:
      record.progress,
    goal: record.goal,
  };
}

function sameState(
  a: ActiveResponse | null,
  b: ActiveResponse,
): boolean {
  return (
    a?.level === b.level &&
    a.progress === b.progress &&
    a.goal === b.goal
  );
}

export function startTwitchHypeTrainPoller(
  options:
    TwitchHypeTrainPollerOptions,
): () => void {
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

  function schedule(): void {
    if (stopped) {
      return;
    }

    timer = setTimeout(
      () => {
        timer = null;
        void poll();
      },
      delay,
    );
  }

  async function poll(): Promise<void> {
    if (stopped) {
      return;
    }

    controller =
      new AbortController();

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

          options.onEvent({
            phase: 'progress',
            level:
              parsed.level,
            progress:
              parsed.progress,
            goal:
              parsed.goal,
          });
        }
      } else {
        delay =
          HYPE_TRAIN_IDLE_POLL_MS;

        if (lastSent) {
          options.onEvent({
            phase: 'end',
            level:
              lastSent.level,
            progress:
              lastSent.progress,
            goal:
              lastSent.goal,
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

      delay = Math.min(
        Math.max(
          delay,
          HYPE_TRAIN_IDLE_POLL_MS,
        ) * 2,
        HYPE_TRAIN_MAX_BACKOFF_MS,
      );
    } finally {
      controller = null;
      schedule();
    }
  }

  void poll();

  return () => {
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
}