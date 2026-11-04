import {
  TWITCH_CHANNEL_SEARCH_MAX_RESULTS,
  normalizeTwitchChannelSearchQuery,
  type TwitchChannelSuggestion,
} from '@/lib/twitchChannelSearch';
import {
  getTwitchAppAuthorization,
  invalidateTwitchAppAccessToken,
} from './twitchAppAccessToken';
import {
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

const TWITCH_SEARCH_URL = 'https://api.twitch.tv/helix/search/channels';
const REQUEST_TIMEOUT_MS = 8_000;
const SEARCH_RESULT_LIMIT = 20;
export const TWITCH_CHANNEL_SEARCH_MAX_BYTES = 256 * 1024;
export const TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX = 100;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const GENERIC_ERROR = 'Twitch channel search failed.';

const cache = new Map<string, { at: number; results: TwitchChannelSuggestion[] }>();
const inFlight = new Map<string, Promise<TwitchChannelSuggestion[]>>();

function parseSearchResponse(body: unknown): TwitchChannelSuggestion[] {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('data' in body)) {
    throw new Error(GENERIC_ERROR);
  }

  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data)) throw new Error(GENERIC_ERROR);

  return data.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(GENERIC_ERROR);
    }

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
      typeof isLive !== 'boolean' ||
      typeof gameName !== 'string'
    ) {
      throw new Error(GENERIC_ERROR);
    }

    try {
      if (new URL(thumbnailUrl).protocol !== 'https:') throw new Error(GENERIC_ERROR);
    } catch {
      throw new Error(GENERIC_ERROR);
    }

    return {
      broadcaster_login: login,
      display_name: displayName,
      thumbnail_url: thumbnailUrl,
      is_live: isLive,
      game_name: gameName,
    };
  });
}

function rankResults(
  query: string,
  results: TwitchChannelSuggestion[],
): TwitchChannelSuggestion[] {
  const unique = [...new Map(results.map((result) => [result.broadcaster_login, result])).values()];
  const category = (login: string) => login === query ? 0 : login.startsWith(query) ? 1 : 2;

  return unique.sort((left, right) => {
    const categoryDifference = category(left.broadcaster_login) - category(right.broadcaster_login);
    if (categoryDifference !== 0) return categoryDifference;

    const lengthDifference = left.broadcaster_login.length - right.broadcaster_login.length;
    if (lengthDifference !== 0) return lengthDifference;
    return left.broadcaster_login.localeCompare(right.broadcaster_login);
  }).slice(0, TWITCH_CHANNEL_SEARCH_MAX_RESULTS);
}

async function fetchSearch(query: string, retryUnauthorized = true): Promise<TwitchChannelSuggestion[]> {
  const authorization = await getTwitchAppAuthorization();
  const url = new URL(TWITCH_SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('first', String(SEARCH_RESULT_LIMIT));

  try {
    const result = await withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${authorization.accessToken}`,
          'Client-Id': authorization.clientId,
        },
        redirect: 'error',
        signal,
      });

      if (response.status === 401) {
        await discardFixedProviderBody(response);
        return { unauthorized: true as const };
      }
      if (!response.ok) {
        await discardFixedProviderBody(response);
        throw new Error(GENERIC_ERROR);
      }
      return {
        unauthorized: false as const,
        body: await readBoundedFixedProviderJson(
          response,
          TWITCH_CHANNEL_SEARCH_MAX_BYTES,
        ),
      };
    });

    if (result.unauthorized && retryUnauthorized) {
      invalidateTwitchAppAccessToken(authorization.accessToken);
      return fetchSearch(query, false);
    }
    if (result.unauthorized) throw new Error(GENERIC_ERROR);

    return rankResults(query, parseSearchResponse(result.body));
  } catch (error) {
    if (error instanceof Error && error.message === GENERIC_ERROR) throw error;
    throw new Error(GENERIC_ERROR);
  }
}

function store(query: string, results: TwitchChannelSuggestion[]): void {
  cache.delete(query);
  cache.set(query, { at: Date.now(), results });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export async function searchTwitchChannels(rawQuery: string): Promise<TwitchChannelSuggestion[]> {
  const query = normalizeTwitchChannelSearchQuery(rawQuery);
  if (!query) throw new Error(GENERIC_ERROR);

  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const pending = inFlight.get(query);
  if (pending) return pending;
  if (inFlight.size >= TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX) {
    throw new Error(GENERIC_ERROR);
  }

  let request: Promise<TwitchChannelSuggestion[]>;
  request = fetchSearch(query)
    .then((results) => {
      store(query, results);
      return results;
    })
    .finally(() => {
      if (inFlight.get(query) === request) inFlight.delete(query);
    });
  inFlight.set(query, request);
  return request;
}

export function __resetTwitchChannelSearchCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
