import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BURST_PRESENT_INTERVAL_MS,
  drainBurstPresentationQueue,
  startBurstPresentationTicker,
} from '@/lib/chatBurstPresentation';
import {
  AUTO_ANIMATION_BYPASS_BATCH_SIZE,
  resetRuntimeAnimationState,
  runtimeEntranceAnimationEnabled,
  setRuntimeAnimationMode,
} from '@/lib/multichatAnimationRuntime';

beforeEach(() => resetRuntimeAnimationState());
afterEach(() => {
  resetRuntimeAnimationState();
  vi.useRealTimers();
});

describe('chat burst presentation buckets', () => {
  it('uses the production 200ms presentation cadence', () => {
    expect(BURST_PRESENT_INTERVAL_MS).toBe(150);
  });

  it('runs one phase-locked clock instead of per-message delays', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const stop = startBurstPresentationTicker(flush);

    vi.advanceTimersByTime(BURST_PRESENT_INTERVAL_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BURST_PRESENT_INTERVAL_MS);
    expect(flush).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(BURST_PRESENT_INTERVAL_MS * 2);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('commits every message accumulated in one bucket in order', () => {
    const pending = Array.from({ length: 20 }, (_, index) => `message-${index}`);
    const batch = drainBurstPresentationQueue(pending);
    expect(batch).toHaveLength(20);
    expect(batch[0]).toBe('message-0');
    expect(batch[19]).toBe('message-19');
    expect(pending).toEqual([]);
  });

  it('keeps later arrivals for the next independent bucket', () => {
    const pending = ['a', 'b', 'c'];
    expect(drainBurstPresentationQueue(pending)).toEqual(['a', 'b', 'c']);
    pending.push('d', 'e');
    expect(drainBurstPresentationQueue(pending)).toEqual(['d', 'e']);
  });

  it('uses the exact drained batch as auto-mode traffic pressure', () => {
    setRuntimeAnimationMode('auto');
    const pending = Array.from(
      { length: AUTO_ANIMATION_BYPASS_BATCH_SIZE },
      (_, index) => index,
    );
    drainBurstPresentationQueue(pending);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);
  });

  it('does not let an empty tick overwrite the last real batch decision', () => {
    setRuntimeAnimationMode('auto');
    const heavy = Array.from(
      { length: AUTO_ANIMATION_BYPASS_BATCH_SIZE },
      (_, index) => index,
    );
    drainBurstPresentationQueue(heavy);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    drainBurstPresentationQueue([]);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);
  });
});

describe('7TV cosmetics hold', () => {
  it('holds a waiting message and everything behind it, in order, until ready or timed out', async () => {
    const { takeReadyPresentationPrefix, COSMETICS_HOLD_MAX_MS } = await import('@/lib/chatBurstPresentation');
    const queue = [{ id: 'a' }, { id: 'b', waiting: true }, { id: 'c' }];
    const arrived = new Map([['a', 1_000], ['b', 1_000], ['c', 1_050]]);
    const waiting = (m: { id: string; waiting?: boolean }) => Boolean(m.waiting);

    expect(takeReadyPresentationPrefix(queue, waiting, (m) => arrived.get(m.id), 1_200).map((m) => m.id)).toEqual(['a']);
    expect(queue.map((m) => m.id)).toEqual(['b', 'c']);

    expect(takeReadyPresentationPrefix(queue, waiting, (m) => arrived.get(m.id), 1_000 + COSMETICS_HOLD_MAX_MS).map((m) => m.id))
      .toEqual(['b', 'c']);
    expect(queue).toHaveLength(0);
  });

  it('releases everything at once when nothing is waiting', async () => {
    const { takeReadyPresentationPrefix } = await import('@/lib/chatBurstPresentation');
    const queue = [{ id: 'a' }, { id: 'b' }];
    expect(takeReadyPresentationPrefix(queue, () => false, () => 0, 0)).toHaveLength(2);
    expect(queue).toHaveLength(0);
  });
});

describe('removal hold', () => {
  it('holds every message until it is old enough, in arrival order', async () => {
    const { takeReadyPresentationPrefix } = await import('@/lib/chatBurstPresentation');
    const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const arrived = new Map([['a', 1_000], ['b', 1_300], ['c', 1_350]]);
    const at = (m: { id: string }) => arrived.get(m.id);

    expect(takeReadyPresentationPrefix(queue, () => false, at, 1_599, 600)).toEqual([]);
    expect(takeReadyPresentationPrefix(queue, () => false, at, 1_600, 600).map((m) => m.id)).toEqual(['a']);
    expect(takeReadyPresentationPrefix(queue, () => false, at, 1_900, 600).map((m) => m.id)).toEqual(['b']);
    expect(queue.map((m) => m.id)).toEqual(['c']);
    expect(takeReadyPresentationPrefix(queue, () => false, at, 1_950, 600).map((m) => m.id)).toEqual(['c']);
  });

  it('is off at 0, so messages are not held', async () => {
    const { takeReadyPresentationPrefix } = await import('@/lib/chatBurstPresentation');
    const queue = [{ id: 'a' }];
    expect(takeReadyPresentationPrefix(queue, () => false, () => 1_000, 1_000, 0)).toHaveLength(1);
  });
});
