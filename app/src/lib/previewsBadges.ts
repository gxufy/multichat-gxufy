export const PREVIEWS_BADGE_THRESHOLDS = [
  0,
  1,
  3,
  6,
  12,
  24,
  36,
  48,
] as const;

export type PreviewsBadgeThreshold =
  (typeof PREVIEWS_BADGE_THRESHOLDS)[number];

export type PreviewsResolvedBadge = {
  hash: string;
  months: number;
  threshold: PreviewsBadgeThreshold;
  url: string;
  title: string;
};

const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

export function normalizePreviewsTwitchLogin(value: string): string {
  return value.trim().toLowerCase();
}

export function previewsBadgeThresholdForMonths(
  months: number,
): PreviewsBadgeThreshold | null {
  if (!Number.isInteger(months) || months < 0) return null;

  let selected: PreviewsBadgeThreshold = 0;

  for (const threshold of PREVIEWS_BADGE_THRESHOLDS) {
    if (months < threshold) break;
    selected = threshold;
  }

  return selected;
}

export function previewsBadgeAssetForMonths(
  months: number,
): string | null {
  const threshold = previewsBadgeThresholdForMonths(months);

  return threshold === null
    ? null
    : `/badges/previews/badge_m${threshold}.webp`;
}

export function previewsBadgeTitle(months: number): string {
  return months >= 1
    ? `Previews Subscriber  ${months}mo`
    : 'Previews Subscriber';
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function resolvePreviewsBadge(
  login: string,
  twitchAssignments: Readonly<Record<string, number>>,
): Promise<PreviewsResolvedBadge | null> {
  const normalized = normalizePreviewsTwitchLogin(login);

  if (!TWITCH_LOGIN_RE.test(normalized)) return null;

  const hash = await sha256Hex(normalized);
  const months = twitchAssignments[hash];

  if (!Number.isInteger(months) || months < 0) return null;

  const threshold = previewsBadgeThresholdForMonths(months);
  const url = previewsBadgeAssetForMonths(months);

  if (threshold === null || !url) return null;

  return {
    hash,
    months,
    threshold,
    url,
    title: previewsBadgeTitle(months),
  };
}