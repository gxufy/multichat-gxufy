export const KICK_CHANNEL_SEARCH_MIN_LENGTH = 3;
export const KICK_CHANNEL_SEARCH_MAX_LENGTH = 80;
export const KICK_CHANNEL_SEARCH_MAX_RESULTS = 5;
export const KICK_CHANNEL_SEARCH_DEBOUNCE_MS = 100;

export type KickChannelSuggestion = {
  slug: string;
  display_name: string;
  thumbnail_url: string | null;
  is_live: boolean;
  followers_count: number;
  verified: boolean;
};

export function normalizeKickChannelSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/^@/, '').toLowerCase();

  if (
    normalized.length < KICK_CHANNEL_SEARCH_MIN_LENGTH ||
    normalized.length > KICK_CHANNEL_SEARCH_MAX_LENGTH ||
    !/^[a-z0-9_-]+$/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseSuggestion(value: unknown): KickChannelSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const item = value as Record<string, unknown>;

  const slug = item.slug;
  const displayName = item.display_name;
  const thumbnailUrl = item.thumbnail_url;
  const isLive = item.is_live;
  const followersCount = item.followers_count;
  const verified = item.verified;

  if (
    typeof slug !== 'string' ||
    slug !== slug.toLowerCase() ||
    !/^[a-z0-9_-]{1,80}$/.test(slug) ||
    typeof displayName !== 'string' ||
    !displayName.trim() ||
    !(thumbnailUrl === null || (
      typeof thumbnailUrl === 'string' &&
      isHttpsUrl(thumbnailUrl)
    )) ||
    typeof isLive !== 'boolean' ||
    typeof followersCount !== 'number' ||
    !Number.isFinite(followersCount) ||
    followersCount < 0 ||
    typeof verified !== 'boolean'
  ) {
    return null;
  }

  return {
    slug,
    display_name: displayName,
    thumbnail_url: thumbnailUrl,
    is_live: isLive,
    followers_count: Math.floor(followersCount),
    verified,
  };
}

export function parseKickChannelSuggestions(
  value: unknown,
): KickChannelSuggestion[] | null {
  if (
    !Array.isArray(value) ||
    value.length > KICK_CHANNEL_SEARCH_MAX_RESULTS
  ) {
    return null;
  }

  const parsed = value.map(parseSuggestion);

  return parsed.every(
    (item): item is KickChannelSuggestion => item !== null,
  )
    ? parsed
    : null;
}
