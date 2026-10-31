import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  HYPE_TRAIN_ACTIVE_POLL_MS,
  HYPE_TRAIN_HIDE_AFTER_MS,
  HYPE_TRAIN_IDLE_POLL_MS,
  startTwitchHypeTrainPoller,
} from '@/lib/twitchHypeTrainPoller';

function response(
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status: 200,
      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe(
  'Twitch Hype Train poller',
  () => {
    it(
      'uses 15-second active polling and emits only changed state',
      async () => {
        vi.useFakeTimers();

        const fetchMock =
          vi.fn()
            .mockResolvedValueOnce(
              response({
                active: true,
                level: 2,
                progress: 100,
                goal: 1000,
              }),
            )
            .mockResolvedValueOnce(
              response({
                active: true,
                level: 2,
                progress: 100,
                goal: 1000,
              }),
            )
            .mockResolvedValueOnce(
              response({
                active: true,
                level: 2,
                progress: 200,
                goal: 1000,
              }),
            );

        const events:
          unknown[] = [];

        const stop =
          startTwitchHypeTrainPoller({
            channel:
              'Streamer',
            onEvent:
              (event) =>
                events.push(
                  event,
                ),
            fetchImpl:
              fetchMock as unknown as
                typeof fetch,
          });

        await settle();

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(1);

        expect(events).toEqual([
          {
            phase:
              'progress',
            level: 2,
            progress: 100,
            goal: 1000,
          },
        ]);

        await vi.advanceTimersByTimeAsync(
          HYPE_TRAIN_ACTIVE_POLL_MS,
        );

        await settle();

        expect(events).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(
          HYPE_TRAIN_ACTIVE_POLL_MS,
        );

        await settle();

        expect(events).toHaveLength(2);

        expect(events[1]).toEqual({
          phase:
            'progress',
          level: 2,
          progress: 200,
          goal: 1000,
        });

        stop();
      },
    );

    it(
      'emits one five-second completion state when the train ends',
      async () => {
        vi.useFakeTimers();

        const fetchMock =
          vi.fn()
            .mockResolvedValueOnce(
              response({
                active: true,
                level: 4,
                progress: 4800,
                goal: 5000,
              }),
            )
            .mockResolvedValueOnce(
              response({
                active: false,
              }),
            );

        const events:
          unknown[] = [];

        const stop =
          startTwitchHypeTrainPoller({
            channel:
              'streamer',
            onEvent:
              (event) =>
                events.push(
                  event,
                ),
            fetchImpl:
              fetchMock as unknown as
                typeof fetch,
          });

        await settle();

        await vi.advanceTimersByTimeAsync(
          HYPE_TRAIN_ACTIVE_POLL_MS,
        );

        await settle();

        expect(events).toEqual([
          {
            phase:
              'progress',
            level: 4,
            progress: 4800,
            goal: 5000,
          },
          {
            phase: 'end',
            level: 4,
            progress: 4800,
            goal: 5000,
            hideAfterMs:
              HYPE_TRAIN_HIDE_AFTER_MS,
          },
        ]);

        stop();
      },
    );

    it(
      'backs off failure instead of rapidly retrying',
      async () => {
        vi.useFakeTimers();

        const fetchMock =
          vi.fn()
            .mockRejectedValueOnce(
              new Error(
                'network',
              ),
            )
            .mockResolvedValueOnce(
              response({
                active: false,
              }),
            );

        const stop =
          startTwitchHypeTrainPoller({
            channel:
              'streamer',
            onEvent:
              () => {},
            fetchImpl:
              fetchMock as unknown as
                typeof fetch,
          });

        await settle();

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(
          HYPE_TRAIN_IDLE_POLL_MS *
            2 -
            1,
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(
          1,
        );

        await settle();

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(2);

        stop();
      },
    );
  },
);