/* The continuous Viewer Counter preview rotation.
 *
 * `features/counter/previewSimulator` is pure. Its claims — sixteen states and
 * no more, every one reachable, counts inside 1..500,000, an inactive platform
 * marked `offline` rather than unknown — are facts about values, so they are
 * asserted directly against a seeded source.
 *
 * The exhaustive claims are asserted exhaustively. "All sixteen combinations
 * appear" is checked by draining whole bags and comparing sets, not by sampling
 * until a coverage counter looks high — the bag algorithm makes that a fact, and a
 * test that sampled it would be asserting a probability instead.
 *
 * Every test supplies its own seeded source. A suite that let `Math.random`
 * decide would fail on someone else's machine for no reason they could act on.
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
} from '@/features/counter/previewSimulator';
import { PREVIEW_SPEEDS, seededRandom } from '@/lib/tools/previewRandom';
import {
  PLATFORM_ORDER,
  summarize,
  visiblePlatforms,
  type ViewerPlatform,
} from '@/lib/viewerCounterConfig';

beforeEach(() => {
  vi.useFakeTimers();
});

/* ------------------------------------------------------------------ */
/* The combination space                                              */
/* ------------------------------------------------------------------ */

describe('the fifteen platform combinations', () => {
  it('initializes the combination array and its derived count in one pure module', async () => {
    const simulator = await import('@/features/counter/previewSimulator');
    expect(Array.isArray(simulator.COUNTER_COMBINATIONS)).toBe(true);
    expect(simulator.COUNTER_STATE_COUNT).toBe(simulator.COUNTER_COMBINATIONS.length);
    expect(simulator.COUNTER_STATE_COUNT).toBeGreaterThan(0);
  });

  it('is exactly the fifteen non-empty states — never an empty slide', () => {
    expect(PLATFORM_ORDER).toHaveLength(4);
    expect(COUNTER_COMBINATIONS).toHaveLength(15);
    expect(COUNTER_STATE_COUNT).toBe(15);
    /* The preview must never show an empty showcase, so the all-offline
       subset is left out of the rotation. */
    expect(COUNTER_COMBINATIONS.every((c) => platformsForCombination(c).length > 0)).toBe(true);
    expect(COUNTER_COMBINATIONS).not.toContain(0);
  });

  it('enumerates every distinct subset of the platforms, once each', () => {
    const shapes = COUNTER_COMBINATIONS.map((combination) =>
      platformsForCombination(combination).join(','),
    );
    expect(new Set(shapes).size).toBe(COUNTER_COMBINATIONS.length);
    /* Every single-platform state and the all-four state are present by name, so
       "every subset" is not satisfied by fifteen arbitrary masks. */
    for (const platform of PLATFORM_ORDER) {
      expect(shapes).toContain(platform);
    }
    expect(shapes).toContain(PLATFORM_ORDER.join(','));
    expect(shapes).not.toContain('');
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
  it('is a permutation of all fifteen states, every time', () => {
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
