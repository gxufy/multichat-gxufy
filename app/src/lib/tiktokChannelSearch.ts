export const TIKTOK_CHANNEL_SEARCH_MIN_LENGTH = 3;
export const TIKTOK_CHANNEL_SEARCH_MAX_LENGTH = 256;
export const TIKTOK_CHANNEL_USERNAME_MAX_LENGTH = 50;
export const TIKTOK_CHANNEL_SEARCH_MAX_RESULTS = 1;
export const TIKTOK_CHANNEL_SEARCH_DEBOUNCE_MS = 325;

const TIKTOK_PROFILE_HOSTS = new Set(['tiktok.com', 'www.tiktok.com']);
const TIKTOK_AVATAR_HOSTS = new Set([
  'p16-common-sign.tiktokcdn-us.com',
  'p19-common-sign.tiktokcdn-us.com',
]);
const TIKTOK_USERNAME_PATTERN = /^[A-Za-z0-9._]+$/;

export type TikTokChannelSuggestion = {
  username: string;
  display_name: string;
  thumbnail_url: string | null;
  followers_count: number;
  verified: boolean;
  is_live: false;
};

export function isValidTikTokUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= TIKTOK_CHANNEL_USERNAME_MAX_LENGTH &&
    TIKTOK_USERNAME_PATTERN.test(value)
  );
}

function usernameFromProfileUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    !TIKTOK_PROFILE_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  const match = /^\/@([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function normalizeTikTokChannelSearchQuery(
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (
    trimmed.length > TIKTOK_CHANNEL_SEARCH_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }

  let username: string | null;
  if (/^https?:\/\//i.test(trimmed)) {
    username = usernameFromProfileUrl(trimmed);
  } else if (trimmed.startsWith('//') || trimmed.includes('://')) {
    username = null;
  } else {
    username = trimmed.replace(/^@/, '');
  }

  if (
    !username ||
    username.length < TIKTOK_CHANNEL_SEARCH_MIN_LENGTH ||
    !isValidTikTokUsername(username)
  ) {
    return null;
  }

  return username.toLocaleLowerCase('en-US');
}

export function normalizeTikTokAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !TIKTOK_AVATAR_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function parseSuggestion(value: unknown): TikTokChannelSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const item = value as Record<string, unknown>;
  const username = item.username;
  const displayName = item.display_name;
  const thumbnailUrl = item.thumbnail_url;
  const followersCount = item.followers_count;
  const verified = item.verified;
  const isLive = item.is_live;
  const parsedThumbnailUrl = thumbnailUrl === null
    ? null
    : normalizeTikTokAvatarUrl(thumbnailUrl);

  if (
    !isValidTikTokUsername(username) ||
    typeof displayName !== 'string' ||
    !displayName.trim() ||
    displayName.length > 100 ||
    !(thumbnailUrl === null || (
      typeof thumbnailUrl === 'string' &&
      parsedThumbnailUrl === thumbnailUrl
    )) ||
    typeof followersCount !== 'number' ||
    !Number.isSafeInteger(followersCount) ||
    followersCount < 0 ||
    typeof verified !== 'boolean' ||
    isLive !== false
  ) {
    return null;
  }

  return {
    username,
    display_name: displayName,
    thumbnail_url: parsedThumbnailUrl,
    followers_count: followersCount,
    verified,
    is_live: false,
  };
}

export function parseTikTokChannelSuggestions(
  value: unknown,
): TikTokChannelSuggestion[] | null {
  if (
    !Array.isArray(value) ||
    value.length > TIKTOK_CHANNEL_SEARCH_MAX_RESULTS
  ) {
    return null;
  }

  const parsed = value.map(parseSuggestion);
  return parsed.every(
    (item): item is TikTokChannelSuggestion => item !== null,
  )
    ? parsed
    : null;
}
