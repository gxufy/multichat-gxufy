/*
 * The counter's polling engine on its own (lib/counterPolling.ts), as the
 * /counter page uses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTER_POLL_INTERVAL_MS,
  COUNTER_REQUEST_TIMEOUT_MS,
  COUNTER_STALE_WINDOW_MS,
  startCounterPolling,
} from '../../src/lib/counterPolling';
import type { PlatformCountStatus, ViewerPlatform } from '../../src/lib/viewerCounterConfig';

type Answer = Response | 'hang' | 'fail';
let answers: Record<string, Answer[]>;
let requested: string[];

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function answerFor(url: string): Answer {
  const key = url.startsWith('https://kick.com/') ? 'kick' : new URL(url, 'http://x').searchParams.keys().next().value!;
  const queue = answers[key] ?? [];
  return queue.length > 1 ? queue.shift()! : queue[0] ?? 'fail';
}

beforeEach(() => {
  vi.useFakeTimers();
  answers = {};
  requested = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    requested.push(url);
    const answer = answerFor(url);
    if (answer === 'fail') return Promise.reject(new TypeError('network'));
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      if (answer !== 'hang') resolve(answer.clone());
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function run(channels: Partial<Record<ViewerPlatform, string>>, endpoint: '/api/viewers' | '/api/audience' = '/api/viewers') {
  const seen: Array<[ViewerPlatform, PlatformCountStatus, boolean]> = [];
  let settled = 0;
  const stop = startCounterPolling({
    channels,
    serverEndpoint: endpoint,
    onStatus: (platform, status, usable) => seen.push([platform, status, usable]),
    onCycleSettled: () => { settled += 1; },
  });
  return { seen, stop, settled: () => settled };
}

describe('startCounterPolling', () => {
  it('asks each configured platform once, through the chosen endpoint, and Kick from the browser', async () => {
    answers.twitch = [json({ twitch: { live: true, viewers: 5 } })];
    answers.kick = [json({ livestream: { viewer_count: 9 } })];
    const { seen, settled, stop } = run({ twitch: 'a', kick: 'b' }, '/api/audience');
    await vi.advanceTimersByTimeAsync(0);
    expect(requested).toEqual(['/api/audience?twitch=a', 'https://kick.com/api/v2/channels/b']);
    expect(seen).toEqual([
      ['twitch', { state: 'live', viewers: 5 }, true],
      ['kick', { state: 'live', viewers: 9 }, true],
    ]);
    expect(settled()).toBe(1);
    stop();
  });

  it('commits a fast platform without waiting for a slow one, and times the slow one out', async () => {
    answers.twitch = [json({ twitch: { live: true, viewers: 5 } })];
    answers.tiktok = ['hang'];
    const { seen, settled, stop } = run({ twitch: 'a', tiktok: 'c' });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([['twitch', { state: 'live', viewers: 5 }, true]]);
    expect(settled()).toBe(0);
    await vi.advanceTimersByTimeAsync(COUNTER_REQUEST_TIMEOUT_MS);
    expect(seen.at(-1)).toEqual(['tiktok', { state: 'unavailable' }, false]);
    expect(settled()).toBe(1);
    stop();
  });

  it('polls again one interval after a cycle settles, never overlapping', async () => {
    answers.twitch = [json({ twitch: { live: true, viewers: 5 } })];
    const { stop } = run({ twitch: 'a' });
    await vi.advanceTimersByTimeAsync(0);
    expect(requested).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS - 1);
    expect(requested).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requested).toHaveLength(2);
    stop();
  });

  it('keeps the last good value through failures, then gives it up after the stale window', async () => {
    answers.twitch = [json({ twitch: { live: true, viewers: 5 } }), 'fail'];
    const { seen, stop } = run({ twitch: 'a' });
    await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS);
    expect(seen.at(-1)).toEqual(['twitch', { state: 'live', viewers: 5 }, true]);
    await vi.advanceTimersByTimeAsync(COUNTER_STALE_WINDOW_MS);
    expect(seen.at(-1)).toEqual(['twitch', { state: 'unavailable' }, false]);
    stop();
  });

  it('backs off a platform that answered 429 with Retry-After, without asking it', async () => {
    answers.youtube = [new Response('', { status: 429, headers: { 'retry-after': '30' } }), json({ youtube: { live: false } })];
    const { seen, stop } = run({ youtube: 'y' });
    await vi.advanceTimersByTimeAsync(0);
    expect(requested).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS * 2);
    expect(requested).toHaveLength(1);
    expect(seen.every(([, status]) => status.state === 'unavailable')).toBe(true);
    /* 30 s after the refusal: asked again. */
    await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS);
    expect(requested).toHaveLength(2);
    expect(seen.at(-1)).toEqual(['youtube', { state: 'offline' }, true]);
    stop();
  });

  it('reads Kick with no livestream as offline and a live one with no count as unknown', async () => {
    answers.kick = [json({ livestream: null }), json({ livestream: { viewer_count: 'x' } })];
    const { seen, stop } = run({ kick: 'k' });
    await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS);
    expect(seen.map(([, status]) => status.state)).toEqual(['offline', 'live-unknown']);
    stop();
  });

  it('stops: aborts what is in flight, reports nothing more, leaves no timer', async () => {
    answers.twitch = ['hang'];
    const { seen, settled, stop } = run({ twitch: 'a' });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(COUNTER_REQUEST_TIMEOUT_MS + COUNTER_POLL_INTERVAL_MS * 3);
    expect(seen).toEqual([]);
    expect(settled()).toBe(0);
    expect(requested).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
