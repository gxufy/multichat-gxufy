export const YOUTUBE_CHANNEL_SEARCH_MIN_LENGTH = 3;
export const YOUTUBE_CHANNEL_SEARCH_MAX_LENGTH = 80;
export const YOUTUBE_CHANNEL_SEARCH_MAX_RESULTS = 5;
export const YOUTUBE_CHANNEL_SEARCH_DEBOUNCE_MS = 100;

const YOUTUBE_AVATAR_HOSTS = new Set([
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
]);

export type YouTubeChannelSuggestion = {
  channel_id: string;
  handle: string;
  display_name: string;
  thumbnail_url: string | null;
  subscribers: string;
  is_live: boolean;
};

export function normalizeYouTubeChannelSearchQuery(
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value
    .trim()
    .replace(/^@/, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (
    normalized.length < YOUTUBE_CHANNEL_SEARCH_MIN_LENGTH ||
    normalized.length > YOUTUBE_CHANNEL_SEARCH_MAX_LENGTH ||
    !/^[\p{L}\p{N}\p{M} ._'’&-]+$/u.test(normalized)
  ) {
    return null;
  }

  return normalized.toLocaleLowerCase('en-US');
}

export function normalizeYouTubeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  const candidate = value.startsWith('//') ? `https:${value}` : value;

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:' ||
      !YOUTUBE_AVATAR_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isValidChannelId(value: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(value);
}

function isValidHandle(value: string): boolean {
  return (
    value.startsWith('@') &&
    value.length >= 2 &&
    value.length <= 81 &&
    !/[\s/?#\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseSuggestion(value: unknown): YouTubeChannelSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const item = value as Record<string, unknown>;
  const channelId = item.channel_id;
  const handle = item.handle;
  const displayName = item.display_name;
  const thumbnailUrl = item.thumbnail_url;
  const subscribers = item.subscribers;
  const isLive = item.is_live;
  const parsedThumbnailUrl = thumbnailUrl === null
    ? null
    : normalizeYouTubeAvatarUrl(thumbnailUrl);

  if (
    typeof channelId !== 'string' ||
    !isValidChannelId(channelId) ||
    typeof handle !== 'string' ||
    !isValidHandle(handle) ||
    typeof displayName !== 'string' ||
    !displayName.trim() ||
    displayName.length > 100 ||
    !(thumbnailUrl === null || (
      typeof thumbnailUrl === 'string' &&
      parsedThumbnailUrl === thumbnailUrl
    )) ||
    typeof subscribers !== 'string' ||
    subscribers.length > 80 ||
    typeof isLive !== 'boolean'
  ) {
    return null;
  }

  return {
    channel_id: channelId,
    handle,
    display_name: displayName,
    thumbnail_url: parsedThumbnailUrl,
    subscribers,
    is_live: isLive,
  };
}

export function parseYouTubeChannelSuggestions(
  value: unknown,
): YouTubeChannelSuggestion[] | null {
  if (
    !Array.isArray(value) ||
    value.length > YOUTUBE_CHANNEL_SEARCH_MAX_RESULTS
  ) {
    return null;
  }

  const parsed = value.map(parseSuggestion);
  return parsed.every(
    (item): item is YouTubeChannelSuggestion => item !== null,
  )
    ? parsed
    : null;
}
