/* Shared primitives for the generator's preview simulators.
 *
 * WHY THIS MODULE EXISTS. Two simulators need the same three things: a source of
 * randomness that a test can pin down, integer/choice helpers built on it, and
 * the named speed a control on the page offers. The chat feed had them first,
 * privately. Having the Viewer Counter import them *from the chat module* would
 * make the counter depend on MultiChat's message pool for a random number, and
 * the next reader would be right to wonder what the coupling meant. So they live
 * here, in one place both tools sit above.
 *
 * DETERMINISM IS A PARAMETER, NOT A PROPERTY. `Math.random` is never called at
 * module scope and never inside a generator. Callers pass a `RandomSource`; the
 * page passes one backed by `Math.random`, tests pass {@link seededRandom}. That
 * is what turns "every combination is reachable" and "the interval stays in
 * range" into facts a test can assert rather than samples it hopes for.
 *
 * Browser-safe — no server-only imports, no secrets, no network.
 */

/** A source of randomness, so a caller can be deterministic. */
export type RandomSource = () => number;

/**
 * A seeded generator (mulberry32), for tests and for any caller that needs the
 * same sequence twice.
 *
 * Chosen over `Math.random` in tests for the obvious reason and over a
 * hand-rolled LCG for a less obvious one: a poor generator correlates successive
 * values, and both simulators draw several in a row per step (a pool slot then
 * further decisions; a combination then four counts). Correlation there would
 * quietly bias which fixtures ever appear, so a test asserting "all four
 * platforms are reachable" could pass on the seed it was written against and
 * fail on the next.
 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer in [min, max], inclusive at both ends. */
export function intBetween(random: RandomSource, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One item. Falls back to the first, so a source returning exactly 1 is safe. */
export function pick<T>(random: RandomSource, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] ?? items[0];
}

/** How fast a simulator runs. Named, because it is a control on the page. */
export type PreviewSpeed = 'slow' | 'normal' | 'fast';

export const PREVIEW_SPEEDS: readonly PreviewSpeed[] = ['slow', 'normal', 'fast'];

/**
 * Multipliers applied to a simulator's interval band.
 *
 * Normal is exactly the documented range, so each simulator states its own band
 * once and the speeds scale it rather than each speed carrying its own pair of
 * literals to keep in sync.
 */
export const SPEED_FACTOR: Record<PreviewSpeed, number> = {
  slow: 2,
  normal: 1,
  fast: 0.5,
};

/** The band a speed draws from, given a Normal band. */
export function speedBounds(
  speed: PreviewSpeed,
  minMs: number,
  maxMs: number,
): { min: number; max: number } {
  const factor = SPEED_FACTOR[speed];
  return { min: Math.round(minMs * factor), max: Math.round(maxMs * factor) };
}

/** A randomized delay inside the given speed's band. */
export function speedDelay(
  random: RandomSource,
  speed: PreviewSpeed,
  minMs: number,
  maxMs: number,
): number {
  const { min, max } = speedBounds(speed, minMs, maxMs);
  /* Drawn per step rather than kept as one fixed period: a constant cadence
     reads as a machine, and the point of both simulators is to look alive. */
  return intBetween(random, min, max);
}
