import { runtimeVisualEffectsReduced } from './multichatPerformanceRuntime';

export interface FadeScheduledMessage {
  id: string;
  timestamp?: number;
}

export interface MessageFadeScheduler {
  /** Call after a message is appended so an idle scheduler can arm itself. */
  wake(): void;
  /** Cancel every pending check/removal callback permanently. */
  stop(): void;
}

interface SchedulerOptions<T extends FadeScheduledMessage> {
  getMessages(): readonly T[];
  fadeMs: number;
  onFadingChange(ids: Set<string>): void;
  onRemove(id: string): void;
  now?: () => number;
  tickMs?: number;
  transitionMs?: number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** The renderer's eased fade/collapse duration. Keep removal in sync with CSS. */
export const MESSAGE_FADE_TRANSITION_MS = 700;

/**
 * Preserve the 200 ms expiry cadence without waking five times per second for the
 * entire stream.
 *
 * Each cadence tick starts at most one expired row. The row then gets the full
   * eased exit window before it is removed, so opacity and layout can
 * settle together instead of disappearing first and snapping the gap closed.
 *
 * Under measured browser pressure the content is removed on that same cadence
 * without starting the grid/opacity/transform transition. This is load shedding,
 * not message dropping: only an already-expired visual effect is skipped, and the
 * normal 700 ms exit automatically returns once Chromium recovers.
 */
export function createMessageFadeScheduler<T extends FadeScheduledMessage>(
  options: SchedulerOptions<T>,
): MessageFadeScheduler {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? 200;
  const transitionMs = options.transitionMs ?? MESSAGE_FADE_TRANSITION_MS;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const epoch = now();
  const fading = new Set<string>();
  const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function tickAtOrAfter(deadline: number, current: number): number {
    if (deadline <= current) {
      const elapsed = Math.max(0, current - epoch);
      return epoch + (Math.floor(elapsed / tickMs) + 1) * tickMs;
    }
    const ticks = Math.max(1, Math.ceil((deadline - epoch) / tickMs));
    return epoch + ticks * tickMs;
  }

  function nextDeadline(): number | null {
    let deadline = Number.POSITIVE_INFINITY;
    for (const message of options.getMessages()) {
      if (fading.has(message.id)) continue;
      deadline = Math.min(deadline, (message.timestamp ?? 0) + options.fadeMs);
    }
    return Number.isFinite(deadline) ? deadline : null;
  }

  function scheduleNext(): void {
    if (stopped || checkTimer !== null) return;
    const deadline = nextDeadline();
    if (deadline === null) return;
    const current = now();
    const dueAt = tickAtOrAfter(deadline, current);
    checkTimer = setTimer(runCheck, Math.max(0, dueAt - current));
  }

  function runCheck(): void {
    checkTimer = null;
    if (stopped) return;

    const cutoff = now() - options.fadeMs;
    const expired = options.getMessages().find(
      (message) => (message.timestamp ?? 0) <= cutoff && !fading.has(message.id),
    );

    if (expired) {
      const id = expired.id;
      if (runtimeVisualEffectsReduced()) {
        options.onRemove(id);
        options.onFadingChange(new Set(fading));
      } else {
        fading.add(id);
        options.onFadingChange(new Set(fading));
        const removalTimer = setTimer(() => {
          removalTimers.delete(id);
          if (stopped) return;
          fading.delete(id);
          options.onRemove(id);
          options.onFadingChange(new Set(fading));
          scheduleNext();
        }, transitionMs);
        removalTimers.set(id, removalTimer);
      }
    }

    // If several rows are already expired this resolves to the *next* cadence
    // boundary, so only one begins its exit/removal per 200 ms.
    scheduleNext();
  }

  return {
    wake() {
      scheduleNext();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (checkTimer !== null) clearTimer(checkTimer);
      checkTimer = null;
      for (const timer of removalTimers.values()) clearTimer(timer);
      removalTimers.clear();
      fading.clear();
    },
  };
}
