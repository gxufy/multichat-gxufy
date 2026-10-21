/* The live Viewer Counter preview simulation, as a hook.
 *
 * WHY THIS LIVES ABOVE THE PREVIEW. `ClassicCounterPreview` is a pure function of
 * its props, and that is asserted rather than assumed: tests/unit/counterPreview
 * .test.tsx spies on `Date.now` and `Math.random` and requires the preview to call
 * neither, and mounts it twice comparing markup. A clock or a random source inside
 * the component would break those suites for a good reason — a preview that
 * invents its own data cannot be reasoned about from its props. So the rotation
 * sits here, in the generator, and hands finished `PlatformStatuses` down.
 *
 * WHY THE FIRST STATE IS THE FIXTURE. The generator is server-rendered, so the
 * first client render has to match the server's markup exactly. Drawing a random
 * combination during that render would differ between the two and produce a
 * hydration mismatch. So the hook starts with nothing of its own and the first
 * simulated combination arrives on the first tick, which is also why the caller
 * receives `null` until then rather than a set of statuses it cannot distinguish
 * from a real one.
 *
 * WHAT RESTARTS THE ROTATION, AND WHAT MUST NOT. The scheduling effect depends on
 * whether it is running and how fast — nothing else. The bag, the last
 * combination drawn and the random source are held in refs, so changing any of
 * the six counter settings, typing in a manual field or resizing the panel leaves
 * the running timer alone. A rotation that restarted whenever a setting changed
 * would never reach the slow end of its band.
 *
 * ONE SCHEDULER. React Strict Mode double-invokes effects in development. The
 * chain is a single `setTimeout` re-armed from its own callback, and cleanup both
 * clears the pending timer and sets a cancelled flag — so the first invocation's
 * chain is dead before the second arms, and a callback already in flight cannot
 * re-arm after unmount.
 *
 * Browser-safe — no network, no /api/viewers, no polling, no sockets.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  nextCounterDelay,
  shuffledCombinations,
  statusesForCombination,
  type CounterCombination,
} from '@/features/counter/previewSimulator';
import type { PreviewSpeed, RandomSource } from '@/lib/tools/previewRandom';
import type { PlatformStatuses } from '@/lib/viewerCounterConfig';

/** Where the preview's numbers come from. */
export type CounterPreviewMode = 'live' | 'manual';

export type CounterSimulatorOptions = {
  /** Randomness. Defaults to `Math.random`; tests pass a seeded source. */
  random?: RandomSource;
  /** Start running. False in a test that wants to arm the rotation by hand. */
  enabled?: boolean;
};

export type CounterSimulatorState = {
  /**
   * The simulated statuses, or null before the first tick.
   *
   * Null is meaningful: it tells the caller to show its own fixtures, which is
   * what keeps the server and client renders identical.
   */
  readonly statuses: PlatformStatuses | null;
  /** The combination currently displayed, or null before the first tick. */
  readonly combination: CounterCombination | null;
  /** How many of the sixteen states this run has shown at least once. */
  readonly seenCount: number;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly speed: PreviewSpeed;
  readonly mode: CounterPreviewMode;
  /**
   * True while a timer is armed — enabled, live, not paused, and tab visible.
   */
  readonly running: boolean;
  setEnabled: (next: boolean) => void;
  togglePaused: () => void;
  setSpeed: (next: PreviewSpeed) => void;
  setMode: (next: CounterPreviewMode) => void;
  /** Advance immediately, without waiting for the pending delay. */
  advance: () => void;
  /** Back to Live, un-paused, rotation re-armed from a fresh bag. */
  restore: () => void;
};

/** Whether the document is currently hidden. Safe before hydration. */
function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useCounterPreviewSimulator(
  options: CounterSimulatorOptions = {},
): CounterSimulatorState {
  const { enabled: initialEnabled = true } = options;
  /* Read here rather than defaulted in the signature so the identity is stable
     across renders — the scheduling effect lists it as a dependency, and a new
     function each render would restart the rotation on every render. */
  const random = useMemo<RandomSource>(
    () => options.random ?? (() => Math.random()),
    [options.random],
  );

  const [statuses, setStatuses] = useState<PlatformStatuses | null>(null);
  const [combination, setCombination] = useState<CounterCombination | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<CounterCombination>>(() => new Set());
  const [enabled, setEnabled] = useState(initialEnabled);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<PreviewSpeed>('normal');
  const [mode, setMode] = useState<CounterPreviewMode>('live');
  const [hidden, setHidden] = useState(false);

  /* The bag, and the last value drawn from it. Refs rather than state: the tick
     reads and rewrites both, and neither should cause a render of its own or
     restart the timer. Null until the first draw, for the same reason the first
     statuses are null — a shuffle during render would consume random values
     twice under Strict Mode and the two renders would disagree. */
  const bagRef = useRef<CounterCombination[] | null>(null);
  const lastRef = useRef<CounterCombination | null>(null);

  /* Draw the next combination and paint it. Shared by the timer and by the
     Next combination button, so pressing the button cannot diverge from what the
     rotation would have done on its own. */
  const step = useCallback(() => {
    if (bagRef.current === null || bagRef.current.length === 0) {
      bagRef.current = shuffledCombinations(random, lastRef.current ?? undefined);
    }
    const next = bagRef.current.shift()!;
    lastRef.current = next;
    setCombination(next);
    setStatuses(statusesForCombination(next, random));
    setSeen((current) => {
      if (current.has(next)) return current;
      const grown = new Set(current);
      grown.add(next);
      return grown;
    });
  }, [random]);

  /* Pause while the tab is in the background. A rotation nobody can see still
     costs a timer, a render and an animation per step. */
  useEffect(() => {
    const sync = () => setHidden(documentHidden());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const running = enabled && !paused && !hidden && mode === 'live';

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      /* A callback already queued when cleanup ran must not paint or re-arm. */
      if (cancelled) return;
      step();
      schedule();
    };

    const schedule = () => {
      timer = setTimeout(tick, nextCounterDelay(random, speed));
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [running, speed, random, step]);

  const togglePaused = useCallback(() => setPaused((current) => !current), []);

  const restore = useCallback(() => {
    /* A fresh bag rather than the remains of the old one: Restore is the action
       someone reaches for after poking at manual values, and continuing a
       half-empty rotation would make it look like nothing happened. */
    bagRef.current = null;
    setPaused(false);
    setEnabled(true);
    setMode('live');
  }, []);

  return {
    statuses,
    combination,
    seenCount: seen.size,
    enabled,
    paused,
    speed,
    mode,
    running,
    setEnabled,
    togglePaused,
    setSpeed,
    setMode,
    advance: step,
    restore,
  };
}
