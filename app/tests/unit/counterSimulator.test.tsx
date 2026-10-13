/* The continuous Viewer Counter preview rotation.
 *
 * Split the same way the chat feed's suite is split, because the two layers fail
 * for different reasons:
 *
 *   - `lib/tools/counter/previewSimulator` is pure. Its claims — sixteen states
 *     and no more, every one reachable, counts inside 1..500,000, an inactive
 *     platform marked `offline` rather than unknown — are facts about values, so
 *     they are asserted directly against a seeded source;
 *   - `components/classic/useCounterPreviewSimulator` owns the timer, so every
 *     claim about it is about lifecycle: one scheduler under Strict Mode, nothing
 *     armed after unmount, a rotation that a settings change cannot restart.
 *
 * The exhaustive claims are asserted exhaustively. "All sixteen combinations
 * appear" is checked by draining whole bags and comparing sets, not by sampling
 * until a coverage counter looks high — the bag algorithm makes that a fact, and a
 * test that sampled it would be asserting a probability instead.
 *
 * Every test supplies its own seeded source. A suite that let `Math.random`
 * decide would fail on someone else's machine for no reason they could act on.
 *
 * As in the chat suite, no test counts timer *identities*: Vitest's fake timers
 * reuse ids, so an id-counting test would pass against a genuinely doubled chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { counterTool } from '@/features/counter/config';
import { SAMPLE_COUNTER_COUNTS } from '@/features/counter/samples';
import {
  COUNTER_COMBINATIONS,
  COUNTER_INTERVAL_MAX_MS,
  COUNTER_INTERVAL_MIN_MS,
  COUNTER_SIM_COUNT_MAX,
  COUNTER_SIM_COUNT_MIN,
  COUNTER_STATE_COUNT,
  combinationForPlatforms,
  combinationLabel,
  counterDelayBounds,
  nextCounterDelay,
  platformsForCombination,
  shuffledCombinations,
  simulatedCount,
  statusesForCombination,
  type CounterCombination,
} from '@/features/counter/previewSimulator';
import {
  PREVIEW_SPEEDS,
  seededRandom,
  type PreviewSpeed,
} from '@/lib/tools/previewRandom';
import {
  useCounterPreviewSimulator,
  type CounterSimulatorOptions,
  type CounterSimulatorState,
} from '@/components/classic/useCounterPreviewSimulator';
import {
  PLATFORM_ORDER,
  summarize,
  visiblePlatforms,
  type PlatformStatuses,
  type ViewerPlatform,
} from '@/lib/viewerCounterConfig';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

/** Mount the hook and expose its latest state without rendering a preview. */
function mountSimulator(options: CounterSimulatorOptions = {}) {
  const seen: CounterSimulatorState[] = [];
  function Probe() {
    seen.push(useCounterPreviewSimulator(options));
    return null;
  }
  const view = render(<Probe />);
  return {
    ...view,
    /** The most recent hook return. Read fresh after every act(). */
    get state() {
      return seen[seen.length - 1]!;
    },
  };
}

/**
 * Fire exactly `times` combination changes, one timer at a time.
 *
 * Deliberately not `advanceTimersByTime(max + 1)`: the tick re-arms with a freshly
 * drawn delay that frequently lands inside the same window, so one such call
 * delivers two or three changes depending on the seed and every count here would
 * become a function of the random stream.
 */
function advance(times = 1) {
  for (let i = 0; i < times; i += 1) {
    act(() => void vi.advanceTimersToNextTimer());
  }
}

/** Force `document.visibilityState` and fire the event the hook listens for. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility('visible');
});

/* ------------------------------------------------------------------ */
/* The combination space                                              */
/* ------------------------------------------------------------------ */

describe('the sixteen platform combinations', () => {
  it('initializes the combination array and its derived count in one pure module', async () => {
    const simulator = await import('@/features/counter/previewSimulator');
    expect(Array.isArray(simulator.COUNTER_COMBINATIONS)).toBe(true);
    expect(simulator.COUNTER_STATE_COUNT).toBe(simulator.COUNTER_COMBINATIONS.length);
    expect(simulator.COUNTER_STATE_COUNT).toBeGreaterThan(0);
  });

  it('is exactly 2^4 states — fifteen non-empty plus all-offline', () => {
    expect(PLATFORM_ORDER).toHaveLength(4);
    expect(COUNTER_COMBINATIONS).toHaveLength(16);
    expect(COUNTER_STATE_COUNT).toBe(16);
    const nonEmpty = COUNTER_COMBINATIONS.filter(
      (combination) => platformsForCombination(combination).length > 0,
    );
    expect(nonEmpty).toHaveLength(15);
    /* The sixteenth is the all-offline state, and it is in the rotation rather
       than skipped — the spec names it as a state worth seeing. */
    expect(COUNTER_COMBINATIONS.filter((c) => platformsForCombination(c).length === 0)).toEqual([0]);
  });

  it('enumerates every distinct subset of the platforms, once each', () => {
    const shapes = COUNTER_COMBINATIONS.map((combination) =>
      platformsForCombination(combination).join(','),
    );
    expect(new Set(shapes).size).toBe(COUNTER_COMBINATIONS.length);
    /* Every single-platform state and the all-four state are present by name, so
       "every subset" is not satisfied by sixteen arbitrary masks. */
    for (const platform of PLATFORM_ORDER) {
      expect(shapes).toContain(platform);
    }
    expect(shapes).toContain(PLATFORM_ORDER.join(','));
    expect(shapes).toContain('');
  });

  it('round-trips a set of platforms through its mask', () => {
    for (const combination of COUNTER_COMBINATIONS) {
      const platforms = platformsForCombination(combination);
      expect(combinationForPlatforms(platforms)).toBe(combination);
    }
  });

  it('keeps the active platforms in display order, whatever order they were given', () => {
    const reversed = [...PLATFORM_ORDER].reverse();
    expect(platformsForCombination(combinationForPlatforms(reversed))).toEqual(PLATFORM_ORDER);
  });

  it('names the empty state instead of leaving the status line blank', () => {
    expect(combinationLabel(0)).toBe('all platforms offline');
    for (const combination of COUNTER_COMBINATIONS) {
      expect(combinationLabel(combination).length).toBeGreaterThan(0);
    }
  });

  it('uses the visible platform names in the label when it is given them', () => {
    const labels: Partial<Record<ViewerPlatform, string>> = {
      twitch: 'Twitch',
      youtube: 'YouTube',
    };
    const both = combinationForPlatforms(['twitch', 'youtube']);
    expect(combinationLabel(both, labels)).toBe('Twitch + YouTube');
    /* A platform with no label supplied falls back to its key rather than to an
       empty string, so a missing entry cannot silently produce " + ". */
    expect(combinationLabel(combinationForPlatforms(['kick']), labels)).toBe('kick');
  });
});

/* ------------------------------------------------------------------ */
/* The bag                                                            */
/* ------------------------------------------------------------------ */

describe('the shuffled bag', () => {
  it('is a permutation of all sixteen states, every time', () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const bag = shuffledCombinations(seededRandom(seed));
      expect(bag).toHaveLength(COUNTER_COMBINATIONS.length);
      expect([...bag].sort((a, b) => a - b)).toEqual([...COUNTER_COMBINATIONS]);
    }
  });

  it('actually shuffles rather than returning ascending order', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      orders.add(shuffledCombinations(seededRandom(seed)).join(','));
    }
    expect(orders.size).toBeGreaterThan(30);
  });

  it('never opens with the state the previous bag closed on', () => {
    /* Exhaustive over both axes: every state as the one to avoid, across many
       seeds. This is the seam between two bags, the only place a combination
       could follow itself. */
    for (const avoid of COUNTER_COMBINATIONS) {
      for (let seed = 1; seed <= 40; seed += 1) {
        expect(shuffledCombinations(seededRandom(seed), avoid)[0]).not.toBe(avoid);
      }
    }
  });

  it('is still a full permutation after the avoid swap', () => {
    for (const avoid of COUNTER_COMBINATIONS) {
      const bag = shuffledCombinations(seededRandom(avoid + 7), avoid);
      expect([...bag].sort((a, b) => a - b)).toEqual([...COUNTER_COMBINATIONS]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Counts                                                             */
/* ------------------------------------------------------------------ */

describe('a simulated count', () => {
  it('stays inside the documented 1..500,000 range', () => {
    const random = seededRandom(5);
    for (let i = 0; i < 3000; i += 1) {
      const count = simulatedCount(random);
      expect(count).toBeGreaterThanOrEqual(COUNTER_SIM_COUNT_MIN);
      expect(count).toBeLessThanOrEqual(COUNTER_SIM_COUNT_MAX);
      expect(Number.isSafeInteger(count)).toBe(true);
    }
    expect(COUNTER_SIM_COUNT_MIN).toBe(1);
    expect(COUNTER_SIM_COUNT_MAX).toBe(500_000);
  });

  it('never draws 0, which the renderer would print as a measured zero', () => {
    /* 0 is a real measured value the renderer displays as "0" — visually the same
       at a glance as the offline state this simulator shows separately and
       deliberately. Drawing it would blur the two. */
    const random = seededRandom(9);
    for (let i = 0; i < 3000; i += 1) {
      expect(simulatedCount(random)).not.toBe(0);
    }
  });

  it('reaches every magnitude, not just the top of the range', () => {
    /* The claim this suite originally made — "a count below 100 appears" — was
       true of the *range* but not of a uniform draw over it: under 0.02% of
       [1, 500,000] falls below 100, so whether it showed up was a property of the
       seed rather than of the generator. It now draws a magnitude band first, so
       every decade is equally likely and this is assertable over a few hundred
       draws. Asserted per decade rather than at the two ends, because "both ends
       are reachable" would still pass if everything in between were missing. */
    const random = seededRandom(13);
    const counts = Array.from({ length: 600 }, () => simulatedCount(random));
    const decades = new Set(counts.map((count) => String(count).length));
    expect([...decades].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('produces counts the renderer has to group with a thousands separator', () => {
    /* Grouping is `toLocaleString` inside RollingCount, so this asserts against
       that call rather than against a hardcoded "12,480" that could disagree with
       it. A rotation that only ever drew small numbers would never exercise it. */
    const random = seededRandom(29);
    const counts = Array.from({ length: 600 }, () => simulatedCount(random));
    expect(counts.some((count) => count.toLocaleString() !== String(count))).toBe(true);
  });

  it('varies rather than repeating one value', () => {
    const random = seededRandom(17);
    const counts = Array.from({ length: 200 }, () => simulatedCount(random));
    expect(new Set(counts).size).toBeGreaterThan(150);
  });

  it('calls no global random source of its own', () => {
    const random = vi.spyOn(Math, 'random');
    simulatedCount(seededRandom(21));
    statusesForCombination(15, seededRandom(21));
    expect(random).not.toHaveBeenCalled();
  });

  it('reads no clock', () => {
    const now = vi.spyOn(Date, 'now');
    statusesForCombination(15, seededRandom(23));
    expect(now).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Statuses                                                           */
/* ------------------------------------------------------------------ */

describe('the statuses built for a combination', () => {
  it('marks every platform, active or not — never omits one', () => {
    for (const combination of COUNTER_COMBINATIONS) {
      const statuses = statusesForCombination(combination, seededRandom(3));
      for (const platform of PLATFORM_ORDER) {
        expect(statuses[platform]).toBeDefined();
      }
    }
  });

  it('gives every active platform a measured count and no other state', () => {
    for (const combination of COUNTER_COMBINATIONS) {
      const statuses = statusesForCombination(combination, seededRandom(combination + 1));
      for (const platform of platformsForCombination(combination)) {
        const status = statuses[platform]!;
        expect(status.state).toBe('live');
        if (status.state !== 'live') throw new Error('unreachable');
        expect(status.viewers).toBeGreaterThanOrEqual(COUNTER_SIM_COUNT_MIN);
        expect(status.viewers).toBeLessThanOrEqual(COUNTER_SIM_COUNT_MAX);
      }
    }
  });

  it("marks an inactive platform 'offline', not 'live-unknown'", () => {
    /* This is the distinction the whole rotation rests on. `visiblePlatforms`
       keeps 'live-unknown' and drops 'offline', so marking an inactive platform
       unknown would leave its pill on screen showing an em dash and nothing would
       ever appear to change. */
    for (const combination of COUNTER_COMBINATIONS) {
      const statuses = statusesForCombination(combination, seededRandom(4));
      const active = new Set(platformsForCombination(combination));
      for (const platform of PLATFORM_ORDER) {
        if (active.has(platform)) continue;
        expect(statuses[platform]!.state).toBe('offline');
      }
    }
  });

  it('makes exactly the active platforms occupy space in the overlay', () => {
    /* Asserted through the production helper rather than by re-reading the
       statuses here: `visiblePlatforms` is what the renderer uses to decide which
       pills exist, so it is the only honest judge of "this platform vacated". */
    for (const combination of COUNTER_COMBINATIONS) {
      const statuses = statusesForCombination(combination, seededRandom(6));
      expect(visiblePlatforms(statuses)).toEqual([...platformsForCombination(combination)]);
    }
  });

  it('sums to the total combined mode will show', () => {
    for (const combination of COUNTER_COMBINATIONS) {
      const statuses = statusesForCombination(combination, seededRandom(8));
      const expected = platformsForCombination(combination).reduce((sum, platform) => {
        const status = statuses[platform]!;
        return status.state === 'live' ? sum + status.viewers : sum;
      }, 0);
      const summary = summarize(statuses);
      expect(summary.total).toBe(expected);
      expect(summary.hasMeasured).toBe(platformsForCombination(combination).length > 0);
    }
  });

  it('leaves the all-offline state with no presence at all', () => {
    /* The empty state must render as nothing rather than as a fabricated 0, and
       `hasPresence` is the flag the renderer consults to decide that. */
    const statuses = statusesForCombination(0, seededRandom(10));
    const summary = summarize(statuses);
    expect(summary.hasPresence).toBe(false);
    expect(summary.hasMeasured).toBe(false);
    expect(summary.total).toBe(0);
    expect(visiblePlatforms(statuses)).toEqual([]);
  });

  it('draws an independent count per platform', () => {
    const all = combinationForPlatforms(PLATFORM_ORDER);
    const statuses = statusesForCombination(all, seededRandom(12));
    const counts = PLATFORM_ORDER.map((platform) => {
      const status = statuses[platform]!;
      return status.state === 'live' ? status.viewers : -1;
    });
    expect(new Set(counts).size).toBe(PLATFORM_ORDER.length);
  });

  it('is identical for one seed and one combination', () => {
    const first = statusesForCombination(11, seededRandom(31));
    const second = statusesForCombination(11, seededRandom(31));
    expect(first).toEqual(second);
  });
});

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

describe('the combination interval', () => {
  it('stays inside the documented 2.5s–6s band at Normal speed', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 400; i += 1) {
      const delay = nextCounterDelay(random, 'normal');
      expect(delay).toBeGreaterThanOrEqual(COUNTER_INTERVAL_MIN_MS);
      expect(delay).toBeLessThanOrEqual(COUNTER_INTERVAL_MAX_MS);
    }
    expect(COUNTER_INTERVAL_MIN_MS).toBe(2500);
    expect(COUNTER_INTERVAL_MAX_MS).toBe(6000);
  });

  it('draws a fresh delay per change rather than one fixed period', () => {
    const random = seededRandom(4);
    const delays = Array.from({ length: 40 }, () => nextCounterDelay(random, 'normal'));
    expect(new Set(delays).size).toBeGreaterThan(5);
  });

  it('keeps every speed inside its own band, widest to narrowest', () => {
    for (const speed of PREVIEW_SPEEDS) {
      const bounds = counterDelayBounds(speed);
      const random = seededRandom(11);
      for (let i = 0; i < 200; i += 1) {
        const delay = nextCounterDelay(random, speed);
        expect(delay).toBeGreaterThanOrEqual(bounds.min);
        expect(delay).toBeLessThanOrEqual(bounds.max);
      }
    }
    expect(counterDelayBounds('slow').min).toBeGreaterThan(counterDelayBounds('normal').min);
    expect(counterDelayBounds('fast').max).toBeLessThan(counterDelayBounds('normal').max);
  });

  it('changes more slowly than the chat feed, so a count can be read', () => {
    /* A count change is not just a new line appearing: RollingCount animates and
       the pills reflow when the active set changes, so a rotation as quick as chat
       would never settle long enough to read. */
    expect(COUNTER_INTERVAL_MIN_MS).toBeGreaterThan(1200);
  });

  it('never schedules soon enough to land inside a synchronous test', () => {
    /* Load-bearing beyond pacing: several suites mount the whole generator on
       real timers and assert synchronously, and a first change a few milliseconds
       in would update those trees mid-assertion or after unmount. */
    const fastest = Math.min(...PREVIEW_SPEEDS.map((speed) => counterDelayBounds(speed).min));
    expect(fastest).toBeGreaterThanOrEqual(1000);
  });
});

/* ------------------------------------------------------------------ */
/* The hook                                                           */
/* ------------------------------------------------------------------ */

describe('the counter rotation hook', () => {
  it('starts armed, live, with nothing simulated yet', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    expect(view.state.enabled).toBe(true);
    expect(view.state.paused).toBe(false);
    expect(view.state.running).toBe(true);
    expect(view.state.mode).toBe('live');
    /* Null rather than a first combination: the generator is server-rendered, and
       drawing during that render would differ between server and client. Null is
       also what tells the caller to show its deterministic fixtures. */
    expect(view.state.statuses).toBeNull();
    expect(view.state.combination).toBeNull();
    expect(view.state.seenCount).toBe(0);
  });

  it('produces its first state on the first tick, not during render', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void vi.advanceTimersByTime(counterDelayBounds('normal').min - 1));
    expect(view.state.statuses).toBeNull();
    advance(1);
    expect(view.state.statuses).not.toBeNull();
    expect(view.state.combination).not.toBeNull();
    expect(view.state.seenCount).toBe(1);
  });

  it('changes combination on its own, one per interval', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    const seen: CounterCombination[] = [];
    for (let i = 0; i < 6; i += 1) {
      advance(1);
      seen.push(view.state.combination!);
    }
    expect(seen).toHaveLength(6);
    expect(seen.every((combination) => COUNTER_COMBINATIONS.includes(combination))).toBe(true);
  });

  it('shows all sixteen states within one full rotation', () => {
    /* Exactly sixteen ticks, not "enough ticks": the bag draws without
       replacement, so full coverage after one pass is a property of the algorithm
       rather than a sample that got lucky. */
    const view = mountSimulator({ random: seededRandom(2) });
    const seen = new Set<CounterCombination>();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) {
      advance(1);
      seen.add(view.state.combination!);
    }
    expect(seen.size).toBe(COUNTER_STATE_COUNT);
    expect([...seen].sort((a, b) => a - b)).toEqual([...COUNTER_COMBINATIONS]);
    expect(view.state.seenCount).toBe(COUNTER_STATE_COUNT);
  });

  it('includes the all-offline state and every single-platform state in that pass', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    const seen = new Set<CounterCombination>();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) {
      advance(1);
      seen.add(view.state.combination!);
    }
    expect(seen.has(0)).toBe(true);
    for (const platform of PLATFORM_ORDER) {
      expect(seen.has(combinationForPlatforms([platform]))).toBe(true);
    }
    expect(seen.has(combinationForPlatforms(PLATFORM_ORDER))).toBe(true);
  });

  it('never repeats a combination back to back, across many bags', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    let previous: CounterCombination | null = null;
    /* Four full bags, so three bag seams are crossed — the seam is where the
       repeat would happen if the avoid guard were missing. */
    for (let i = 0; i < COUNTER_STATE_COUNT * 4; i += 1) {
      advance(1);
      const current = view.state.combination!;
      expect(current).not.toBe(previous);
      previous = current;
    }
  });

  it('reshuffles indefinitely rather than stopping after one pass', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(COUNTER_STATE_COUNT);
    const first = view.state.combination;
    advance(COUNTER_STATE_COUNT);
    expect(view.state.combination).not.toBeNull();
    expect(view.state.seenCount).toBe(COUNTER_STATE_COUNT);
    /* Still rotating: something is armed and it produced a further state. */
    expect(vi.getTimerCount()).toBe(1);
    expect(first).not.toBeUndefined();
  });

  it('draws fresh counts on every change, not one set reused', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    const totals: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      advance(1);
      totals.push(summarize(view.state.statuses as PlatformStatuses).total);
    }
    expect(new Set(totals).size).toBeGreaterThan(8);
  });

  it('hands out statuses the production helpers accept', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(1);
    const statuses = view.state.statuses!;
    expect(visiblePlatforms(statuses)).toEqual([
      ...platformsForCombination(view.state.combination!),
    ]);
  });

  it('stops on pause and continues from where it left off on resume', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(2);
    const held = view.state.combination;
    act(() => void view.state.togglePaused());
    expect(view.state.paused).toBe(true);
    expect(view.state.running).toBe(false);
    advance(5);
    expect(view.state.combination).toBe(held);

    act(() => void view.state.togglePaused());
    expect(view.state.running).toBe(true);
    advance(1);
    expect(view.state.combination).not.toBe(held);
  });

  it('disarms entirely when the switch goes off', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void view.state.setEnabled(false));
    expect(view.state.running).toBe(false);
    advance(6);
    expect(view.state.statuses).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('paces itself by the selected speed', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void view.state.setSpeed('slow'));
    expect(view.state.speed).toBe('slow');
    /* Past Normal's ceiling but short of Slow's floor: a rotation still running
       at the old cadence would have changed by now. */
    act(() => void vi.advanceTimersByTime(counterDelayBounds('slow').min - 1));
    expect(view.state.statuses).toBeNull();
    advance(1);
    expect(view.state.statuses).not.toBeNull();
  });

  it('rotates faster on Fast than on Slow over the same elapsed time', () => {
    const window = 60_000;
    const count = (speed: PreviewSpeed) => {
      const view = mountSimulator({ random: seededRandom(2) });
      act(() => void view.state.setSpeed(speed));
      act(() => void vi.advanceTimersByTime(window));
      const total = view.state.seenCount;
      cleanup();
      return total;
    };
    expect(count('fast')).toBeGreaterThan(count('slow'));
  });

  it('advances on demand without waiting for the pending delay', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void view.state.advance());
    expect(view.state.combination).not.toBeNull();
    expect(view.state.seenCount).toBe(1);
  });

  it('advances even while paused, which is when stepping by hand matters most', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void view.state.togglePaused());
    const before = view.state.seenCount;
    act(() => void view.state.advance());
    expect(view.state.seenCount).toBeGreaterThan(before);
    expect(view.state.paused).toBe(true);
  });

  it('holds the rotation while manual values are in use', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(1);
    const held = view.state.combination;
    act(() => void view.state.setMode('manual'));
    expect(view.state.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(5);
    expect(view.state.combination).toBe(held);
  });

  it('returns to Live, un-paused and re-armed on restore', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    act(() => void view.state.setMode('manual'));
    act(() => void view.state.togglePaused());
    act(() => void view.state.setEnabled(false));
    act(() => void view.state.restore());
    expect(view.state.mode).toBe('live');
    expect(view.state.paused).toBe(false);
    expect(view.state.enabled).toBe(true);
    expect(view.state.running).toBe(true);
    advance(1);
    expect(view.state.statuses).not.toBeNull();
  });

  it('still covers all sixteen states after a restore mid-rotation', () => {
    /* Restore drops the half-empty bag. A fresh bag still draws without
       replacement, so coverage from that point is a full pass. */
    const view = mountSimulator({ random: seededRandom(2) });
    advance(5);
    act(() => void view.state.restore());
    const seen = new Set<CounterCombination>();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) {
      advance(1);
      seen.add(view.state.combination!);
    }
    expect(seen.size).toBe(COUNTER_STATE_COUNT);
  });

  it('pauses while the tab is hidden and re-arms when it comes back', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(1);
    const held = view.state.combination;
    setVisibility('hidden');
    expect(view.state.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(5);
    expect(view.state.combination).toBe(held);

    setVisibility('visible');
    expect(view.state.running).toBe(true);
    advance(1);
    expect(view.state.combination).not.toBe(held);
  });

  it("reports the background pause without flipping the user's own switch", () => {
    const view = mountSimulator({ random: seededRandom(2) });
    setVisibility('hidden');
    expect(view.state.enabled).toBe(true);
    expect(view.state.paused).toBe(false);
    expect(view.state.running).toBe(false);
  });

  it('arms exactly one scheduler under Strict Mode', () => {
    /* Strict Mode mounts effects, tears them down and mounts them again. A timer
       created without a matching cleanup survives that and the rotation then runs
       at double rate — the classic symptom of this bug. */
    function Probe() {
      useCounterPreviewSimulator({ random: seededRandom(2) });
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it('changes one combination per interval under Strict Mode, not two', () => {
    const seen: CounterSimulatorState[] = [];
    function Probe() {
      seen.push(useCounterPreviewSimulator({ random: seededRandom(2) }));
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    advance(3);
    expect(seen[seen.length - 1]!.seenCount).toBe(3);
  });

  it('leaves no timer behind on unmount', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its visibility listener on unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const view = mountSimulator({ random: seededRandom(2) });
    view.unmount();
    expect(remove.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(true);
  });

  it('changes nothing after unmount even with the clock running', () => {
    const view = mountSimulator({ random: seededRandom(2) });
    advance(1);
    const before = view.state.combination;
    view.unmount();
    act(() => void vi.advanceTimersByTime(600_000));
    expect(view.state.combination).toBe(before);
  });

  it('opens no socket, fetches nothing and polls no viewer count', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('EventSource', socket);
    const view = mountSimulator({ random: seededRandom(2) });
    advance(10);
    expect(view.state.seenCount).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('leaves the URL and session storage untouched', () => {
    /* Storage is read back rather than spied on: spying on sessionStorage
       schedules a jsdom timer of its own, and this suite steps one timer at a
       time, so the spy would consume the step meant for the first change. */
    const href = window.location.href;
    window.sessionStorage.clear();
    const view = mountSimulator({ random: seededRandom(2) });
    advance(10);
    expect(view.state.seenCount).toBeGreaterThan(0);
    expect(window.location.href).toBe(href);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('honours an explicit disabled start, for a caller that arms by hand', () => {
    const view = mountSimulator({ random: seededRandom(2), enabled: false });
    expect(view.state.enabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => void view.state.setEnabled(true));
    advance(1);
    expect(view.state.statuses).not.toBeNull();
  });

  it('produces the same rotation twice for one seed', () => {
    const run = () => {
      const view = mountSimulator({ random: seededRandom(77) });
      const seen: CounterCombination[] = [];
      for (let i = 0; i < 20; i += 1) {
        advance(1);
        seen.push(view.state.combination!);
      }
      cleanup();
      return seen;
    };
    expect(run()).toEqual(run());
  });
});

/* ------------------------------------------------------------------ */
/* Inside the generator                                               */
/* ------------------------------------------------------------------ */

/* The block above drives the hook directly with a seeded source. This one mounts
   the whole generator, which calls the hook with no options — so the rotation runs
   on `Math.random` and no test here can predict which combination comes next.
   That is fine, because the claims worth making at this level do not depend on the
   order. The bag guarantees all sixteen states within sixteen draws whatever the
   source, so "every state reaches the renderer" is still exhaustive rather than
   sampled; the rest are claims about the card's structure, which is fixed. */
describe('the rotation inside the generator', () => {
  /** The counter preview's isolation frame, in the generator document. */
  const frame = () =>
    document.querySelector<HTMLIFrameElement>(
      'iframe[title="Viewer Counter sample preview"]',
    )!;

  /* Queried inside the frame's document: the renderer is portalled there, and a
     query against the generator document would find nothing. */
  const preview = () => frame().contentDocument!.body;

  /**
   * How many pills the renderer is currently drawing.
   *
   * body > the inset reproducing the overlay page's padding > the renderer's own
   * flex row, whose element children are the pills. All of it is optional: the
   * all-offline state is drawn as nothing at all, which is the state this has to
   * report as 0 rather than crash on.
   */
  const pillCount = () => {
    const row = (preview().firstElementChild as HTMLElement | null)?.querySelector('div');
    return row ? row.children.length : 0;
  };

  const mountGenerator = () => {
    const view = render(<ClassicGenerator />);
    return view;
  };

  /**
   * Fire exactly one combination change, through the button rather than the clock.
   *
   * The clock is the wrong instrument at this level. The generator arms several
   * unrelated timers — the chat feed's own rotation and both preview debounces —
   * so `advanceTimersToNextTimer` fires whichever happens to be soonest and a loop
   * of sixteen advances would spend an unpredictable share of them elsewhere. The
   * coverage claims below would silently degrade from exhaustive to sampled.
   *
   * "Next combination" calls the same `step` the timer calls, synchronously, so
   * sixteen presses are exactly sixteen draws from the bag — which is what makes
   * "every one of the sixteen states appears" a fact here rather than a hope. The
   * timer-driven path is asserted directly against the hook further up.
   */
  const step = () =>
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Next combination' })));

  /** This card's own live region, scoped so the chat feed's cannot be read instead. */
  const status = () =>
    document.querySelector('.preview-counter-feed .preview-feed-status')?.textContent ?? '';

  it('leaves the manual fields in the document but collapsed', () => {
    render(<ClassicGenerator />);
    const details = document.querySelector<HTMLDetailsElement>('.preview-manual')!;
    /* Closed, so the card leads with the preview — but present, because a
       `<details>` hides its contents from view without removing them from the
       document. Everything that referenced these fields still finds them. */
    expect(details.open).toBe(false);
    for (const platform of PLATFORM_ORDER) {
      const field = document.getElementById(`sample-count-${platform}`) as HTMLInputElement;
      expect(field).toBeTruthy();
      expect(details.contains(field)).toBe(true);
      expect(field.value).toBe(String(SAMPLE_COUNTER_COUNTS[platform]));
    }
    /* And the section is reachable, which a closed details with no summary
       would not be. */
    expect(details.querySelector('summary')!.textContent).toBe('Manual preview values');
  });

  it('shows the built-in fixtures before the first change, so hydration matches', () => {
    /* The server renders this markup too. A combination drawn during the first
       render would differ between server and client, so the first paint has to be
       the deterministic fixture set — one combined pill holding the sample total. */
    render(<ClassicGenerator />);
    expect(pillCount()).toBe(1);
  });

  it('reaches every one of the sixteen states in separate mode', () => {
    mountGenerator();
    /* Separate mode is where the active set is individually visible: one pill per
       live platform, so the pill count *is* the size of the combination. */
    fireEvent.click(screen.getByLabelText('Combined total'));
    const sizes = new Set<number>();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) {
      step();
      sizes.add(pillCount());
    }
    /* Sixteen draws from a bag of sixteen distinct states is every state exactly
       once, so all five sizes must have appeared — including 0, the all-offline
       state the renderer draws as nothing, and 4, every platform live. */
    expect([...sizes].sort()).toEqual([0, 1, 2, 3, 4]);
  }, 15_000);

  it('collapses every non-empty state to one pill in combined mode', () => {
    mountGenerator();
    const counts = new Set<number>();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) {
      step();
      counts.add(pillCount());
    }
    /* Combined is the default. Fifteen states have presence and draw a single
       total; the sixteenth has none and draws nothing. Never two pills — that
       would mean combined mode had stopped summing. */
    expect([...counts].sort()).toEqual([0, 1]);
  }, 15_000);

  it('serializes nothing it simulates into either URL', () => {
    mountGenerator();
    const urls = new Set<string>();
    for (let i = 0; i < COUNTER_STATE_COUNT * 2; i += 1) {
      step();
      for (const el of document.querySelectorAll('.url-code')) {
        urls.add(el.textContent ?? '');
      }
    }
    /* Both URLs are byte-identical to what the serializer produces from the
       settings alone, at every point in a full rotation. A count that leaked would
       show up as a URL nobody's settings could account for. */
    const expected = counterTool.serialize({}, counterTool.defaults);
    expect([...urls].some((url) => url.endsWith(expected ? `?${expected}` : '/counter'))).toBe(
      true,
    );
    for (const url of urls) {
      expect(url).not.toMatch(/viewers|combination|sim-/i);
      /* The digit scan is against the query only, not the whole string. The
         displayed URL carries the origin, and `localhost:3000` holds a four-digit
         run that has nothing to do with serialization — scanning the whole thing
         failed on correct output. The query is the part these settings actually
         produce, and every one of them is a boolean or a short enum, so any long
         digit run there would be a count that had leaked. */
      const query = url.split('?')[1] ?? '';
      expect(query).not.toMatch(/\d{4,}/);
    }
  }, 45_000);

  it('opens no request and no socket across a full rotation', () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL) => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);
    vi.stubGlobal('EventSource', socket);
    mountGenerator();
    for (let i = 0; i < COUNTER_STATE_COUNT; i += 1) step();
    /* The rotation never asks /api/viewers; the only allowed requests belong to
       the separate curated Chat Preview identity roster. */
    expect(fetchSpy.mock.calls.every(([url]) => String(url).startsWith('/api/twitch/preview-identity?login='))).toBe(true);
    expect(fetchSpy.mock.calls.every(([url]) => !String(url).includes('/api/viewers'))).toBe(true);
    expect(socket).not.toHaveBeenCalled();
    /* And the frame still never navigates — loading the real /counter document is
       what would reintroduce the overlay's own polling. */
    expect(frame().getAttribute('src')).toBeNull();
    expect(frame().getAttribute('srcdoc')).toBeNull();
    vi.unstubAllGlobals();
  }, 15_000);

  it('hands the manual fields control the moment one is typed into', () => {
    mountGenerator();
    step();
    fireEvent.change(document.getElementById('sample-count-twitch') as HTMLInputElement, {
      target: { value: '4242' },
    });
    /* Typing is the switch into Manual, and it takes effect immediately rather
       than at the next tick — otherwise the rotation would overwrite the value
       that was just typed and the field would look broken. */
    expect(status()).toMatch(/manual preview values in use/i);
    /* The field surviving further steps is the observable form of "the rotation
       is held". Deliberately not asserting the number the renderer draws:
       `RollingCount` eases towards it across requestAnimationFrame callbacks, so
       the digits on screen at this instant are mid-flight — the counterPreview
       suite stubs rAF to drive that to completion, and duplicating the harness
       here would test the animation rather than the mode switch. */
    for (let i = 0; i < 4; i += 1) step();
    expect((document.getElementById('sample-count-twitch') as HTMLInputElement).value).toBe(
      '4242',
    );
    /* What an empty field then draws is not re-asserted here. The counterPreview
       suite already covers it end to end, and it has the rAF harness that drives
       RollingCount to completion — which this test would have to duplicate to say
       anything about rendered digits at all. */
  });

  it('resumes the rotation when Restore simulation is pressed', () => {
    mountGenerator();
    fireEvent.change(document.getElementById('sample-count-kick') as HTMLInputElement, {
      target: { value: '7' },
    });
    expect(status()).toMatch(/manual preview values in use/i);
    fireEvent.click(screen.getByRole('button', { name: 'Restore simulation' }));
    /* Back to Live, and the status line says so rather than a timer count saying
       it: the generator arms several unrelated timers, so a count here would be
       asserting the chat feed's state as much as this card's. */
    expect(status()).toMatch(/running/i);
  });

  it('carries exactly one live region of its own', () => {
    render(<ClassicGenerator />);
    const card = document.querySelector('.preview-counter-feed')!;
    /* Sixteen combinations announced as they cycle would make the page unusable
       with a screen reader, so the card states its run state and its coverage in
       one polite region rather than narrating each change. */
    expect(card.querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(1);
  });

  it('leaves no timer behind when the generator unmounts', () => {
    mountGenerator();
    step();
    const view = { unmount: () => cleanup() };
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
