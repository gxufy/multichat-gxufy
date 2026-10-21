/* MultiChat browser-source sizes, in one place.
 *
 * 830 × 230 is the single user-facing recommended OBS size for MultiChat.
 * The 680 × 280 value remains the generator's internal preview viewport so this
 * documentation-only recommendation change does not alter preview density or
 * existing descriptor geometry.
 */

/** Internal generator/descriptor preview viewport. Not an OBS recommendation. */
export const MULTICHAT_OBS_SIZE = { width: 680, height: 280 } as const;

/** The only recommended MultiChat browser-source size for OBS and marketplaces. */
export const MULTICHAT_OBS_RECOMMENDED = { width: 830, height: 230 } as const;
