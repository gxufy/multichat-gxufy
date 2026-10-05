export interface SmoothScrollElement {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  classList?: {
    add(token: string): void;
    remove(token: string): void;
  };
}

interface SmoothScrollFollowerOptions {
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  /** Lower values follow a fast-moving chat more tightly. */
  timeConstantMs?: number;
  /** Cap long frames so one stall never becomes a giant visual jump. */
  maxDeltaMs?: number;
  settlePx?: number;
}

/**
 * Follow the bottom of a growing chat with one continuous rAF animation.
 *
 * Native `behavior: smooth` restarts its easing curve every time the DOM grows.
 * During a chat burst that produces visibly uneven velocity, and switching to
 * `auto` to catch up turns those uneven frames into hard snaps. This follower
 * instead keeps one animation alive while the target moves. New messages only
 * move the target; they never restart the easing curve.
 *
 * There is no idle loop. Once the current position reaches the newest message,
 * the rAF chain stops completely and is woken by the next DOM mutation.
 */
export function createSmoothScrollFollower(
  element: SmoothScrollElement,
  options: SmoothScrollFollowerOptions = {},
) {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const timeConstantMs = Math.max(1, options.timeConstantMs ?? 68);
  const maxDeltaMs = Math.max(16.667, options.maxDeltaMs ?? 34);
  const settlePx = Math.max(0.01, options.settlePx ?? 0.35);

  let frameHandle: number | null = null;
  let lastFrameAt: number | null = null;
  let stopped = false;

  const maxScrollTop = () => Math.max(0, element.scrollHeight - element.clientHeight);

  const setActive = (active: boolean) => {
    if (!element.classList) return;
    if (active) element.classList.add('gx-scroll-active');
    else element.classList.remove('gx-scroll-active');
  };

  const frame: FrameRequestCallback = (now) => {
    frameHandle = null;
    if (stopped) return;

    const target = maxScrollTop();
    const current = element.scrollTop;
    const remaining = target - current;

    if (Math.abs(remaining) <= settlePx) {
      element.scrollTop = target;
      lastFrameAt = null;
      setActive(false);
      return;
    }

    const deltaMs = lastFrameAt === null
      ? 16.667
      : Math.min(maxDeltaMs, Math.max(1, now - lastFrameAt));
    lastFrameAt = now;

    // Frame-rate-independent exponential approach. At 60 Hz the target moves in
    // small consistent increments; at 30/120 Hz the perceived speed is the same.
    const alpha = 1 - Math.exp(-deltaMs / timeConstantMs);
    element.scrollTop = current + remaining * alpha;
    frameHandle = requestFrame(frame);
  };

  const wake = () => {
    if (stopped || frameHandle !== null) return;
    setActive(true);
    frameHandle = requestFrame(frame);
  };

  const stop = () => {
    stopped = true;
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    lastFrameAt = null;
    setActive(false);
  };

  return { wake, stop };
}
