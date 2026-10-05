export const DEFAULT_TWITCH_GIF_SIZE_PX = 100;
export const MIN_TWITCH_GIF_SIZE_PX = 16;
export const MAX_TWITCH_GIF_SIZE_PX = 512;

/** Normalize the public gifSize= setting to a bounded pixel value. */
export function normalizeTwitchGifSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return DEFAULT_TWITCH_GIF_SIZE_PX;
  return Math.min(MAX_TWITCH_GIF_SIZE_PX, Math.max(MIN_TWITCH_GIF_SIZE_PX, Math.round(parsed)));
}
