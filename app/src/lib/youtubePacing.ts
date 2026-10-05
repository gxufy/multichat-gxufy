/** YouTube continuation actions are paced so one upstream batch does not render at once. */
export const YOUTUBE_DELIVERY_INTERVAL_MS = 150;
export const YOUTUBE_DELIVERY_WINDOW_MS = 1_200;
export const YOUTUBE_DELIVERY_MIN_INTERVAL_MS = 40;

export function youtubeDeliveryIntervalMs(actionCount: number): number {
  if (!Number.isFinite(actionCount) || actionCount <= 0) return 0;
  return Math.max(
    YOUTUBE_DELIVERY_MIN_INTERVAL_MS,
    Math.min(YOUTUBE_DELIVERY_INTERVAL_MS, Math.floor(YOUTUBE_DELIVERY_WINDOW_MS / actionCount)),
  );
}

export function youtubePlannedDeliverySpanMs(actionCount: number): number {
  if (!Number.isFinite(actionCount) || actionCount <= 1) return 0;
  return youtubeDeliveryIntervalMs(actionCount) * (Math.trunc(actionCount) - 1);
}
