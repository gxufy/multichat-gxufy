/* The generator's live Viewer Counter preview: every platform combination, in turn.
 *
 * The counter preview used to show one frozen set of four counts. That proves
 * almost nothing about the settings it is meant to demonstrate: combined mode's
 * sum, separate mode's per-platform pills, and the offline presentation all
 * depend on *which* platforms are present, and a fixture where all four are
 * always live can never show any of them changing. So this walks the whole space.
 *
 * THE SPACE IS EXACTLY SIXTEEN STATES. Four platforms, each either active or
 * not: 2^4 = 16. Fifteen of those have at least one active platform, and the
 * sixteenth has none — every platform confirmed offline, which the renderer draws
 * as nothing at all rather than as a fabricated zero. That empty state is a real
 * state worth seeing, not a gap to skip, so it is in the rotation like the others.
 *
 * REACHABILITY IS STRUCTURAL, NOT STATISTICAL. Drawing a random combination each
 * step and rejecting repeats would satisfy "no immediate repetition" while
 * leaving "every combination is reachable" true only in the limit — a test could
 * only sample it and hope. Instead the sixteen states are shuffled into a bag and
 * drawn without replacement; when the bag empties it is reshuffled, and the
 * reshuffle rejects a first element equal to the last one drawn. So every
 * combination appears exactly once per sixteen steps, and no combination ever
 * follows itself. Both properties are then facts about the algorithm that a test
 * can assert exhaustively rather than approximately.
 *
 * WHAT IT DOES NOT DO. No /api/viewers request, no polling, no pin polling, no
 * provider connection. Nothing here is serialized: the counts never reach the
 * generated counter URL or the saved draft. The output is `PlatformStatuses` —
 * the same shape the live overlay folds real API results into — handed to the
 * same production renderer the fixtures already went through.
 *
 * Browser-safe — no server-only imports, no secrets, no network.
 */
import {
  intBetween,
  pick,
  speedBounds,
  speedDelay,
  type PreviewSpeed,
  type RandomSource,
} from '@/lib/tools/previewRandom';
import {
  PLATFORM_ORDER,
  type PlatformStatuses,
  type ViewerPlatform,
} from '@/lib/viewerCounterConfig';

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The Normal band between combination changes, in milliseconds.
 *
 * Slower than the chat feed on purpose. A count change is not just a new line
 * appearing: `RollingCount` animates over 600ms and the pills reflow when the
 * active set changes, so a rotation as quick as chat would never settle long
 * enough to read. The floor also keeps the generator's other suites safe — three
 * of them mount the whole generator on real timers and assert synchronously, and
 * a first change no sooner than 2.5s cannot land inside one of those.
 */
export const COUNTER_INTERVAL_MIN_MS = 2500;
export const COUNTER_INTERVAL_MAX_MS = 6000;

/** A randomized delay before the next combination, in the given speed's band. */
export function nextCounterDelay(random: RandomSource, speed: PreviewSpeed): number {
  return speedDelay(random, speed, COUNTER_INTERVAL_MIN_MS, COUNTER_INTERVAL_MAX_MS);
}

/** The band a speed draws from, for controls and tests to state exactly. */
export function counterDelayBounds(speed: PreviewSpeed): { min: number; max: number } {
  return speedBounds(speed, COUNTER_INTERVAL_MIN_MS, COUNTER_INTERVAL_MAX_MS);
}

/* ------------------------------------------------------------------ */
/* Counts                                                             */
/* ------------------------------------------------------------------ */

/**
 * The range a simulated count is drawn from.
 *
 * The floor is 1 rather than 0 because 0 is a *measured* value the renderer
 * displays as "0", which is indistinguishable at a glance from the offline state
 * this simulator shows separately and deliberately. The ceiling is high enough
 * that six-digit grouping appears regularly — the thousands separator is the
 * renderer's own `toLocaleString`, and a rotation that never produced a large
 * number would never exercise it.
 */
export const COUNTER_SIM_COUNT_MIN = 1;
export const COUNTER_SIM_COUNT_MAX = 500_000;

/**
 * The magnitude bands a count is drawn from, covering the range end to end.
 *
 * WHY NOT ONE UNIFORM DRAW. `intBetween(random, 1, 500_000)` is uniform over the
 * range, and uniform over a range this wide means essentially every count has
 * five or six digits: under 0.02% of that mass falls below 100. So the stated
 * floor of 1 would be reachable only in principle, and the preview would never
 * actually show what a small audience looks like — which is the common case for
 * the people configuring this overlay, and the case where a pill is narrowest
 * and the layout tightest.
 *
 * Picking a band first and then a value inside it makes each magnitude equally
 * likely, so single digits, hundreds and six figures all appear regularly. That
 * turns "the whole range is exercised" into something a test can assert over a
 * few hundred draws rather than something true only in the limit.
 *
 * The top band stops at {@link COUNTER_SIM_COUNT_MAX} rather than at 999,999, so
 * the documented ceiling is the real ceiling.
 */
const COUNT_BANDS: readonly (readonly [number, number])[] = [
  [COUNTER_SIM_COUNT_MIN, 9],
  [10, 99],
  [100, 999],
  [1_000, 9_999],
  [10_000, 99_999],
  [100_000, COUNTER_SIM_COUNT_MAX],
];

/** One simulated count, inside the documented range, across all magnitudes. */
export function simulatedCount(random: RandomSource): number {
  const [min, max] = pick(random, COUNT_BANDS);
  return intBetween(random, min, max);
}

/* ------------------------------------------------------------------ */
/* The sixteen combinations                                           */
/* ------------------------------------------------------------------ */

/**
 * A combination, as a bitmask over {@link PLATFORM_ORDER}.
 *
 * Bit `i` set means `PLATFORM_ORDER[i]` is active. A mask rather than an array
 * because the two properties worth asserting — "all sixteen appear" and "none
 * follows itself" — are set membership and equality, and integers compare
 * directly while arrays would need a serialization step nobody would trust.
 */
export type CounterCombination = number;

/** Every combination, ascending. Exactly sixteen: 15 non-empty plus the empty one. */
export const COUNTER_COMBINATIONS: readonly CounterCombination[] = Array.from(
  { length: 1 << PLATFORM_ORDER.length },
  (_unused, mask) => mask,
);

/** How many states a complete rotation covers.
 *
 * Keep this derived value beside the array it measures. Importers then receive
 * one fully initialized pure module instead of evaluating `.length` against an
 * imported binding while the dev server is replacing dependent modules. */
export const COUNTER_STATE_COUNT = COUNTER_COMBINATIONS.length;

/** The platforms a mask marks active, in display order. */
export function platformsForCombination(
  combination: CounterCombination,
): readonly ViewerPlatform[] {
  return PLATFORM_ORDER.filter((_platform, index) => (combination & (1 << index)) !== 0);
}

/** The mask for a set of platforms — the inverse, for tests and for controls. */
export function combinationForPlatforms(
  platforms: readonly ViewerPlatform[],
): CounterCombination {
  return PLATFORM_ORDER.reduce(
    (mask, platform, index) => (platforms.includes(platform) ? mask | (1 << index) : mask),
    0,
  );
}

/** A readable label, for the status line. The empty state is named, not blank. */
export function combinationLabel(
  combination: CounterCombination,
  labels: Readonly<Partial<Record<ViewerPlatform, string>>> = {},
): string {
  const active = platformsForCombination(combination);
  if (active.length === 0) return 'all platforms offline';
  return active.map((platform) => labels[platform] ?? platform).join(' + ');
}

/* ------------------------------------------------------------------ */
/* The bag                                                            */
/* ------------------------------------------------------------------ */

/**
 * A shuffled bag of every combination.
 *
 * Fisher-Yates, then one guard: if the first element equals `avoid` — the last
 * combination the previous bag handed out — it is swapped with another position,
 * because otherwise the seam between two bags is the one place a combination
 * could follow itself. Swapping rather than reshuffling keeps this bounded; a
 * reshuffle-until-different loop would be unbounded in principle for no benefit.
 */
export function shuffledCombinations(
  random: RandomSource,
  avoid?: CounterCombination,
): CounterCombination[] {
  const bag = [...COUNTER_COMBINATIONS];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [bag[index], bag[swap]] = [bag[swap]!, bag[index]!];
  }
  if (avoid !== undefined && bag.length > 1 && bag[0] === avoid) {
    /* Any other slot will do, and every other slot holds a different value
       because the bag is a permutation of distinct masks. */
    const swap = 1 + Math.floor(random() * (bag.length - 1));
    [bag[0], bag[swap]] = [bag[swap]!, bag[0]!];
  }
  return bag;
}

/* ------------------------------------------------------------------ */
/* Statuses                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build the statuses for a combination, drawing a fresh count per active platform.
 *
 * An inactive platform is `offline` rather than absent or `live-unknown`, and the
 * distinction is the whole point. `visiblePlatforms` keeps `live` and
 * `live-unknown` and drops `offline`, and `summarize` reports presence for
 * `live-unknown` — so marking an inactive platform unknown would leave its pill
 * on screen showing an em dash, and the "all offline" state would render a
 * combined pill instead of nothing. `offline` is the state that actually vacates
 * the space, which is what a combination change is meant to show.
 */
export function statusesForCombination(
  combination: CounterCombination,
  random: RandomSource,
): PlatformStatuses {
  const statuses: PlatformStatuses = {};
  for (const [index, platform] of PLATFORM_ORDER.entries()) {
    statuses[platform] =
      (combination & (1 << index)) !== 0
        ? { state: 'live', viewers: simulatedCount(random) }
        : { state: 'offline' };
  }
  return statuses;
}
