import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_FADE_TRANSITION_MS,
  createMessageFadeScheduler,
} from '@/lib/messageFadeScheduler';

type Message = { id: string; timestamp?: number };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  const messages: Message[] = [];
  const fading: string[][] = [];
  const removed: string[] = [];
  const scheduler = createMessageFadeScheduler({
    getMessages: () => messages,
    fadeMs: 1_000,
    onFadingChange: (ids) => fading.push([...ids]),
    onRemove: (id) => {
      removed.push(id);
      const index = messages.findIndex((message) => message.id === id);
      if (index !== -1) messages.splice(index, 1);
    },
  });
  return { messages, fading, removed, scheduler };
}

describe('message fade scheduler', () => {
  it('keeps no repeating timer alive while chat is idle', () => {
    const { scheduler } = harness();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);

    scheduler.stop();
  });

  it('starts fading on the same 200ms cadence and removes after the eased exit', () => {
    const { messages, fading, removed, scheduler } = harness();
    messages.push({ id: 'a', timestamp: 0 });
    scheduler.wake();

    vi.advanceTimersByTime(999);
    expect(fading).toEqual([]);
    expect(removed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(fading).toEqual([['a']]);
    expect(removed).toEqual([]);

    vi.advanceTimersByTime(MESSAGE_FADE_TRANSITION_MS - 1);
    expect(removed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(removed).toEqual(['a']);
    expect(fading.at(-1)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    scheduler.stop();
  });

  it('still begins at most one already-expired row per 200ms tick', () => {
    const { messages, fading, removed, scheduler } = harness();
    messages.push({ id: 'a', timestamp: 0 }, { id: 'b', timestamp: 0 });
    scheduler.wake();

    vi.advanceTimersByTime(1_000);
    expect(fading.at(-1)).toEqual(['a']);

    vi.advanceTimersByTime(199);
    expect(fading.at(-1)).toEqual(['a']);

    vi.advanceTimersByTime(1);
    expect(fading.at(-1)).toEqual(['a', 'b']);

    vi.advanceTimersByTime(MESSAGE_FADE_TRANSITION_MS - 200);
    expect(removed).toEqual(['a']);
    expect(fading.at(-1)).toEqual(['b']);

    vi.advanceTimersByTime(200);
    expect(removed).toEqual(['a', 'b']);
    expect(fading.at(-1)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    scheduler.stop();
  });

  it('cancels both deadline and in-flight removal timers on stop', () => {
    const { messages, fading, removed, scheduler } = harness();
    messages.push({ id: 'a', timestamp: 0 }, { id: 'b', timestamp: 0 });
    scheduler.wake();

    vi.advanceTimersByTime(1_000);
    expect(fading.at(-1)).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(2);

    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(removed).toEqual([]);
  });
});
