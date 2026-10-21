/* Deterministic sample viewer counts for the generator's built-in preview.
 *
 * These are `PlatformStatuses` values — the same per-platform shape
 * `/api/viewers` results are folded into before `ViewerCounterDisplay` sees
 * them. The preview therefore feeds the production renderer exactly what the
 * live overlay feeds it, and every counter setting behaves here as it will in
 * OBS because the code deciding that is the same code: combined and separate
 * modes, icons, alignment, the pill background, the text shadow, the outline,
 * and the rolling number's own grouping all come from the renderer.
 *
 * The numbers are formatted by that renderer, not here. `RollingCount` calls
 * `toLocaleString()`, so the thousands separator a user sees in the preview is
 * produced by the authoritative formatter rather than restated by a fixture.
 *
 * DETERMINISM. Fixed literals, no Date.now, no Math.random, no network. The
 * preview paints identically on every render and in every test run.
 *
 * The values are clearly fictional but plausibly shaped, and at least one is
 * large enough to show grouping in both combined and separate modes — a
 * four-figure sample would have hidden whether the separator works at all.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import { PLATFORM_ORDER, type PlatformStatuses, type ViewerPlatform } from '@/lib/viewerCounterConfig';

/**
 * The built-in sample counts, per platform.
 *
 * Every platform is `live` with a measured number rather than one being left
 * offline or unavailable. Those two states are worth being able to see, and the
 * renderer draws them from the same statuses — but an em dash or a missing pill
 * in the *initial* preview is indistinguishable from the empty frame this
 * replaces, so the default set measures all four. Setting a count to nothing
 * reaches the unavailable presentation from the controls.
 */
export const SAMPLE_COUNTER_COUNTS: Readonly<Record<ViewerPlatform, number>> = {
  twitch: 12_480,
  youtube: 3_907,
  kick: 1_268,
  tiktok: 842,
};

/** Largest value the preview controls accept. Above this, grouping is proven. */
export const COUNTER_COUNT_MAX = 9_999_999;

/**
 * Build statuses from a set of counts.
 *
 * A platform whose count is absent becomes `live-unknown`, which is how the
 * renderer is told "present, but not countable" — the state that draws the em
 * dash. Passing no counts at all yields the built-in set.
 */
export function sampleCounterStatuses(
  counts: Partial<Record<ViewerPlatform, number>> = SAMPLE_COUNTER_COUNTS,
): PlatformStatuses {
  const statuses: PlatformStatuses = {};
  for (const platform of PLATFORM_ORDER) {
    const value = counts[platform];
    statuses[platform] =
      typeof value === 'number' ? { state: 'live', viewers: value } : { state: 'live-unknown' };
  }
  return statuses;
}

/**
 * Parse a typed preview count.
 *
 * Returns the integer, or null for anything that is not a safe non-negative
 * whole number within range — including the empty field, which the controls
 * treat as "not countable" rather than as zero. Deliberately strict about the
 * string form as well as the value: `Number('1e9')` and `Number(' 12 ')` are
 * both finite, and neither is something a person typed into a count field.
 */
export function parseCounterCount(raw: string): number | null {
  if (!/^\d{1,7}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= COUNTER_COUNT_MAX ? value : null;
}
