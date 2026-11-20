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
const TWITCH_STREAMS_URL = 'https://api.twitch.tv/helix/streams';
const TWITCH_SHARED_CHAT_URL = 'https://api.twitch.tv/helix/shared_chat/session';
/* Optional live details (viewers, current category, shared chat) never hold up
   the search for long and never fail it. */
const ENRICH_TIMEOUT_MS = 3_000;
const ENRICH_MAX_BYTES = 64 * 1024;
const SHARED_CHAT_CACHE_TTL_MS = 60_000;
const SHARED_CHAT_CACHE_MAX_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 8_000;
const SEARCH_RESULT_LIMIT = 20;
export const TWITCH_CHANNEL_SEARCH_MAX_BYTES = 256 * 1024;
export const TWITCH_CHANNEL_SEARCH_IN_FLIGHT_MAX = 100;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const GENERIC_ERROR = 'Twitch channel search failed.';

const cache = new Map<string, { at: number; results: TwitchChannelSuggestion[] }>();
/* broadcaster id -> channels in their shared chat session (null = not in one). */
const sharedChatCache = new Map<string, { at: number; channels: number | null }>();

/** A parsed search hit plus the broadcaster id, which is used server-side only. */
type RankedSuggestion = TwitchChannelSuggestion & { broadcasterId: string | null };
const inFlight = new Map<string, Promise<TwitchChannelSuggestion[]>>();

function parseSearchResponse(body: unknown): RankedSuggestion[] {
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

    const rawId = item.id;
    return {
      broadcaster_login: login,
      display_name: displayName,
      thumbnail_url: thumbnailUrl,
      is_live: isLive,
      game_name: gameName,
      broadcasterId: typeof rawId === 'string' && /^\d{1,20}$/.test(rawId) ? rawId : null,
    };
  });
}

function rankResults(
  query: string,
  results: RankedSuggestion[],
): RankedSuggestion[] {
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

    const ranked = rankResults(query, parseSearchResponse(result.body));
    return await enrichLiveResults(ranked, authorization);
  } catch (error) {
    if (error instanceof Error && error.message === GENERIC_ERROR) throw error;
    throw new Error(GENERIC_ERROR);
  }
}

type Authorization = Awaited<ReturnType<typeof getTwitchAppAuthorization>>;

async function helixGet(url: URL, authorization: Authorization): Promise<unknown | null> {
  try {
    return await withFixedProviderTimeout(ENRICH_TIMEOUT_MS, async (signal) => {
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${authorization.accessToken}`,
          'Client-Id': authorization.clientId,
        },
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        await discardFixedProviderBody(response);
        return null;
      }
      return readBoundedFixedProviderJson(response, ENRICH_MAX_BYTES);
    });
  } catch {
    return null;
  }
}

function dataArray(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const data = (body as Record<string, unknown>).data;
  return Array.isArray(data)
    ? data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

async function sharedChatChannels(broadcasterId: string, authorization: Authorization): Promise<number | null | undefined> {
  const cached = sharedChatCache.get(broadcasterId);
  if (cached && Date.now() - cached.at < SHARED_CHAT_CACHE_TTL_MS) return cached.channels;
  const url = new URL(TWITCH_SHARED_CHAT_URL);
  url.searchParams.set('broadcaster_id', broadcasterId);
  const body = await helixGet(url, authorization);
  if (body === null) return undefined;
  const session = dataArray(body)[0];
  const participants = session && Array.isArray(session.participants) ? session.participants.length : 0;
  const channels = participants >= 2 ? participants : null;
  sharedChatCache.delete(broadcasterId);
  sharedChatCache.set(broadcasterId, { at: Date.now(), channels });
  while (sharedChatCache.size > SHARED_CHAT_CACHE_MAX_ENTRIES) {
    const oldest = sharedChatCache.keys().next();
    if (oldest.done) break;
    sharedChatCache.delete(oldest.value);
  }
  return channels;
}

/**
 * Adds what the dropdown shows next to a live channel: viewer count and current
 * category (one batched /streams call) and whether it is in a Twitch Shared Chat
 * session. Best-effort: anything that fails is simply left out.
 */
async function enrichLiveResults(
  results: RankedSuggestion[],
  authorization: Authorization,
): Promise<TwitchChannelSuggestion[]> {
  const live = results.filter((result) => result.is_live && result.broadcasterId);
  const streams = new Map<string, { viewers: number; category: string }>();
  const shared = new Map<string, number>();

  if (live.length) {
    const url = new URL(TWITCH_STREAMS_URL);
    for (const result of live) url.searchParams.append('user_id', result.broadcasterId!);
    url.searchParams.set('first', String(live.length));
    const [streamsBody, sharedCounts] = await Promise.all([
      helixGet(url, authorization),
      Promise.all(live.map((result) => sharedChatChannels(result.broadcasterId!, authorization))),
    ]);
    for (const stream of dataArray(streamsBody)) {
      const userId = stream.user_id;
      const viewers = stream.viewer_count;
      if (typeof userId !== 'string' || typeof viewers !== 'number' || !Number.isSafeInteger(viewers) || viewers < 0) continue;
      streams.set(userId, { viewers, category: typeof stream.game_name === 'string' ? stream.game_name : '' });
    }
    live.forEach((result, index) => {
      const channels = sharedCounts[index];
      if (typeof channels === 'number') shared.set(result.broadcasterId!, channels);
    });
  }

  return results.map(({ broadcasterId, ...suggestion }) => {
    const stream = broadcasterId ? streams.get(broadcasterId) : undefined;
    const channels = broadcasterId ? shared.get(broadcasterId) : undefined;
    return {
      ...suggestion,
      ...(stream?.category ? { game_name: stream.category } : {}),
      ...(stream ? { viewer_count: stream.viewers } : {}),
      ...(channels ? { shared_chat_channels: channels } : {}),
    };
  });
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
  sharedChatCache.clear();
  inFlight.clear();
}
