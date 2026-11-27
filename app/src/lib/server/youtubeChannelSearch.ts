import {
  YOUTUBE_CHANNEL_SEARCH_MAX_RESULTS,
  normalizeYouTubeAvatarUrl,
  normalizeYouTubeChannelSearchQuery,
  type YouTubeChannelSuggestion,
} from '@/lib/youtubeChannelSearch';
import {
  discardFixedProviderBody,
  readBoundedFixedProviderText,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

const YOUTUBE_SEARCH_URL = 'https://www.youtube.com/results';
const REQUEST_TIMEOUT_MS = 8_000;
export const YOUTUBE_CHANNEL_SEARCH_MAX_BYTES = 8_000_000;
export const YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX = 100;
const MAX_JSON_NODES = 200_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const GENERIC_ERROR = 'YouTube channel search failed.';

const cache = new Map<
  string,
  { at: number; results: YouTubeChannelSuggestion[] }
>();
const inFlight = new Map<string, Promise<YouTubeChannelSuggestion[]>>();

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractBalancedJsonObject(source: string, start: number): string | null {
  if (source[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

function parseYtInitialData(html: string): unknown {
  const assignments = [
    /(?:var\s+)?ytInitialData\s*=\s*/g,
    /window\.ytInitialData\s*=\s*/g,
    /window\[(?:"ytInitialData"|'ytInitialData')\]\s*=\s*/g,
  ];

  for (const assignment of assignments) {
    let match: RegExpExecArray | null;
    while ((match = assignment.exec(html)) !== null) {
      const objectStart = html.indexOf('{', match.index + match[0].length);
      if (objectStart < 0) continue;

      const between = html.slice(match.index + match[0].length, objectStart);
      if (between.trim()) continue;

      const json = extractBalancedJsonObject(html, objectStart);
      if (!json) continue;

      try {
        return JSON.parse(json) as unknown;
      } catch {
        // YouTube can emit more than one assignment; keep looking for a valid one.
      }
    }
  }

  throw new Error(GENERIC_ERROR);
}

function findChannelRenderers(root: unknown): Record<string, unknown>[] {
  const renderers: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  let visited = 0;

  while (stack.length && visited < MAX_JSON_NODES) {
    const value = stack.pop();
    visited += 1;

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }

    if (!isObject(value)) continue;

    for (const [key, child] of Object.entries(value)) {
      if (key === 'channelRenderer' && isObject(child)) {
        renderers.push(child);
      }
      stack.push(child);
    }
  }

  return renderers;
}

function rendererText(value: unknown): string {
  if (!isObject(value)) return '';
  if (typeof value.simpleText === 'string') return value.simpleText.trim();

  if (!Array.isArray(value.runs)) return '';
  return value.runs
    .map((run) => (isObject(run) && typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim();
}

function canonicalHandle(renderer: Record<string, unknown>): string | null {
  const navigationEndpoint = renderer.navigationEndpoint;
  const browseEndpoint = isObject(navigationEndpoint)
    ? navigationEndpoint.browseEndpoint
    : null;
  const canonicalBaseUrl = isObject(browseEndpoint)
    ? browseEndpoint.canonicalBaseUrl
    : null;

  const candidates = [
    canonicalBaseUrl,
    rendererText(renderer.subscriberCountText),
    rendererText(renderer.videoCountText),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;

    let handle = candidate.trim();
    if (handle.startsWith('/@')) handle = handle.slice(1);
    if (!handle.startsWith('@')) continue;

    try {
      handle = decodeURIComponent(handle);
    } catch {
      continue;
    }

    if (
      handle.length >= 2 &&
      handle.length <= 81 &&
      !/[\s/?#\u0000-\u001f\u007f]/u.test(handle)
    ) {
      return handle;
    }
  }

  return null;
}

function bestThumbnail(renderer: Record<string, unknown>): string | null {
  const thumbnail = renderer.thumbnail;
  const thumbnails = isObject(thumbnail) ? thumbnail.thumbnails : null;
  if (!Array.isArray(thumbnails)) return null;

  const candidates = thumbnails
    .map((item) => {
      if (!isObject(item)) return null;
      const url = normalizeYouTubeAvatarUrl(item.url);
      if (!url) return null;

      const width = typeof item.width === 'number' ? item.width : 0;
      const height = typeof item.height === 'number' ? item.height : 0;
      return { url, area: width * height };
    })
    .filter((item): item is { url: string; area: number } => item !== null)
    .sort((left, right) => right.area - left.area);

  return candidates[0]?.url ?? null;
}

function subscriberText(renderer: Record<string, unknown>): string {
  const candidates = [
    rendererText(renderer.subscriberCountText),
    rendererText(renderer.videoCountText),
  ];

  return candidates.find((text) => /\bsubscribers?\b/i.test(text)) ?? '';
}

function mapChannelRenderer(
  renderer: Record<string, unknown>,
): YouTubeChannelSuggestion | null {
  const channelId = renderer.channelId;
  const displayName = rendererText(renderer.title);
  const handle = canonicalHandle(renderer);

  if (
    typeof channelId !== 'string' ||
    !/^UC[A-Za-z0-9_-]{22}$/.test(channelId) ||
    !displayName ||
    displayName.length > 100 ||
    !handle
  ) {
    return null;
  }

  return {
    channel_id: channelId,
    handle,
    display_name: displayName,
    thumbnail_url: bestThumbnail(renderer),
    subscribers: subscriberText(renderer).slice(0, 80),
    is_live: false,
  };
}

function comparable(value: string): string {
  return value.replace(/^@/, '').trim().toLocaleLowerCase('en-US');
}

function rankResults(
  query: string,
  results: YouTubeChannelSuggestion[],
): YouTubeChannelSuggestion[] {
  const unique = [
    ...new Map(results.map((result) => [result.channel_id, result])).values(),
  ];

  const category = (result: YouTubeChannelSuggestion) => {
    const fields = [comparable(result.handle), comparable(result.display_name)];
    if (fields.some((field) => field === query)) return 0;
    if (fields.some((field) => field.startsWith(query))) return 1;
    if (fields.some((field) => field.includes(query))) return 2;
    return 3;
  };

  return unique
    .sort((left, right) => {
      const categoryDifference = category(left) - category(right);
      if (categoryDifference !== 0) return categoryDifference;

      const leftHandle = comparable(left.handle);
      const rightHandle = comparable(right.handle);
      const lengthDifference = leftHandle.length - rightHandle.length;
      if (lengthDifference !== 0) return lengthDifference;

      const handleDifference = leftHandle.localeCompare(rightHandle);
      if (handleDifference !== 0) return handleDifference;
      return left.channel_id.localeCompare(right.channel_id);
    })
    .slice(0, YOUTUBE_CHANNEL_SEARCH_MAX_RESULTS);
}

async function fetchSearch(query: string): Promise<YouTubeChannelSuggestion[]> {
  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set('search_query', query);

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

      if (!response.ok) {
        await discardFixedProviderBody(response);
        throw new Error(GENERIC_ERROR);
      }
      return readBoundedFixedProviderText(
        response,
        YOUTUBE_CHANNEL_SEARCH_MAX_BYTES,
      );
    });
    if (!html) throw new Error(GENERIC_ERROR);

    const renderers = findChannelRenderers(parseYtInitialData(html));
    const results = renderers
      .map(mapChannelRenderer)
      .filter((item): item is YouTubeChannelSuggestion => item !== null);

    return rankResults(query, results);
  } catch (error) {
    if (error instanceof Error && error.message === GENERIC_ERROR) throw error;
    throw new Error(GENERIC_ERROR);
  }
}

function store(query: string, results: YouTubeChannelSuggestion[]): void {
  cache.delete(query);
  cache.set(query, { at: Date.now(), results });

  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export async function searchYouTubeChannels(
  rawQuery: string,
): Promise<YouTubeChannelSuggestion[]> {
  const query = normalizeYouTubeChannelSearchQuery(rawQuery);
  if (!query) throw new Error(GENERIC_ERROR);

  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const pending = inFlight.get(query);
  if (pending) return pending;
  if (inFlight.size >= YOUTUBE_CHANNEL_SEARCH_IN_FLIGHT_MAX) {
    throw new Error(GENERIC_ERROR);
  }

  let request: Promise<YouTubeChannelSuggestion[]>;
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

export function __resetYouTubeChannelSearchCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
