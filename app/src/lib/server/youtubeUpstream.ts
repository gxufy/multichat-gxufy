import { normalizeChatChannel } from '../channelValidation';
import {
  FixedProviderUpstreamError,
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  readBoundedFixedProviderText,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

const API_KEY_RE = /"INNERTUBE_API_KEY":"([^"]+)"/;
const CLIENT_VERSION_RE = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/;
const CONTINUATION_RE = /"continuation":"([^"]+)"/;
const CHANNEL_ID_RE = /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/;

const CANONICAL_WATCH_RE =
  /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})[^"']*["']/i;
const OG_WATCH_RE =
  /<meta[^>]+property=["']og:url["'][^>]+content=["']https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})[^"']*["']/i;
const VIDEO_DETAILS_RE =
  /"videoDetails"\s*:\s*\{[\s\S]{0,10000}?"videoId"\s*:\s*"([\w-]{11})"/;
const VIEW_COUNT_SIGNAL_RE =
  /"viewCount"\s*:\s*\{"runs":\[\{"text":"[\d,.\s\u00a0]+"/i;
const WATCHING_NOW_RE = /[\d,.]+\s+watching now/i;
const LIVE_FLAG_RE = /"isLiveNow"\s*:\s*true|"isLiveContent"\s*:\s*true/i;

/* YouTube can expose a separate live broadcast in the Shorts shelf while
 * /@handle/live points at the featured long-form stream. */
const SHORTS_ITEM_RE = /"shortsLockupViewModel":\{"entityId":"shorts-shelf-item-([\w-]{11})"/g;
const SHORTS_LIVE_RE = /"liveBadgeText"|"badgeStyle":"THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"/;
const SHORTS_BLOCK_WINDOW = 4_000;

export const YOUTUBE_OFFLINE_RECHECK_MS = 60_000;
export const YOUTUBE_POLL_FLOOR_MS = 800;
export const YOUTUBE_POLL_CEILING_MS = 1_000;
export const YOUTUBE_UPSTREAM_TIMEOUT_MS = 8_000;
export const YOUTUBE_HTML_MAX_BYTES = 4 * 1024 * 1024;
export const YOUTUBE_CHAT_MAX_BYTES = 2 * 1024 * 1024;
export const YOUTUBE_MAX_REDIRECTS = 2;

const YOUTUBE_PAGE_HOSTS = new Set(['youtube.com', 'www.youtube.com']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'SOCS=CAI; CONSENT=YES+cb',
};

export interface YouTubeLiveDiscovery {
  videoIds: string[];
  featuredVideoId: string | null;
  liveShortVideoId: string | null;
}

export interface YouTubeChatBootstrap {
  videoId: string;
  apiKey: string;
  clientVersion: string;
  continuation: string;
  channelId?: string;
}

function abortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function validateYouTubePageUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FixedProviderUpstreamError('invalid YouTube URL');
  }
  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || rawUrl.includes('#')
    || (url.port && url.port !== '443')
    || !YOUTUBE_PAGE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new FixedProviderUpstreamError('untrusted YouTube URL');
  }
  return url;
}

async function fetchYouTubePage(
  rawUrl: string,
  init: RequestInit,
  parentSignal?: AbortSignal,
): Promise<{ response: Response; finalUrl: string }> {
  return withFixedProviderTimeout(YOUTUBE_UPSTREAM_TIMEOUT_MS, async (signal) => {
    let current = validateYouTubePageUrl(rawUrl);
    let redirects = 0;
    while (true) {
      const response = await fetch(current, {
        ...init,
        redirect: 'manual',
        signal,
      });
      if (!REDIRECT_STATUSES.has(response.status)) {
        return { response, finalUrl: current.toString() };
      }

      await discardFixedProviderBody(response);
      if (redirects >= YOUTUBE_MAX_REDIRECTS) {
        throw new FixedProviderUpstreamError('too many YouTube redirects');
      }
      const location = response.headers.get('location');
      if (!location) throw new FixedProviderUpstreamError('invalid YouTube redirect');
      current = validateYouTubePageUrl(new URL(location, current).toString());
      redirects += 1;
    }
  }, parentSignal);
}

export function extractAssignedJson(html: string, marker: string): any | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, index + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

export function liveViewContinuation(initialData: any): string | null {
  const items = initialData?.contents?.liveChatRenderer?.header?.liveChatHeaderRenderer
    ?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems;
  if (!Array.isArray(items)) return null;
  const continuationOf = (item: any): string | null => {
    const continuation = item?.continuation?.reloadContinuationData?.continuation;
    return typeof continuation === 'string' && continuation ? continuation : null;
  };
  const live = items.find((item: any) =>
    typeof item?.title === 'string'
    && item.title.toLowerCase().includes('live')
    && !item.title.toLowerCase().includes('top'));
  const preferred = continuationOf(live);
  if (preferred) return preferred;

  /* Titles are localized and have changed shape before. YouTube orders the
     normal/all-messages mode after Top chat, so the last valid reload
     continuation is the safest structured fallback before the legacy bare
     continuation parser gets a chance. */
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const continuation = continuationOf(items[index]);
    if (continuation) return continuation;
  }
  return null;
}

export function youtubeBootstrapContinuation(html: string, initialData: any): string | null {
  return liveViewContinuation(initialData) ?? html.match(CONTINUATION_RE)?.[1] ?? null;
}

export function currentLiveVideoIdFromHtml(html: string): string | null {
  const marker = '"currentVideoEndpoint"';
  let cursor = 0;
  while (cursor < html.length) {
    const markerIndex = html.indexOf(marker, cursor);
    if (markerIndex < 0) return null;
    const endpoint = extractAssignedJson(html.slice(markerIndex), marker);
    const url = endpoint?.url;
    if (endpoint?.isLive === true && typeof url === 'string') {
      const videoId = /^\/watch\?v=([\w-]{11})(?:&|$)/.exec(url)?.[1];
      if (videoId) return videoId;
    }
    cursor = markerIndex + marker.length;
  }
  return null;
}

export function liveShortVideoIdFromHtml(html: string): string | null {
  const matches = [...html.matchAll(SHORTS_ITEM_RE)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    let end = Math.min(html.length, start + SHORTS_BLOCK_WINDOW);
    const nextStart = matches[index + 1]?.index;
    if (typeof nextStart === 'number') end = Math.min(end, nextStart);
    if (SHORTS_LIVE_RE.test(html.slice(start, end))) return match[1];
  }
  return null;
}

export function mergeYouTubeLiveVideoIds(
  featuredVideoId: string | null,
  liveShortVideoId: string | null,
): string[] {
  return [...new Set([featuredVideoId, liveShortVideoId].filter((value): value is string => Boolean(value)))];
}

function videoIdFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') &&
      url.pathname === '/watch'
    ) {
      const id = url.searchParams.get('v');
      if (id && /^[\w-]{11}$/.test(id)) return id;
    }
  } catch {
    // Ignore malformed upstream URLs.
  }
  return null;
}

function videoIdNearestSignal(html: string, signalIndex: number): string | null {
  const before = html.slice(Math.max(0, signalIndex - 50_000), signalIndex);
  const idRe = /"videoId"\s*:\s*"([\w-]{11})"/g;
  let match: RegExpExecArray | null;
  let nearest: string | null = null;
  while ((match = idRe.exec(before)) !== null) nearest = match[1];
  if (nearest) return nearest;
  const after = html.slice(signalIndex, Math.min(html.length, signalIndex + 50_000));
  return after.match(/"videoId"\s*:\s*"([\w-]{11})"/)?.[1] ?? null;
}

export function featuredLiveVideoIdFromHtml(html: string): string | null {
  const canonical = html.match(CANONICAL_WATCH_RE)?.[1];
  if (canonical) return canonical;

  /* Newer /@handle/live pages can render the canonical watch link as
     undefined while retaining the live-only navigation endpoint. Keep this
     bounded and require the associated object to identify itself as live so
     an ordinary featured upload cannot become a false-positive. */
  const currentVideo = currentLiveVideoIdFromHtml(html);
  if (currentVideo) return currentVideo;

  const og = html.match(OG_WATCH_RE)?.[1];
  if (og) return og;
  const details = html.match(VIDEO_DETAILS_RE)?.[1];
  if (details) return details;

  const signal = VIEW_COUNT_SIGNAL_RE.exec(html) ?? WATCHING_NOW_RE.exec(html) ?? LIVE_FLAG_RE.exec(html);
  return signal ? videoIdNearestSignal(html, signal.index) : null;
}

async function findFeaturedLiveVideo(
  channel: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const urls = [
    `https://www.youtube.com/@${channel}/live`,
    `https://www.youtube.com/c/${channel}/live`,
  ];
  for (const url of urls) {
    try {
      const { response, finalUrl } = await fetchYouTubePage(url, { headers: HEADERS }, signal);
      if (!response.ok) {
        await discardFixedProviderBody(response);
        continue;
      }
      const redirectedId = videoIdFromUrl(finalUrl);
      if (redirectedId) {
        await discardFixedProviderBody(response);
        return redirectedId;
      }
      const htmlId = featuredLiveVideoIdFromHtml(
        await readBoundedFixedProviderText(response, YOUTUBE_HTML_MAX_BYTES),
      );
      if (htmlId) return htmlId;
    } catch (error) {
      if (abortError(error)) throw error;
    }
  }
  return null;
}

async function findLiveShort(channel: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const { response } = await fetchYouTubePage(
      `https://www.youtube.com/@${channel}/shorts`,
      { headers: HEADERS },
      signal,
    );
    if (!response.ok) {
      await discardFixedProviderBody(response);
      return null;
    }
    return liveShortVideoIdFromHtml(
      await readBoundedFixedProviderText(response, YOUTUBE_HTML_MAX_BYTES),
    );
  } catch (error) {
    if (abortError(error)) throw error;
    return null;
  }
}

export async function discoverYouTubeLiveVideos(
  rawChannel: string,
  signal?: AbortSignal,
): Promise<YouTubeLiveDiscovery> {
  const channel = normalizeChatChannel('youtube', rawChannel);
  if (!channel) return { videoIds: [], featuredVideoId: null, liveShortVideoId: null };

  const [featuredVideoId, liveShortVideoId] = await Promise.all([
    findFeaturedLiveVideo(channel, signal),
    findLiveShort(channel, signal),
  ]);
  return {
    videoIds: mergeYouTubeLiveVideoIds(featuredVideoId, liveShortVideoId),
    featuredVideoId,
    liveShortVideoId,
  };
}

async function findVideoChannelId(videoId: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const { response } = await fetchYouTubePage(
      `https://www.youtube.com/watch?v=${videoId}`,
      { headers: HEADERS },
      signal,
    );
    if (!response.ok) {
      await discardFixedProviderBody(response);
      return null;
    }
    const html = await readBoundedFixedProviderText(response, YOUTUBE_HTML_MAX_BYTES);
    const player = extractAssignedJson(html, 'ytInitialPlayerResponse');
    const channelId = player?.videoDetails?.channelId;
    if (typeof channelId === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return channelId;
    return html.match(CHANNEL_ID_RE)?.[1] ?? null;
  } catch (error) {
    if (abortError(error)) throw error;
    return null;
  }
}

export async function bootstrapYouTubeChat(
  videoId: string,
  signal?: AbortSignal,
): Promise<YouTubeChatBootstrap | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  const channelIdPromise = findVideoChannelId(videoId, signal);
  const { response } = await fetchYouTubePage(
    `https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`,
    { headers: HEADERS },
    signal,
  );
  if (!response.ok) {
    await discardFixedProviderBody(response);
    return null;
  }
  const html = await readBoundedFixedProviderText(response, YOUTUBE_HTML_MAX_BYTES);
  const apiKey = html.match(API_KEY_RE)?.[1];
  const clientVersion = html.match(CLIENT_VERSION_RE)?.[1];
  const initialData = extractAssignedJson(html, 'ytInitialData');
  const continuation = youtubeBootstrapContinuation(html, initialData);
  if (!apiKey || !clientVersion || !continuation) return null;
  const channelId = await channelIdPromise;
  return {
    videoId,
    apiKey,
    clientVersion,
    continuation,
    ...(channelId ? { channelId } : {}),
  };
}

export async function fetchYouTubeChat(
  apiKey: string,
  clientVersion: string,
  continuation: string,
  signal?: AbortSignal,
): Promise<any> {
  return withFixedProviderTimeout(YOUTUBE_UPSTREAM_TIMEOUT_MS, async (requestSignal) => {
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...HEADERS,
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion } },
          continuation,
        }),
        redirect: 'error',
        signal: requestSignal,
      },
    );
    if (!response.ok) {
      await discardFixedProviderBody(response);
      throw new Error(`innertube: ${response.status}`);
    }
    return readBoundedFixedProviderJson(response, YOUTUBE_CHAT_MAX_BYTES);
  }, signal);
}

export function nextYouTubeContinuation(cont: any): { continuation: string | null; timeoutMs: number } {
  for (const value of cont?.continuations ?? []) {
    const data = value.invalidationContinuationData ?? value.timedContinuationData ?? value.reloadContinuationData;
    if (data?.continuation) {
      const raw = typeof data.timeoutMs === 'number' && Number.isFinite(data.timeoutMs)
        ? data.timeoutMs
        : 2_000;
      return {
        continuation: data.continuation,
        timeoutMs: Math.min(Math.max(raw, YOUTUBE_POLL_FLOOR_MS), YOUTUBE_POLL_CEILING_MS),
      };
    }
  }
  return { continuation: null, timeoutMs: 0 };
}
