/** Pin lifecycle state machine.
 *
 * Drives a 5-second lifecycle for pinned messages:
 *   0 ms    → 'entering'   (250 ms entrance animation)
 *   250 ms → 'visible'    (stays for 4 250 ms)
 *   4 500 ms → 'exiting'  (500 ms exit animation)
 *   5 000 ms → 'gone'     (fully removed)
 *
 * New pins while another is active replace it (latest-wins).
 * Duplicate suppression keyed by platform:messageId.
 */

import type { ParsedMessage } from './kick';
import type { Platform } from './types';

/* ── Public types ──────────────────────────────────────────────────────── */

/** Lifecycle phase fed to the UI for animation. */
export type PinPhase = 'entering' | 'visible' | 'exiting';

export interface PinEntry {
  /** Unique per-platform identifier. */
  id: string;
  /** The rendered message to display. */
  msg: ParsedMessage;
  /** Who pinned it (if available). */
  pinnedBy?: string;
  /** Current lifecycle phase. */
  phase: PinPhase;
  /** Wall-clock time when the pin was set (ms since epoch). */
  timestamp: number;
  /** Which platform this pin came from. */
  platform: Platform;
}

/** Opaque pin controller state — passed through processPinEvent / tick. */
export interface PinState {
  /** Current active pin (null = nothing pinned). */
  entry: PinEntry | null;
  /** Set of seen pin keys to suppress duplicates: `platform:id`. */
  seenKeys: Set<string>;
}

/** Initial (empty) pin state. */
export const INITIAL_PIN_STATE: PinState = {
  entry: null,
  seenKeys: new Set(),
};

/* ── Phase timing constants (ms) ──────────────────────────────────────── */

const ENTERING_DURATION = 250;
const VISIBLE_DURATION  = 4_250;
const EXITING_DURATION  = 500;
const TOTAL_DURATION    = ENTERING_DURATION + VISIBLE_DURATION + EXITING_DURATION; // 5000

/* ── Public API ─────────────────────────────────────────────────────────── */

/** Process a pin event (pin / update / unpin).
 *
 * @param state  Current pin state (from previous call or INITIAL_PIN_STATE).
 * @param event  'pin' to set/update, 'unpin' to clear immediately.
 * @param payload Pin data (null for unpin).
 * @returns New PinState with updated entry and/or phase. */
export function processPinEvent(
  state: PinState,
  event: 'pin' | 'unpin',
  payload: { msg: ParsedMessage; pinnedBy?: string; platform: Platform; pinId?: string } | null,
): PinState {
  if (event === 'unpin' || !payload) {
    // Clear immediately — no graceful exit on unpin
    return { entry: null, seenKeys: new Set() };
  }

  // Build dedup key: platform + unique message identifier
  const pinId = payload.pinId ?? `${payload.msg.id}`;
  const key = `${payload.platform}:${pinId}`;

  if (state.seenKeys.has(key)) {
    // Duplicate — return unchanged
    return state;
  }

  const now = Date.now();
  const newKey = new Set(state.seenKeys);
  newKey.add(key);

  return {
    entry: {
      id: pinId,
      msg: payload.msg,
      pinnedBy: payload.pinnedBy,
      phase: 'entering',
      timestamp: now,
      platform: payload.platform,
    },
    seenKeys: newKey,
  };
}

/** Advance pin state by one tick (call every 100 ms from a timer).
 *
 * Returns null when the pin has fully exited (gone). */
export function tick(state: PinState | null, now: number): PinState | null {
  if (!state?.entry) return null;

  const { entry } = state;
  const elapsed = now - entry.timestamp;

  let newPhase: PinPhase = entry.phase;

  if (entry.phase === 'entering' && elapsed >= ENTERING_DURATION) {
    newPhase = 'visible';
  } else if (entry.phase === 'visible' && elapsed >= ENTERING_DURATION + VISIBLE_DURATION) {
    newPhase = 'exiting';
  } else if (entry.phase === 'exiting' && elapsed >= TOTAL_DURATION) {
    // Fully gone
    return null;
  }

  if (newPhase !== entry.phase) {
    return {
      ...state,
      entry: { ...entry, phase: newPhase },
    };
  }

  // No phase change — return unchanged reference
  return state;
}

/** Reset pin state for a channel change / unmount.
 *
 * Clears all seen keys so rejoining the same channel allows fresh pins. */
export function resetState(state: PinState): PinState {
  return { entry: null, seenKeys: new Set() };
}
