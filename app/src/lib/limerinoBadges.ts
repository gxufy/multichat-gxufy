export type LimerinoBadgeFormat = 'WEBP' | 'GIF' | 'PNG';

export type LimerinoBadgeFile = {
  name: string;
  staticName?: string;
  width: 18 | 36 | 54 | 72;
  height: 18 | 36 | 54 | 72;
  frameCount: number;
  format: LimerinoBadgeFormat;
};

export type LimerinoBadgeRecord = {
  id: string;
  title: string;
  host: string;
  files: LimerinoBadgeFile[];
  users: string[];
};

export type LimerinoBadgeRenderOptions = {
  slotSizePx: number;
  displayScale: number;
  reducedMotion: boolean;
};

export type LimerinoBadgeImage = {
  url: string;
  fallbackUrl: string;
  width: number;
  animated: boolean;
};

const IMAGE_WIDTHS = new Set([18, 36, 54, 72]);
const FORMAT_PRIORITY: Readonly<Record<LimerinoBadgeFormat, number>> = {
  WEBP: 0,
  GIF: 1,
  PNG: 2,
};
const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const TWITCH_USER_ID = /^\d{1,25}$/;
const BADGE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : '';
}

export function normalizeLimerinoArtHost(value: unknown): string | null {
  const raw = boundedText(value, 1_024);
  if (!raw) return null;
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const url = new URL(absolute);
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'api.limerino.com'
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
      || !url.pathname.startsWith('/v1/badges/art/')
    ) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function parseLimerinoFile(value: unknown): LimerinoBadgeFile | null {
  if (!isRecord(value)) return null;
  const name = boundedText(value.name, 128);
  const staticName = boundedText(value.staticName ?? value.static_name, 128);
  const width = Number(value.width);
  const height = Number(value.height);
  const frameCount = Number(value.frameCount ?? value.frame_count);
  const format = boundedText(value.format, 8).toUpperCase() as LimerinoBadgeFormat;
  if (
    !FILE_NAME.test(name)
    || (staticName && !FILE_NAME.test(staticName))
    || !IMAGE_WIDTHS.has(width)
    || height !== width
    || !Number.isSafeInteger(frameCount)
    || frameCount < 1
    || !(format in FORMAT_PRIORITY)
  ) return null;
  return {
    name,
    ...(staticName ? { staticName } : {}),
    width: width as LimerinoBadgeFile['width'],
    height: height as LimerinoBadgeFile['height'],
    frameCount,
    format,
  };
}

/** Validate the normalized same-origin API response before browser use. */
export function parseLimerinoBadgeRecords(value: unknown): LimerinoBadgeRecord[] {
  if (!Array.isArray(value)) return [];
  const badges: LimerinoBadgeRecord[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = boundedText(raw.id, 100);
    const title = boundedText(raw.title, 160);
    const host = normalizeLimerinoArtHost(raw.host);
    const files = Array.isArray(raw.files)
      ? raw.files.map(parseLimerinoFile).filter((file): file is LimerinoBadgeFile => file !== null)
      : [];
    const users = Array.isArray(raw.users)
      ? [...new Set(raw.users.filter((user): user is string => (
        typeof user === 'string' && TWITCH_USER_ID.test(user)
      )))]
      : [];
    if (!BADGE_ID.test(id) || seen.has(id) || !title || !host || !files.length) continue;
    seen.add(id);
    badges.push({ id, title, host, files, users });
  }
  return badges;
}

function assetUrl(host: string, name: string): string {
  return `${host}/${name}`;
}

function chooseWidth(files: readonly LimerinoBadgeFile[], requiredPixels: number): number {
  const widths = [...new Set(files.map((file) => file.width))].sort((a, b) => a - b);
  return widths.find((width) => width >= requiredPixels) ?? widths.at(-1) ?? 72;
}

export function selectLimerinoBadgeImage(
  badge: LimerinoBadgeRecord,
  options: LimerinoBadgeRenderOptions,
): LimerinoBadgeImage | null {
  const slotSize = Number.isFinite(options.slotSizePx) && options.slotSizePx > 0
    ? options.slotSizePx
    : 18;
  const displayScale = Number.isFinite(options.displayScale) && options.displayScale > 0
    ? Math.min(options.displayScale, 4)
    : 1;
  const width = chooseWidth(badge.files, slotSize * displayScale);
  const atWidth = badge.files
    .filter((file) => file.width === width)
    .sort((a, b) => FORMAT_PRIORITY[a.format] - FORMAT_PRIORITY[b.format]);
  const png = atWidth.find((file) => file.format === 'PNG');
  if (!atWidth.length || !png) return null;

  const preferred = atWidth[0]!;
  let selectedName = preferred.name;
  let animated = preferred.frameCount > 1;
  if (options.reducedMotion && animated) {
    selectedName = preferred.staticName ?? png.name;
    animated = false;
  }

  return {
    url: assetUrl(badge.host, selectedName),
    fallbackUrl: assetUrl(badge.host, png.name),
    width,
    animated,
  };
}

export function multichatBadgeSlotSizePx(textSize: unknown, textSizePx: unknown): number {
  const custom = Number(textSizePx);
  if (Number.isFinite(custom) && custom > 0) return 28 * custom / 34;
  if (textSize === 'small') return 16;
  if (textSize === 'large') return 40;
  return 28;
}
