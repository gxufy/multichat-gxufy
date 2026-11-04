export const TWITCH_CHANNEL_SEARCH_MIN_LENGTH = 3;
export const TWITCH_CHANNEL_SEARCH_MAX_LENGTH = 25;
export const TWITCH_CHANNEL_SEARCH_MAX_RESULTS = 5;
export const TWITCH_CHANNEL_SEARCH_DEBOUNCE_MS = 100;

export type TwitchChannelSuggestion = {
  broadcaster_login: string;
  display_name: string;
  thumbnail_url: string;
  is_live: boolean;
  game_name: string;
};

export function normalizeTwitchChannelSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/^@/, '').toLowerCase();
  if (
    normalized.length < TWITCH_CHANNEL_SEARCH_MIN_LENGTH ||
    normalized.length > TWITCH_CHANNEL_SEARCH_MAX_LENGTH ||
    !/^[a-z0-9_]+$/.test(normalized)
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

function parseSuggestion(value: unknown): TwitchChannelSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const login = item.broadcaster_login;
  const displayName = item.display_name;
  const thumbnailUrl = item.thumbnail_url;
  const isLive = item.is_live;
  const gameName = item.game_name;

  if (
    typeof login !== 'string' ||
    login !== login.toLowerCase() ||
    !/^[a-z0-9_]{1,25}$/.test(login) ||
    typeof displayName !== 'string' ||
    displayName.trim().length === 0 ||
    typeof thumbnailUrl !== 'string' ||
    !isHttpsUrl(thumbnailUrl) ||
    typeof isLive !== 'boolean' ||
    typeof gameName !== 'string'
  ) {
    return null;
  }

  return {
    broadcaster_login: login,
    display_name: displayName,
    thumbnail_url: thumbnailUrl,
    is_live: isLive,
    game_name: gameName,
  };
}

export function parseTwitchChannelSuggestions(value: unknown): TwitchChannelSuggestion[] | null {
  if (!Array.isArray(value) || value.length > TWITCH_CHANNEL_SEARCH_MAX_RESULTS) return null;

  const parsed = value.map(parseSuggestion);
  return parsed.every((item): item is TwitchChannelSuggestion => item !== null)
    ? parsed
    : null;
}
