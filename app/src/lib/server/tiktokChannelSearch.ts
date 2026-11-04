import {
  isValidTikTokUsername,
  normalizeTikTokAvatarUrl,
  normalizeTikTokChannelSearchQuery,
  type TikTokChannelSuggestion,
} from '@/lib/tiktokChannelSearch';
import {
  discardFixedProviderBody,
  readBoundedFixedProviderText,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

const TIKTOK_ORIGIN = 'https://www.tiktok.com';
const HYDRATION_SCRIPT_ID = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
const REQUEST_TIMEOUT_MS = 8_000;
export const TIKTOK_CHANNEL_SEARCH_MAX_BYTES = 2_000_000;
const MAX_JSON_NODES = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 200;
export const TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX = 100;
const NOT_FOUND_STATUS_CODE = 10_221;
const GENERIC_ERROR = 'TikTok channel search failed.';

const cache = new Map<
  string,
  { at: number; results: TikTokChannelSuggestion[] }
>();
const inFlight = new Map<string, Promise<TikTokChannelSuggestion[]>>();

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hydrationScriptContents(html: string): string | null {
  const lowerHtml = html.toLowerCase();
  const scriptStartPattern = /<script\b/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptStartPattern.exec(html)) !== null) {
    const openEnd = html.indexOf('>', match.index + match[0].length);
    if (openEnd < 0) return null;

    const openingTag = html.slice(match.index, openEnd + 1);
    const idMatch = /\bid\s*=\s*(["'])([^"']+)\1/i.exec(openingTag);
    if (idMatch?.[2] !== HYDRATION_SCRIPT_ID) {
      scriptStartPattern.lastIndex = openEnd + 1;
      continue;
    }

    const closeStart = lowerHtml.indexOf('</script', openEnd + 1);
    if (closeStart < 0) return null;
    return html.slice(openEnd + 1, closeStart).trim();
  }

  return null;
}

function parseHydration(html: string): Record<string, unknown> {
  const contents = hydrationScriptContents(html);
  if (!contents) throw new Error(GENERIC_ERROR);

  try {
    const parsed = JSON.parse(contents) as unknown;
    if (!isObject(parsed)) throw new Error(GENERIC_ERROR);
    return parsed;
  } catch {
    throw new Error(GENERIC_ERROR);
  }
}

function findUserDetail(
  hydration: Record<string, unknown>,
): Record<string, unknown> | null {
  const defaultScope = hydration.__DEFAULT_SCOPE__;
  if (isObject(defaultScope)) {
    const direct = defaultScope['webapp.user-detail'];
    if (isObject(direct)) return direct;
  }

  const stack: unknown[] = [hydration];
  let visited = 0;

  while (stack.length && visited < MAX_JSON_NODES) {
    const value = stack.pop();
    visited += 1;

    if (Array.isArray(value)) {
      for (const child of value) stack.push(child);
      continue;
    }
    if (!isObject(value)) continue;

    if (isObject(value.userInfo) && isObject(value.userInfo.user)) return value;
    for (const child of Object.values(value)) stack.push(child);
  }

  return null;
}

function statusCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function detailStatusCode(
  hydration: Record<string, unknown>,
  detail: Record<string, unknown> | null,
): number | null {
  const defaultScope = hydration.__DEFAULT_SCOPE__;
  const candidates = [
    detail?.statusCode,
    detail?.status_code,
    hydration.statusCode,
    hydration.status_code,
    isObject(defaultScope) ? defaultScope.statusCode : null,
    isObject(defaultScope) ? defaultScope.status_code : null,
  ];

  for (const candidate of candidates) {
    const parsed = statusCode(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function followerCount(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }

  return null;
}

function profileSuggestion(
  hydration: Record<string, unknown>,
  expectedUsername: string,
): TikTokChannelSuggestion[] {
  const detail = findUserDetail(hydration);
  const code = detailStatusCode(hydration, detail);
  if (code === NOT_FOUND_STATUS_CODE) return [];
  if (code !== null && code !== 0) throw new Error(GENERIC_ERROR);
  if (!detail || !isObject(detail.userInfo)) throw new Error(GENERIC_ERROR);

  const user = detail.userInfo.user;
  const stats = detail.userInfo.stats;
  const statsV2 = detail.userInfo.statsV2;
  if (!isObject(user)) throw new Error(GENERIC_ERROR);

  const username = user.uniqueId;
  const displayName = user.nickname;
  if (
    !isValidTikTokUsername(username) ||
    username.toLocaleLowerCase('en-US') !== expectedUsername ||
    typeof displayName !== 'string' ||
    !displayName.trim() ||
    displayName.length > 100
  ) {
    throw new Error(GENERIC_ERROR);
  }

  const followers = followerCount(
    isObject(statsV2) ? statsV2.followerCount : null,
  ) ?? followerCount(isObject(stats) ? stats.followerCount : null);
  if (followers === null) throw new Error(GENERIC_ERROR);

  const thumbnailUrl = [user.avatarMedium, user.avatarLarger, user.avatarThumb]
    .map(normalizeTikTokAvatarUrl)
    .find((candidate): candidate is string => candidate !== null) ?? null;

  return [{
    username,
    display_name: displayName,
    thumbnail_url: thumbnailUrl,
    followers_count: followers,
    verified: user.verified === true,
    is_live: false,
  }];
}

async function fetchProfile(
  username: string,
): Promise<TikTokChannelSuggestion[]> {
  const url = new URL(`/@${encodeURIComponent(username)}`, TIKTOK_ORIGIN);
  try {
    const html = await withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        },
        cache: 'no-store',
        redirect: 'error',
        signal,
      });

      if (response.status === 404) {
        await discardFixedProviderBody(response);
        return null;
      }
      if (!response.ok) {
        await discardFixedProviderBody(response);
        throw new Error(GENERIC_ERROR);
      }
      return readBoundedFixedProviderText(
        response,
        TIKTOK_CHANNEL_SEARCH_MAX_BYTES,
      );
    });
    if (html === null) return [];
    if (!html) throw new Error(GENERIC_ERROR);

    return profileSuggestion(parseHydration(html), username);
  } catch (error) {
    if (error instanceof Error && error.message === GENERIC_ERROR) throw error;
    throw new Error(GENERIC_ERROR);
  }
}

function store(username: string, results: TikTokChannelSuggestion[]): void {
  cache.delete(username);
  cache.set(username, { at: Date.now(), results });

  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export async function searchTikTokChannels(
  rawQuery: string,
): Promise<TikTokChannelSuggestion[]> {
  const username = normalizeTikTokChannelSearchQuery(rawQuery);
  if (!username) throw new Error(GENERIC_ERROR);

  const cached = cache.get(username);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const pending = inFlight.get(username);
  if (pending) return pending;
  if (inFlight.size >= TIKTOK_CHANNEL_SEARCH_IN_FLIGHT_MAX) {
    throw new Error(GENERIC_ERROR);
  }

  let request: Promise<TikTokChannelSuggestion[]>;
  request = fetchProfile(username)
    .then((results) => {
      store(username, results);
      return results;
    })
    .finally(() => {
      if (inFlight.get(username) === request) inFlight.delete(username);
    });

  inFlight.set(username, request);
  return request;
}

export function __resetTikTokChannelSearchCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
