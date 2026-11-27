import {
  recordPerformanceBatch,
  resetPerformanceRuntimeForTests,
  runtimeVisualEffectsReduced,
} from './multichatPerformanceRuntime';

export type MultichatRuntimeAnimationMode = 'on' | 'off' | 'auto';

/** Four rows in one 200 ms presentation tick is the entrance-bypass threshold. */
export const AUTO_ANIMATION_BYPASS_BATCH_SIZE = 4;

/**
 * Sustained pace that also counts as fast chat: this many rows within the
 * trailing window. A chat delivering a couple of rows every tick never forms a
 * single heavy batch, yet back-to-back slides at that pace read as constant
 * motion, so pace is judged over the window, not per batch. Set high enough
 * that normal and moderately busy chat keeps its slide.
 */
export const AUTO_ANIMATION_FAST_CHAT_ROWS = 8;
export const AUTO_ANIMATION_FAST_CHAT_WINDOW_MS = 1_000;

/**
 * How long chat must stay below the fast thresholds before Slide returns.
 *
 * Every batch that is still fast (heavy, or keeping the pace up) pushes the
 * deadline out, so a busy chat stays static instead of flickering between
 * sliding and static. Slower batches inside the window stay static and do not
 * extend it; frame pressure extends it too.
 */
export const AUTO_ANIMATION_BYPASS_HOLD_MS = 1_200;

/**
 * Slide's chat-speed switch, judged on the rows shown in the trailing
 * AUTO_ANIMATION_FAST_CHAT_WINDOW_MS (one second), not on a single presentation tick.
 * A single tick's count is noise: a steady ~6 msg/s chat regularly lands 4 or 5
 * rows in one tick, which used to pop one batch in instantly between slides
 * (about 45 slide/instant swaps a minute on stableronaldo). Slide turns off
 * once chat reaches SLIDE_FAST_ENTER_ROWS per second and back on only after it
 * falls to SLIDE_FAST_EXIT_ROWS, so the mode holds through ordinary bursts.
 */
export const SLIDE_FAST_ENTER_ROWS = 12;
export const SLIDE_FAST_EXIT_ROWS = 7;

/* Auto is the production default: normal traffic keeps the configured entrance
 * effect, while provider bursts and actual slow browser frames shed only that
 * expensive visual work. `animation on` remains an explicit force-on override
 * for streamers who want the old always-animate behavior. */
let runtimeMode: MultichatRuntimeAnimationMode = 'auto';
let autoBypassUntil = 0;
let lastBatchAnimationEnabled = true;
let recentBatches: Array<{ at: number; size: number }> = [];
let slideChatFast = false;

function rowsInPaceWindow(now: number, size: number): number {
  recentBatches.push({ at: now, size });
  const since = now - AUTO_ANIMATION_FAST_CHAT_WINDOW_MS;
  while (recentBatches.length && recentBatches[0].at <= since) recentBatches.shift();
  return recentBatches.reduce((sum, batch) => sum + batch.size, 0);
}

export function setRuntimeAnimationMode(mode: MultichatRuntimeAnimationMode): void {
  runtimeMode = mode;
  if (mode !== 'auto') {
    autoBypassUntil = 0;
    recentBatches = [];
    slideChatFast = false;
  }
  if (mode === 'on') lastBatchAnimationEnabled = true;
  if (mode === 'off') lastBatchAnimationEnabled = false;
}

export function getRuntimeAnimationMode(): MultichatRuntimeAnimationMode {
  return runtimeMode;
}

/**
 * Record one actual non-empty presentation batch and return whether its entrance
 * should be animated. The result is retained verbatim for ChatOverlay to stamp on
 * the matching immutable render batch. That matters under load: the overlay can draw
 * late, but a batch that was classified as a burst never becomes animated merely
 * because the hold timer elapsed before its effect ran.
 */
export function recordRuntimeAnimationBatch(
  batchSize: number,
  now = Date.now(),
): boolean {
  const normalizedBatchSize = Math.max(0, Math.trunc(batchSize));
  /* Every real batch counts toward the pace, including heavy ones. */
  const paceRows = runtimeMode === 'auto'
    ? rowsInPaceWindow(now, normalizedBatchSize)
    : 0;
  if (runtimeMode === 'auto') {
    if (!slideChatFast && paceRows >= SLIDE_FAST_ENTER_ROWS) slideChatFast = true;
    else if (slideChatFast && paceRows <= SLIDE_FAST_EXIT_ROWS) slideChatFast = false;
  }
  let animate: boolean;

  if (runtimeMode === 'off') {
    animate = false;
  } else if (runtimeMode === 'on') {
    animate = true;
  } else if (
    normalizedBatchSize >= AUTO_ANIMATION_BYPASS_BATCH_SIZE
    || paceRows >= AUTO_ANIMATION_FAST_CHAT_ROWS
  ) {
    autoBypassUntil = Math.max(
      autoBypassUntil,
      now + AUTO_ANIMATION_BYPASS_HOLD_MS,
    );
    animate = false;
  } else if (runtimeVisualEffectsReduced()) {
    /*
     * Actual Chromium/OBS frame pressure is a stronger signal than message
     * count. Keep content current and extend the protection window until frames
     * have had time to recover.
     */
    autoBypassUntil = Math.max(
      autoBypassUntil,
      now + AUTO_ANIMATION_BYPASS_HOLD_MS,
    );
    animate = false;
  } else if (now < autoBypassUntil) {
    /*
     * A smaller batch arrived while burst protection is still active.
     *
     * Keep this batch static, but do not restart the timer. This lets Motion
     * naturally return after the original heavy burst has passed instead of
     * staying suppressed indefinitely on a moderately active stream.
     */
    animate = false;
  } else {
    animate = true;
  }

  lastBatchAnimationEnabled = animate;
  recordPerformanceBatch(normalizedBatchSize, runtimeMode, animate);
  return animate;
}

/**
 * Read the immutable decision for the most recently presented non-empty batch.
 * `recordRuntimeAnimationBatch` runs before the overlay receives that batch.
 */
export function runtimeEntranceAnimationEnabled(): boolean {
  if (runtimeMode === 'off') return false;
  if (runtimeMode === 'on') return true;
  return lastBatchAnimationEnabled;
}

/** Whether chat is currently too fast for Slide (auto mode only), as of the
 * most recently recorded batch. */
export function runtimeSlideChatFast(): boolean {
  return runtimeMode === 'auto' && slideChatFast;
}

/** Test-only reset helper; a browser-source reload naturally resets the module. */
export function resetRuntimeAnimationState(): void {
  runtimeMode = 'auto';
  autoBypassUntil = 0;
  lastBatchAnimationEnabled = true;
  recentBatches = [];
  slideChatFast = false;
  resetPerformanceRuntimeForTests();
}
