/*
 * A setting written twice in an overlay address (`animation=slide&...&animation=fade`,
 * easy to do when editing a URL by hand) arrives as a list. The overlays use
 * the last one, the way a later setting replaces an earlier one, instead of
 * refusing the whole address.
 */

/** The last text value of a query parameter that may repeat. */
export function lastQueryValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (typeof value[index] === 'string') return value[index];
  }
  return undefined;
}

/** A copy of a query object with every repeated parameter reduced to its last value. */
export function lastQueryValues(query: unknown): unknown {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return query;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) out[key] = lastQueryValue(value);
  return out;
}
