import {
  recordPerformanceBatch,
  resetPerformanceRuntimeForTests,
  runtimeVisualEffectsReduced,
} from './multichatPerformanceRuntime';

export type MultichatRuntimeAnimationMode = 'on' | 'off' | 'auto';

/** Four rows in one 200 ms presentation tick is the entrance-bypass threshold. */
export const AUTO_ANIMATION_BYPASS_BATCH_SIZE = 4;

/**
 * Protection window used after a heavy chat burst or actual browser frame
 * pressure.
 *
 * Smaller batches that arrive during this window remain static for that batch,
 * but they do not restart the timer. Only another heavy batch or another
 * frame-pressure signal extends the protection window.
 */
export const AUTO_ANIMATION_BYPASS_HOLD_MS = 400;

/* Auto is the production default: normal traffic keeps the configured entrance
 * effect, while provider bursts and actual slow browser frames shed only that
 * expensive visual work. `animation on` remains an explicit force-on override
 * for streamers who want the old always-animate behavior. */
let runtimeMode: MultichatRuntimeAnimationMode = 'auto';
let autoBypassUntil = 0;
let lastBatchAnimationEnabled = true;

export function setRuntimeAnimationMode(mode: MultichatRuntimeAnimationMode): void {
  runtimeMode = mode;
  if (mode !== 'auto') autoBypassUntil = 0;
  if (mode === 'on') lastBatchAnimationEnabled = true;
  if (mode === 'off') lastBatchAnimationEnabled = false;
}

export function getRuntimeAnimationMode(): MultichatRuntimeAnimationMode {
  return runtimeMode;
}

/**
 * Record one actual non-empty presentation batch and return whether its entrance
 * should be animated. The result is retained verbatim for ChatOverlay to stamp on
 * the matching immutable render batch. That matters under load: React can render
 * late, but a batch that was classified as a burst never becomes animated merely
 * because the hold timer elapsed before its effect ran.
 */
export function recordRuntimeAnimationBatch(
  batchSize: number,
  now = Date.now(),
): boolean {
  const normalizedBatchSize = Math.max(0, Math.trunc(batchSize));
  let animate: boolean;

  if (runtimeMode === 'off') {
    animate = false;
  } else if (runtimeMode === 'on') {
    animate = true;
  } else if (normalizedBatchSize >= AUTO_ANIMATION_BYPASS_BATCH_SIZE) {
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
 * `recordRuntimeAnimationBatch` runs before React receives that batch.
 */
export function runtimeEntranceAnimationEnabled(): boolean {
  if (runtimeMode === 'off') return false;
  if (runtimeMode === 'on') return true;
  return lastBatchAnimationEnabled;
}

/** Test-only reset helper; a browser-source reload naturally resets the module. */
export function resetRuntimeAnimationState(): void {
  runtimeMode = 'auto';
  autoBypassUntil = 0;
  lastBatchAnimationEnabled = true;
  resetPerformanceRuntimeForTests();
}
