import { recordRuntimeAnimationBatch } from './multichatAnimationRuntime';

/** Presentation cadence used by the overlay ingress queue. */
export const BURST_PRESENT_INTERVAL_MS = 200;

/**
 * Drain every message accumulated for the current presentation bucket.
 *
 * This is also the authoritative traffic-pressure sample for runtime animation
 * auto mode. Empty clock ticks deliberately leave the most recent real batch's
 * immutable animation decision alone while React is committing it.
 */
export function drainBurstPresentationQueue<T>(pending: T[]): T[] {
  const batch = pending.splice(0);
  if (batch.length) recordRuntimeAnimationBatch(batch.length);
  return batch;
}

/**
 * Start one phase-locked presentation clock for the overlay lifetime.
 * The interval does not restart per message, so latency stays phase-relative and
 * every row waiting at a tick is committed as one ordered batch.
 */
export function startBurstPresentationTicker(
  flush: () => void,
  intervalMs = BURST_PRESENT_INTERVAL_MS,
): () => void {
  const timer = setInterval(flush, intervalMs);
  return () => clearInterval(timer);
}
