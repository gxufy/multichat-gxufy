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
  HYPE_TRAIN_MAX_BACKOFF_MS,
  HYPE_TRAIN_POKE_DELAY_MS,
  HYPE_TRAIN_POKE_MIN_GAP_MS,
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

/*
 * Flush pending promise work without advancing fake timers. A fixed three
 * microtask ticks was enough for Node 24's Response.json() but not Node 22's,
 * so drain a generous, bounded number of ticks instead.
 */
async function settle() {
  for (let tick = 0; tick < 50; tick += 1) {
    await Promise.resolve();
  }
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
describe('Twitch Hype Train poller: countdown and kind', () => {
  it('puts the countdown on this viewer\'s clock, keeps the kind, and ignores a countdown that only jittered', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-11-22T23:00:00.000Z'));
    const start = Date.now();
    const answers = [
      { active: true, level: 1, progress: 100, goal: 1000, endsInMs: 300_000, startedAgoMs: 5_000, kind: 'mythic', shared: true },
      /* 15 s later, the same end seen through a slower answer: no new event. */
      { active: true, level: 1, progress: 100, goal: 1000, endsInMs: 284_200, startedAgoMs: 20_000, kind: 'mythic', shared: true },
      /* A contribution moves the countdown on: a new event. */
      { active: true, level: 1, progress: 600, goal: 1000, endsInMs: 300_000, startedAgoMs: 35_000, kind: 'mythic', shared: true },
      { active: false },
    ];
    const fetchMock = vi.fn(async () => response(answers.shift()));
    const events: unknown[] = [];
    const stop = startTwitchHypeTrainPoller({
      channel: 'streamer',
      onEvent: (event) => events.push(event),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await settle();
    expect(events).toEqual([{
      phase: 'progress', level: 1, progress: 100, goal: 1000,
      endsAt: start + 300_000, startedAt: start - 5_000, kind: 'mythic', shared: true,
    }]);
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_ACTIVE_POLL_MS);
    await settle();
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_ACTIVE_POLL_MS);
    await settle();
    expect(events[1]).toMatchObject({ progress: 600, endsAt: start + 30_000 + 300_000, kind: 'mythic' });
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_ACTIVE_POLL_MS);
    await settle();
    expect(events[2]).toMatchObject({ phase: 'end', level: 1, kind: 'mythic', shared: true, hideAfterMs: HYPE_TRAIN_HIDE_AFTER_MS });
    stop();
  });

  it('drops details it does not understand', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => response({
      active: true, level: 2, progress: 1, goal: 2,
      endsInMs: -5, kind: 'freight', record: 'yes', treasure: { percent: 400, level: 2 },
    }));
    const events: unknown[] = [];
    const stop = startTwitchHypeTrainPoller({ channel: 'streamer', onEvent: (event) => events.push(event), fetchImpl: fetchMock as unknown as typeof fetch });
    await settle();
    expect(events).toEqual([{ phase: 'progress', level: 2, progress: 1, goal: 2 }]);
    stop();
  });
});

describe('Twitch Hype Train poller: a contribution in chat asks sooner', () => {
  const idle = () => response({ active: false });

  it('looks 2 s after a poke instead of waiting the minute, once for a burst of pokes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => idle());
    const stop = startTwitchHypeTrainPoller({ channel: 'streamer', onEvent: () => undefined, fetchImpl: fetchMock as unknown as typeof fetch });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* 5 s later, a gift bomb: many pokes, one look. */
    await vi.advanceTimersByTimeAsync(5_000);
    for (let i = 0; i < 20; i++) stop.poke();
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_POKE_DELAY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    /* Right after a look, a poke waits for the minimum gap. */
    stop.poke();
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_POKE_DELAY_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_POKE_MIN_GAP_MS - HYPE_TRAIN_POKE_DELAY_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    /* With nothing more, the minute cadence resumes. */
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_IDLE_POLL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    stop();
    stop.poke();
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_MAX_BACKOFF_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('a poke while a look is out brings one more look; while lookups fail, pokes wait for the back-off', async () => {
    vi.useFakeTimers();
    let release: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockImplementation(async () => idle());
    const stop = startTwitchHypeTrainPoller({ channel: 'streamer', onEvent: () => undefined, fetchImpl: fetchMock as unknown as typeof fetch });
    stop.poke();
    release(idle());
    await settle();
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_POKE_MIN_GAP_MS);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();

    const failing = vi.fn(async () => new Response('{}', { status: 502 }));
    const stopFailing = startTwitchHypeTrainPoller({ channel: 'streamer', onEvent: () => undefined, fetchImpl: failing as unknown as typeof fetch });
    await settle();
    expect(failing).toHaveBeenCalledTimes(1);
    stopFailing.poke();
    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_POKE_MIN_GAP_MS * 3);
    await settle();
    expect(failing).toHaveBeenCalledTimes(1);
    stopFailing();
  });
});
