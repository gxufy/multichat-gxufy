import { recordRuntimeAnimationBatch } from './multichatAnimationRuntime';

/** Presentation cadence used by the overlay ingress queue. */
export const BURST_PRESENT_INTERVAL_MS = 150;

/**
 * Drain every message accumulated for the current presentation bucket.
 *
 * This is also the authoritative traffic-pressure sample for runtime animation
 * auto mode. Empty clock ticks deliberately leave the most recent real batch's
 * immutable animation decision alone while the overlay is drawing it.
 */
export function drainBurstPresentationQueue<T>(pending: T[]): T[] {
  const batch = pending.splice(0);
  if (batch.length) recordRuntimeAnimationBatch(batch.length);
  return batch;
}

/**
 * Longest a message may wait for its sender's 7TV paint and badge before it is
 * shown anyway. Most lookups answer well inside this.
 */
export const COSMETICS_HOLD_MAX_MS = 500;

/**
 * How long every new message waits before it is shown, so a removal that comes
 * right after it never reaches the screen. Moderation bots (link protection,
 * banned words, spam filters) act almost at once: on 18 busy Twitch channels
 * (2026-11-17, ~7,900 messages) every quick removal landed within 0.37 s of
 * its message, and the rest were human mods 3-41 s later, which no short wait
 * can catch. So half a second catches the bots while chat keeps moving; the
 * slower removals still close smoothly on screen. Applies only when
 * moderation actions are on (the overlay default).
 */
export const MOD_REMOVAL_HOLD_MS = 500;

/**
 * Take the messages that are ready to show this tick, in order.
 *
 * Every message is held until it is `removalHoldMs` old (MOD_REMOVAL_HOLD_MS on
 * the overlay), so a quick moderator or bot removal drops it before it is ever
 * shown. A message whose sender's 7TV cosmetics are still being looked up is
 * held (up to COSMETICS_HOLD_MAX_MS since it arrived) so it appears once,
 * complete, instead of appearing plain and repainting a moment later. Everything
 * behind a held message waits with it, so chat order never changes. Returns a
 * new array of ready messages and leaves the held ones queued.
 */
export function takeReadyPresentationPrefix<T>(
  pending: T[],
  isWaitingForCosmetics: (message: T) => boolean,
  arrivedAt: (message: T) => number | undefined,
  now: number,
  removalHoldMs = 0,
): T[] {
  let ready = pending.length;
  for (let index = 0; index < pending.length; index += 1) {
    const message = pending[index];
    const since = arrivedAt(message);
    if (removalHoldMs > 0 && since !== undefined && now - since < removalHoldMs) {
      ready = index;
      break;
    }
    if (
      isWaitingForCosmetics(message)
      && since !== undefined
      && now - since < COSMETICS_HOLD_MAX_MS
    ) {
      ready = index;
      break;
    }
  }
  return pending.splice(0, ready);
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
