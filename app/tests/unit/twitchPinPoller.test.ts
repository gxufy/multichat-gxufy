/* The Twitch pin poll loop.
 *
 * This module runs unattended for the length of a stream, so the properties that
 * matter are the ones that only show up over time: requests never overlapping, a
 * permanent failure actually stopping instead of hammering the API, a transient
 * one backing off rather than giving up, and stop() leaving nothing behind. None
 * of that was covered — the overlay's own tests mock this module away entirely.
 *
 * fetchTwitchChannelPin is mocked because the contract under test is the
 * scheduling, not the transport. Timers are faked so a 60s backoff ceiling can be
 * asserted without waiting for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTwitchPinPoller } from '@/lib/twitchPinPoller';
import { TwitchPinApiError, type TwitchPinApiMessage } from '@/lib/twitchPinClient';

const fetchPin = vi.hoisted(() => vi.fn());

vi.mock('@/lib/twitchPinClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/twitchPinClient')>();
  return { ...actual, fetchTwitchChannelPin: fetchPin };
});

/** A synthetic connection id. Never a real one. */
const CONN = '123e4567-e89b-12d3-a456-426614174000';
const LOGIN = 'somechannel';

function pin(messageId = 'm1'): TwitchPinApiMessage {
  return {
    messageId,
    updatedAt: '2024-01-01T00:00:00Z',
    startsAt: '2024-01-01T00:00:00Z',
    senderUserId: '1',
    senderUserName: 'someone',
    color: '',
    text: 'hello',
    pinnedByUserName: 'mod',
  } as TwitchPinApiMessage;
}

/** Let queued microtasks run, so an awaited fetch settles. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  fetchPin.mockReset();
  fetchPin.mockResolvedValue({ pin: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('poll scheduling', () => {
  it('polls immediately rather than waiting out the first interval', async () => {
    const stop = startTwitchPinPoller({ connectionId: CONN, login: LOGIN, onPin: vi.fn() });
    await flush();
    expect(fetchPin).toHaveBeenCalledTimes(1);
    stop();
  });

  it('passes the connection and login through unchanged', async () => {
    const stop = startTwitchPinPoller({ connectionId: CONN, login: LOGIN, onPin: vi.fn() });
    await flush();
    expect(fetchPin.mock.calls[0]?.[0]).toBe(CONN);
    expect(fetchPin.mock.calls[0]?.[1]).toBe(LOGIN);
    stop();
  });

  it('waits the interval between successful polls', async () => {
    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: 5_000,
    });
    await flush();
    expect(fetchPin).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchPin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    stop();
  });

  /* The loop is self-scheduling: the next poll is queued only once the previous
     one settles. A slow response must not let a second request pile up behind
     it, which is what a fixed setInterval would do. */
  it('never overlaps requests when a response is slow', async () => {
    let release!: (value: { pin: null }) => void;
    fetchPin.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: 5_000,
    });
    await flush();
    expect(fetchPin).toHaveBeenCalledTimes(1);

    // Far longer than the interval, with the first request still open.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchPin).toHaveBeenCalledTimes(1);

    release({ pin: null });
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    stop();
  });

  it('floors a too-fast interval instead of hammering the API', async () => {
    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: 100,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchPin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    stop();
  });

  /* NaN would coerce to 0 inside setTimeout and busy-loop. */
  it.each([NaN, Infinity, -Infinity])('falls back to the default for %s', async (bad) => {
    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: bad,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fetchPin).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('reporting pins', () => {
  it('reports a pin and a later unpin', async () => {
    const onPin = vi.fn();
    fetchPin
      .mockResolvedValueOnce({ pin: pin('m1') })
      .mockResolvedValueOnce({ pin: null });

    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin, intervalMs: 5_000,
    });
    await flush();
    expect(onPin).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: 'm1' }));

    await vi.advanceTimersByTimeAsync(5_000);
    /* null is how a consumer learns to clear a pin it already shows. Skipping it
       would leave a stale pin on screen after an unpin. */
    expect(onPin).toHaveBeenLastCalledWith(null);
    stop();
  });

  /* A fault in consumer code must not be mistaken for a transport failure or
     break the schedule. */
  it('keeps polling when the consumer throws', async () => {
    const onError = vi.fn();
    const onPin = vi.fn(() => { throw new Error('consumer bug'); });

    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin, onError, intervalMs: 5_000,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(onPin).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    stop();
  });
});

describe('error policy', () => {
  it.each(['invalid-request', 'channel-not-found'] as const)(
    'stops permanently on %s',
    async (code) => {
      const onError = vi.fn();
      fetchPin.mockRejectedValue(new TwitchPinApiError('nope', 400, code));

      const stop = startTwitchPinPoller({
        connectionId: CONN, login: LOGIN, onPin: vi.fn(), onError, intervalMs: 5_000,
      });
      await flush();

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code }), true);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchPin).toHaveBeenCalledTimes(1);
      stop();
    },
  );

  it('retries a lookup-failed with growing backoff', async () => {
    const onError = vi.fn();
    fetchPin.mockRejectedValue(new TwitchPinApiError('down', 502, 'lookup-failed'));

    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), onError, intervalMs: 5_000,
    });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.anything(), false);
    expect(fetchPin).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);   // first retry
    expect(fetchPin).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);   // doubled
    expect(fetchPin).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8_000);   // doubled again
    expect(fetchPin).toHaveBeenCalledTimes(4);
    stop();
  });

  it('caps backoff rather than growing without bound', async () => {
    fetchPin.mockRejectedValue(new TwitchPinApiError('down', 502, 'lookup-failed'));
    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: 5_000,
    });
    await flush();

    // Climb well past the ceiling: 2+4+8+16+32+60... reaches the cap quickly.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const settled = fetchPin.mock.calls.length;

    /* Asserted as a rate rather than an exact boundary. Once at the cap the
       ladder's phase relative to the clock is arbitrary, so "no call in the next
       59s" can be off by one depending on where the last retry landed. What
       matters is the ceiling holding: ten minutes at a 60s cap is ~10 polls, so
       anything at or under 11 proves it is not still doubling downward. */
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const added = fetchPin.mock.calls.length - settled;
    expect(added).toBeGreaterThanOrEqual(9);
    expect(added).toBeLessThanOrEqual(11);
    stop();
  });

  it('returns to the normal interval after a recovery', async () => {
    fetchPin
      .mockRejectedValueOnce(new TwitchPinApiError('down', 502, 'lookup-failed'))
      .mockResolvedValue({ pin: null });

    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: 5_000,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);   // backoff retry succeeds
    expect(fetchPin).toHaveBeenCalledTimes(2);

    /* Back to the interval, not still on the backoff ladder. */
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPin).toHaveBeenCalledTimes(3);
    stop();
  });

  it('treats an unrecognized throw as transient', async () => {
    const onError = vi.fn();
    fetchPin.mockRejectedValue(new Error('boom'));

    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), onError, intervalMs: 5_000,
    });
    await flush();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'lookup-failed' }),
      false,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    stop();
  });

  it('survives a consumer that throws from onError', async () => {
    fetchPin.mockRejectedValue(new TwitchPinApiError('down', 502, 'lookup-failed'));
    const stop = startTwitchPinPoller({
      connectionId: CONN,
      login: LOGIN,
      onPin: vi.fn(),
      onError: () => { throw new Error('consumer bug'); },
      intervalMs: 5_000,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchPin).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('stop()', () => {
  it('issues no further polls', async () => {
    const stop = startTwitchPinPoller({
      connectionId: CONN, login: LOGIN, onPin: vi.fn(), intervalMs: 5_000,
    });
    await flush();
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchPin).toHaveBeenCalledTimes(1);
  });

  it('aborts the request in flight', async () => {
    let signal: AbortSignal | undefined;
    fetchPin.mockImplementation((_c: string, _l: string, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });

    const stop = startTwitchPinPoller({ connectionId: CONN, login: LOGIN, onPin: vi.fn() });
    await flush();
    expect(signal?.aborted).toBe(false);
    stop();
    expect(signal?.aborted).toBe(true);
  });

  /* The abort stop() itself caused must not be reported as a failure — that
     would surface an error banner on ordinary teardown. */
  it('reports nothing for its own abort', async () => {
    const onError = vi.fn();
    const onPin = vi.fn();
    let reject!: (err: unknown) => void;
    fetchPin.mockImplementation(() => new Promise((_r, rej) => { reject = rej; }));

    const stop = startTwitchPinPoller({ connectionId: CONN, login: LOGIN, onPin, onError });
    await flush();
    stop();

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    reject(abort);
    await flush();

    expect(onError).not.toHaveBeenCalled();
    expect(onPin).not.toHaveBeenCalled();
  });

  it('does not report a pin that arrives after stopping', async () => {
    const onPin = vi.fn();
    let release!: (value: { pin: TwitchPinApiMessage | null }) => void;
    fetchPin.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const stop = startTwitchPinPoller({ connectionId: CONN, login: LOGIN, onPin });
    await flush();
    stop();
    release({ pin: pin('m1') });
    await flush();

    expect(onPin).not.toHaveBeenCalled();
  });

  it('is idempotent', async () => {
    const stop = startTwitchPinPoller({ connectionId: CONN, login: LOGIN, onPin: vi.fn() });
    await flush();
    expect(() => { stop(); stop(); stop(); }).not.toThrow();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchPin).toHaveBeenCalledTimes(1);
  });
});
