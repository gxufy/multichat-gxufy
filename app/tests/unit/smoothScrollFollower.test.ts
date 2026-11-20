import { describe, expect, it } from 'vitest';
import { createSmoothScrollFollower } from '@/lib/smoothScrollFollower';

function makeRafHarness() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];

  const requestFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  const cancelFrame = (id: number) => {
    cancelled.push(id);
    callbacks.delete(id);
  };
  const step = (timestamp: number) => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error('no animation frame queued');
    callbacks.delete(entry[0]);
    entry[1](timestamp);
  };

  return { callbacks, cancelled, requestFrame, cancelFrame, step };
}

function makeElement() {
  const classes = new Set<string>();
  return {
    element: {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 200,
      classList: {
        add: (token: string) => classes.add(token),
        remove: (token: string) => classes.delete(token),
      },
    },
    classes,
  };
}

describe('smoothScrollFollower', () => {
  it('moves toward the newest message in frame-paced increments and goes idle at rest', () => {
    const raf = makeRafHarness();
    const { element, classes } = makeElement();
    const follower = createSmoothScrollFollower(element, {
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });

    follower.wake();
    expect(raf.callbacks.size).toBe(1);
    expect(classes.has('gx-scroll-active')).toBe(true);

    let previous = element.scrollTop;
    let frame = 0;
    while (raf.callbacks.size && frame < 180) {
      frame += 1;
      raf.step(frame * 16.667);
      expect(element.scrollTop).toBeGreaterThanOrEqual(previous);
      previous = element.scrollTop;
    }

    expect(frame).toBeGreaterThan(2);
    expect(element.scrollTop).toBeCloseTo(800, 5);
    expect(raf.callbacks.size).toBe(0);
    expect(classes.has('gx-scroll-active')).toBe(false);
  });

  it('keeps one continuous motion when the target grows during a chat burst', () => {
    const raf = makeRafHarness();
    const { element } = makeElement();
    const follower = createSmoothScrollFollower(element, {
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
      timeConstantMs: 68,
    });

    follower.wake();
    for (let frame = 1; frame <= 5; frame++) raf.step(frame * 16.667);
    const beforeBurst = element.scrollTop;

    // Several new lines land while the same animation is already active.
    element.scrollHeight = 1800;
    follower.wake();
    expect(raf.callbacks.size).toBe(1);
    raf.step(6 * 16.667);

    expect(element.scrollTop).toBeGreaterThan(beforeBurst);
    expect(element.scrollTop).toBeLessThan(1600);

    let previous = element.scrollTop;
    let frame = 6;
    while (raf.callbacks.size && frame < 240) {
      frame += 1;
      raf.step(frame * 16.667);
      expect(element.scrollTop).toBeGreaterThanOrEqual(previous);
      previous = element.scrollTop;
    }
    expect(element.scrollTop).toBeCloseTo(1600, 5);
  });

  it('cancels the active frame and compositor hint on teardown', () => {
    const raf = makeRafHarness();
    const { element, classes } = makeElement();
    const follower = createSmoothScrollFollower(element, {
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });

    follower.wake();
    expect(classes.has('gx-scroll-active')).toBe(true);
    follower.stop();

    expect(raf.cancelled).toHaveLength(1);
    expect(raf.callbacks.size).toBe(0);
    expect(classes.has('gx-scroll-active')).toBe(false);
  });
});
