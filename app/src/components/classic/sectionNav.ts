/* The generator's section bar: its stops and the "you are here" rule. */
export const GENERATOR_SECTIONS = [
  { id: 'channels', label: 'Channels' },
  { id: 'settings', label: 'Settings' },
  { id: 'commands', label: 'Commands' },
  { id: 'obs-setup', label: 'OBS setup' },
] as const;

export type GeneratorSectionId = (typeof GENERATOR_SECTIONS)[number]['id'];

/** Pixels under the sticky bar a section top must pass to count as "current". */
export const ACTIVE_OFFSET_PX = 80;

/**
 * Which section the reader is in: the lowest section whose top has scrolled
 * past the bar. Sections that share a row (Chat and Viewer counter on a
 * desktop) resolve to the first. At the very bottom of the page the last
 * section on screen wins, since short final sections can never reach the top.
 */
export function currentSection(
  ids: readonly string[],
  topOf: (id: string) => number | undefined,
  viewportHeight: number,
  atBottom: boolean,
): string {
  let current = ids[0] ?? '';
  let currentTop = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const top = topOf(id);
    if (top === undefined) continue;
    const reached = top <= ACTIVE_OFFSET_PX || (atBottom && top < viewportHeight);
    if (reached && top > currentTop + 1) {
      current = id;
      currentTop = top;
    }
    if (atBottom && reached) current = id;
  }
  return current;
}
