import {
  KICK_CHANNEL_SEARCH_MAX_RESULTS,
  normalizeKickChannelSearchQuery,
  type KickChannelSuggestion,
} from '@/lib/kickChannelSearch';
import {
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

const KICK_TYPESENSE_URL =
  'https://search.kick.com/multi_search';

const KICK_CHANNEL_PROFILE_URL =
  'https://api.kick.com/private/v1/channels';

const REQUEST_TIMEOUT_MS = 8_000;
export const KICK_CHANNEL_SEARCH_MAX_BYTES = 512 * 1024;
export const KICK_CHANNEL_PROFILE_MAX_BYTES = 128 * 1024;
export const KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX = 100;
export const KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX = 100;

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

const PROFILE_CACHE_TTL_MS = 10 * 60_000;
const PROFILE_CACHE_MAX_ENTRIES = 1_000;

const GENERIC_ERROR =
  'Kick channel search failed.';

const cache = new Map<
  string,
  {
    at: number;
    results: KickChannelSuggestion[];
  }
>();

const inFlight = new Map<
  string,
  Promise<KickChannelSuggestion[]>
>();

const profileCache = new Map<
  string,
  {
    at: number;
    url: string | null;
  }
>();

const profileInFlight = new Map<
  string,
  Promise<string | null>
>();

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function safeCount(value: unknown): number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  )
    ? Math.floor(value)
    : 0;
}

function safeKickImage(
  value: unknown,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'files.kick.com'
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function mapTypesenseDocument(
  value: unknown,
): KickChannelSuggestion | null {
  if (!isObject(value)) return null;

  if (value.is_banned === true) {
    return null;
  }

  const rawSlug = value.slug;

  if (typeof rawSlug !== 'string') {
    return null;
  }

  const slug =
    rawSlug.trim().toLowerCase();

  if (
    !/^[a-z0-9_-]{1,80}$/.test(slug)
  ) {
    return null;
  }

  const displayName =
    typeof value.username === 'string' &&
    value.username.trim()
      ? value.username.trim()
      : slug;

  return {
    slug,
    display_name: displayName,
    thumbnail_url: null,
    is_live:
      value.is_live === true,
    followers_count:
      safeCount(value.followers_count),
    verified:
      value.verified === true,
  };
}

function rankResults(
  query: string,
  results: KickChannelSuggestion[],
): KickChannelSuggestion[] {
  const unique = [
    ...new Map(
      results.map((result) => [
        result.slug,
        result,
      ]),
    ).values(),
  ];

  const category = (slug: string) =>
    slug === query
      ? 0
      : slug.startsWith(query)
        ? 1
        : 2;

  return unique
    .sort((left, right) => {
      const categoryDifference =
        category(left.slug) -
        category(right.slug);

      if (categoryDifference !== 0) {
        return categoryDifference;
      }

      const lengthDifference =
        left.slug.length -
        right.slug.length;

      if (lengthDifference !== 0) {
        return lengthDifference;
      }

      return left.slug.localeCompare(
        right.slug,
      );
    })
    .slice(
      0,
      KICK_CHANNEL_SEARCH_MAX_RESULTS,
    );
}

function storeProfile(
  slug: string,
  url: string | null,
): void {
  profileCache.delete(slug);

  profileCache.set(slug, {
    at: Date.now(),
    url,
  });

  while (
    profileCache.size >
    PROFILE_CACHE_MAX_ENTRIES
  ) {
    const oldest =
      profileCache.keys().next();

    if (oldest.done) break;

    profileCache.delete(
      oldest.value,
    );
  }
}

async function fetchKickProfilePicture(
  slug: string,
): Promise<string | null> {
  const cached =
    profileCache.get(slug);

  if (
    cached &&
    Date.now() - cached.at <
      PROFILE_CACHE_TTL_MS
  ) {
    return cached.url;
  }

  const pending =
    profileInFlight.get(slug);

  if (pending) {
    return pending;
  }
  if (
    profileInFlight.size >=
    KICK_CHANNEL_PROFILE_IN_FLIGHT_MAX
  ) {
    return null;
  }

  let request: Promise<string | null>;

  request = (async () => {
    try {
      const avatar = await withFixedProviderTimeout(
        REQUEST_TIMEOUT_MS,
        async (signal) => {
          const response = await fetch(
            `${KICK_CHANNEL_PROFILE_URL}/${encodeURIComponent(slug)}`,
            {
              method: 'GET',

              headers: {
                Accept: 'application/json',

                Origin:
                  'https://kick.com',

                Referer:
                  'https://kick.com/',

                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                  'AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
              },

              cache: 'no-store',
              redirect: 'error',
              signal,
            },
          );

          if (!response.ok) {
            await discardFixedProviderBody(response);
            return null;
          }

          const body = await readBoundedFixedProviderJson(
            response,
            KICK_CHANNEL_PROFILE_MAX_BYTES,
          );
          if (!isObject(body)) return null;

          const data = body.data;
          if (!isObject(data)) return null;

          const account = data.account;
          if (!isObject(account)) return null;

          const user = account.user;
          if (!isObject(user)) return null;

          return safeKickImage(
            user.profile_picture,
          );
        },
      );

      storeProfile(
        slug,
        avatar,
      );

      return avatar;
    } catch {
      storeProfile(slug, null);
      return null;
    }
  })().finally(() => {
    if (
      profileInFlight.get(slug) ===
      request
    ) {
      profileInFlight.delete(slug);
    }
  });

  profileInFlight.set(
    slug,
    request,
  );

  return request;
}

async function enrichWithProfiles(
  results: KickChannelSuggestion[],
): Promise<KickChannelSuggestion[]> {
  return Promise.all(
    results.map(async (result) => ({
      ...result,

      thumbnail_url:
        await fetchKickProfilePicture(
          result.slug,
        ),
    })),
  );
}

async function fetchTypesense(
  query: string,
): Promise<KickChannelSuggestion[]> {
  const apiKey =
    process.env.KICK_TYPESENSE_SEARCH_KEY
      ?.trim();

  if (!apiKey) {
    throw new Error(GENERIC_ERROR);
  }

  try {
    const body = await withFixedProviderTimeout(
      REQUEST_TIMEOUT_MS,
      async (signal) => {
        const response = await fetch(
          KICK_TYPESENSE_URL,
          {
            method: 'POST',

            headers: {
              Accept:
                'application/json',

              'Content-Type':
                'application/json',

              Origin:
                'https://kick.com',

              Referer:
                'https://kick.com/',

              'X-Typesense-Api-Key':
                apiKey,
            },

            body: JSON.stringify({
              searches: [
                {
                  preset:
                    'channel_search',

                  q: query,
                },
              ],
            }),

            cache: 'no-store',
            redirect: 'error',
            signal,
          },
        );

        if (!response.ok) {
          await discardFixedProviderBody(response);
          throw new Error(GENERIC_ERROR);
        }
        return readBoundedFixedProviderJson(
          response,
          KICK_CHANNEL_SEARCH_MAX_BYTES,
        );
      },
    );

    if (
      !isObject(body) ||
      !Array.isArray(body.results)
    ) {
      throw new Error(
        GENERIC_ERROR,
      );
    }

    const firstResult =
      body.results[0];

    if (
      !isObject(firstResult) ||
      !Array.isArray(
        firstResult.hits,
      )
    ) {
      return [];
    }

    const mapped =
      firstResult.hits
        .map((hit) => {
          if (!isObject(hit)) {
            return null;
          }

          return mapTypesenseDocument(
            hit.document,
          );
        })
        .filter(
          (
            item,
          ): item is KickChannelSuggestion =>
            item !== null,
        );

    const ranked =
      rankResults(
        query,
        mapped,
      );

    return enrichWithProfiles(
      ranked,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === GENERIC_ERROR
    ) {
      throw error;
    }

    throw new Error(
      GENERIC_ERROR,
    );
  }
}

function store(
  query: string,
  results: KickChannelSuggestion[],
): void {
  cache.delete(query);

  cache.set(query, {
    at: Date.now(),
    results,
  });

  while (
    cache.size >
    CACHE_MAX_ENTRIES
  ) {
    const oldest =
      cache.keys().next();

    if (oldest.done) break;

    cache.delete(
      oldest.value,
    );
  }
}

export async function searchKickChannels(
  rawQuery: string,
): Promise<KickChannelSuggestion[]> {
  const query =
    normalizeKickChannelSearchQuery(
      rawQuery,
    );

  if (!query) {
    throw new Error(
      GENERIC_ERROR,
    );
  }

  const cached =
    cache.get(query);

  if (
    cached &&
    Date.now() - cached.at <
      CACHE_TTL_MS
  ) {
    return cached.results;
  }

  const pending =
    inFlight.get(query);

  if (pending) {
    return pending;
  }
  if (
    inFlight.size >=
    KICK_CHANNEL_SEARCH_IN_FLIGHT_MAX
  ) {
    throw new Error(
      GENERIC_ERROR,
    );
  }

  let request:
    Promise<KickChannelSuggestion[]>;

  request =
    fetchTypesense(query)
      .then((results) => {
        store(query, results);
        return results;
      })
      .finally(() => {
        if (
          inFlight.get(query) ===
          request
        ) {
          inFlight.delete(query);
        }
      });

  inFlight.set(
    query,
    request,
  );

  return request;
}

export function __resetKickChannelSearchCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  profileCache.clear();
  profileInFlight.clear();
}

export function __kickChannelSearchResourceStatsForTests() {
  return {
    inFlight: inFlight.size,
    profileInFlight: profileInFlight.size,
  };
}
