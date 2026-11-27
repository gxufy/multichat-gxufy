/* Planned handover between the two server copies during a deploy.
 *
 * The deploy creates the file named by FLOSSCHAT_DRAIN_FILE for the copy that
 * is about to stop. From then on that copy:
 *   1. reports unhealthy on /api/runtime/health, so Caddy stops sending it new
 *      visitors (its health check runs every second), and
 *   2. after DRAIN_STREAM_DELAY_MS, by which time Caddy has noticed, asks its
 *      long-lived streams (overlay control, YouTube, TikTok) to reconnect, which
 *      lands them on the other copy.
 * A file older than this process is ignored, so a leftover from an earlier
 * deploy or a reboot can never mark a fresh copy as draining. (The separate
 * hold file, below, keeps a new copy out of rotation until it is checked.)
 *
 * State lives on globalThis so every route sees the same drain state and
 * shares one timer, however the server bundles them.
 */
import { statSync } from 'fs';

export const DRAIN_STREAM_DELAY_MS = 3_000;
export const DRAIN_POLL_MS = 1_000;
const DRAIN_CHECK_CACHE_MS = 250;

type DrainState = {
  /** When this process started (measured once). */
  startedAt: number | null;
  checkedAt: number;
  since: number | null;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
};

const state: DrainState = ((globalThis as Record<string, unknown>).__flosschatDrain ??= {
  startedAt: null,
  checkedAt: 0,
  since: null,
  listeners: new Set(),
  timer: null,
}) as DrainState;

function processStartedAt(): number {
  state.startedAt ??= Date.now() - process.uptime() * 1_000;
  return state.startedAt;
}

function drainFile(): string {
  return process.env.FLOSSCHAT_DRAIN_FILE?.trim() ?? '';
}

/** When this copy started draining (the drain file's time), or null. */
export function drainingSince(now = Date.now()): number | null {
  if (now - state.checkedAt < DRAIN_CHECK_CACHE_MS) return state.since;
  state.checkedAt = now;
  const startedAt = processStartedAt();
  const file = drainFile();
  let since: number | null = null;
  if (file) {
    try {
      const modified = statSync(file).mtimeMs;
      if (modified >= startedAt) since = modified;
    } catch {
      since = null;
    }
  }
  state.since = since;
  return since;
}

export function isDraining(now = Date.now()): boolean {
  return drainingSince(now) !== null;
}

/**
 * A freshly started copy is "held" while the file named by FLOSSCHAT_HOLD_FILE
 * exists: it is running, but reports not-ready so Caddy sends it nobody until
 * the deploy has checked its settings and removes the file.
 */
export function isHeld(): boolean {
  const file = process.env.FLOSSCHAT_HOLD_FILE?.trim();
  if (!file) return false;
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

function streamsShouldMove(now = Date.now()): boolean {
  const since = drainingSince(now);
  return since !== null && now - since >= DRAIN_STREAM_DELAY_MS;
}

function tick(): void {
  if (!streamsShouldMove()) return;
  const listeners = [...state.listeners];
  state.listeners.clear();
  stopTimer();
  for (const listener of listeners) {
    try { listener(); } catch { /* one stream failing to close must not stop the rest */ }
  }
}

function stopTimer(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/**
 * Call `listener` once when this copy's long-lived streams should move to the
 * other copy. Returns a function that cancels it (call it when the stream
 * closes on its own). The shared timer only runs while streams are listening.
 */
export function onStreamsMove(listener: () => void): () => void {
  /* No drain file configured (development, tests): no handover can happen. */
  if (!drainFile()) return () => {};
  state.listeners.add(listener);
  if (!state.timer) {
    state.timer = setInterval(tick, DRAIN_POLL_MS);
    (state.timer as { unref?: () => void }).unref?.();
  }
  return () => {
    state.listeners.delete(listener);
    if (!state.listeners.size) stopTimer();
  };
}

export function __resetDrainForTests(): void {
  stopTimer();
  state.listeners.clear();
  state.startedAt = null;
  state.checkedAt = 0;
  state.since = null;
}
