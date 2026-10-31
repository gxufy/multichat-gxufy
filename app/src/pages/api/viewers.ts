/* GET /api/viewers?twitch=x&youtube=y&tiktok=z
 *
 * Concurrent viewer counts fetched server-side. Kick remains browser-side
 * because its API blocks the deployment's server IPs.
 *
 * Per-platform response shape:
 *   { live: false, viewers: null }  confirmed offline
 *   { live: true, viewers: number } measured concurrent viewers
 *   { live: true, viewers: null }   live, but count not determinable
 * Failed lookups are omitted so clients can distinguish temporary failure
 * from a confirmed offline result.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { TikTokLiveConnection } from 'tiktok-live-connector';
import {
  NonAbortableWorkGate,
  ViewerAdmissionError,
  ViewerWorkCoordinator,
  VIEWER_TIKTOK_MAX_CONCURRENCY,
  viewerClientKey,
  type ViewerLookup,
} from '../../lib/server/viewerResourceControl';
import {
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  readBoundedFixedProviderText,
  withFixedProviderTimeout,
} from '../../lib/server/fixedProviderProxy';
import {
  YOUTUBE_HTML_MAX_BYTES,
  YOUTUBE_MAX_REDIRECTS,
  validateYouTubePageUrl,
} from '../../lib/server/youtubeUpstream';

/** Successful results stay fresh long enough for the next 10s poll to reuse them. */
export const VIEWER_CACHE_TTL_MS = 15_000;

/**
 * A recently successful measurement can survive a temporary provider
 * failure, while still expiring after a bounded period.
 */
export const VIEWER_CACHE_STALE_IF_ERROR_MS =
  5 * 60_000;

export const VIEWER_CACHE_MAX_ENTRIES = 500;

/** Upstream timeouts, per provider. */
export const VIEWER_TWITCH_TIMEOUT_MS = 4_000;
export const VIEWER_YOUTUBE_TIMEOUT_MS = 6_000;
export const VIEWER_TIKTOK_TIMEOUT_MS = 6_000;
export const VIEWER_TWITCH_MAX_BYTES = 64 * 1024;
export const VIEWER_YOUTUBE_MAX_BYTES = YOUTUBE_HTML_MAX_BYTES;
export const VIEWER_YOUTUBE_MAX_REDIRECTS = YOUTUBE_MAX_REDIRECTS;

interface PlatformCount {
  live: boolean;
  viewers: number | null;
}

type ServerPlatform = 'twitch' | 'youtube' | 'tiktok';

const workCoordinator = new ViewerWorkCoordinator<PlatformCount>({
  cacheTtlMs: VIEWER_CACHE_TTL_MS,
  staleIfErrorMs: VIEWER_CACHE_STALE_IF_ERROR_MS,
  cacheMaxEntries: VIEWER_CACHE_MAX_ENTRIES,
});

const tiktokWorkGate = new NonAbortableWorkGate(VIEWER_TIKTOK_MAX_CONCURRENCY);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const YOUTUBE_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Twitch anonymous GQL stream viewersCount is a concurrent-viewer metric. */
async function twitchViewers(login: string): Promise<PlatformCount> {
  return withFixedProviderTimeout(VIEWER_TWITCH_TIMEOUT_MS, async (signal) => {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'query($login: String!) { user(login: $login) { stream { viewersCount } } }',
        variables: { login },
      }),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await discardFixedProviderBody(response);
      throw new Error('upstream');
    }

    const body = await readBoundedFixedProviderJson(response, VIEWER_TWITCH_MAX_BYTES);
    const stream = (body as any)?.data?.user?.stream;
    if (!stream) return { live: false, viewers: null };

    const count = stream.viewersCount;
    return {
      live: true,
      viewers: typeof count === 'number' && Number.isFinite(count) ? count : null,
    };
  });
}

async function fetchYouTubeViewerPage(rawUrl: string, signal: AbortSignal): Promise<Response> {
  let current = validateYouTubePageUrl(rawUrl);
  let redirects = 0;

  while (true) {
    const response = await fetch(current, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'SOCS=CAI; CONSENT=YES+cb',
      },
      redirect: 'manual',
      signal,
    });
    if (!YOUTUBE_REDIRECT_STATUSES.has(response.status)) return response;

    await discardFixedProviderBody(response);
    if (redirects >= VIEWER_YOUTUBE_MAX_REDIRECTS) throw new Error('upstream');
    const location = response.headers.get('location');
    if (!location) throw new Error('upstream');
    current = validateYouTubePageUrl(new URL(location, current).toString());
    redirects += 1;
  }
}

/** YouTube watch-page "watching now" is a concurrent-viewer metric. */
async function youtubeViewers(handle: string): Promise<PlatformCount> {
  const clean = handle.replace(/^@/, '');
  return withFixedProviderTimeout(VIEWER_YOUTUBE_TIMEOUT_MS, async (signal) => {
    const response = await fetchYouTubeViewerPage(
      `https://www.youtube.com/@${clean}/live`,
      signal,
    );
    if (!response.ok) {
      await discardFixedProviderBody(response);
      return { live: false, viewers: null };
    }

    const html = await readBoundedFixedProviderText(response, VIEWER_YOUTUBE_MAX_BYTES);
    const match =
      html.match(/"viewCount":\{"runs":\[\{"text":"([\d,.\s ]+)"/) ||
      html.match(/([\d,.]+)\s+watching now/);

    if (match) {
      const parsed = parseInt(match[1].replace(/[^\d]/g, ''), 10);
      return {
        live: true,
        viewers: Number.isFinite(parsed) ? parsed : null,
      };
    }

    const isLive =
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=/.test(html) ||
      /<meta property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=/.test(html) ||
      /"isLiveNow"\s*:\s*true/.test(html);

    return isLive
      ? { live: true, viewers: null }
      : { live: false, viewers: null };
  });
}

/** TikTok room info user_count is a concurrent-viewer metric. */
async function tiktokViewers(user: string): Promise<PlatformCount> {
  const connection = new TikTokLiveConnection(`@${user.replace(/^@/, '')}`, {
    ...(process.env.TIKTOK_SIGN_API_KEY
      ? { signApiKey: process.env.TIKTOK_SIGN_API_KEY }
      : {}),
  });

  /* fetchRoomInfo() accepts no AbortSignal. The gate therefore retains its
   * permit until the real operation settles, even if the response times out. */
  const info = (await tiktokWorkGate.run(
    () => connection.fetchRoomInfo(),
    VIEWER_TIKTOK_TIMEOUT_MS,
  )) as Record<string, unknown> | undefined;

  const raw =
    (info as { user_count?: unknown })?.user_count ??
    (info as { data?: { user_count?: unknown } })?.data?.user_count;
  const viewers = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

  // status 2 = live, 4 = ended
  const status =
    (info as { status?: unknown })?.status ??
    (info as { data?: { status?: unknown } })?.data?.status;
  const live = status === 2 || (status === undefined && viewers !== null && viewers > 0);

  return { live, viewers: live ? viewers : null };
}

function setPublicViewerHeaders(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
}

function normalizedQuery(req: NextApiRequest, key: string): string {
  const raw = req.query[key];
  const value = (typeof raw === 'string' ? raw : '').trim();
  return /^@?[A-Za-z0-9._-]{1,50}$/.test(value) ? value : '';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  setPublicViewerHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const twitch = normalizedQuery(req, 'twitch');
  const youtube = normalizedQuery(req, 'youtube');
  const tiktok = normalizedQuery(req, 'tiktok');
  const platforms: ServerPlatform[] = [];
  const lookups: Array<ViewerLookup<PlatformCount>> = [];

  if (twitch) {
    platforms.push('twitch');
    lookups.push({
      key: `tw:${twitch.toLowerCase()}`,
      run: () => twitchViewers(twitch.toLowerCase()),
    });
  }
  if (youtube) {
    platforms.push('youtube');
    lookups.push({
      key: `yt:${youtube.toLowerCase()}`,
      run: () => youtubeViewers(youtube),
    });
  }
  if (tiktok) {
    platforms.push('tiktok');
    lookups.push({
      key: `tt:${tiktok.toLowerCase()}`,
      run: () => tiktokViewers(tiktok),
    });
  }

  let counts: Array<PlatformCount | null>;
  try {
    counts = await workCoordinator.resolve(lookups, viewerClientKey(req));
  } catch (error) {
    if (error instanceof ViewerAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many viewer requests.'
          : 'Viewer data temporarily unavailable.',
      });
      return;
    }
    res.status(503).json({ error: 'Viewer data temporarily unavailable.' });
    return;
  }

  const data: Partial<Record<ServerPlatform, PlatformCount>> = {};
  for (let index = 0; index < platforms.length; index += 1) {
    const count = counts[index];
    if (count) data[platforms[index]] = count;
  }

  res.status(200).json(data);
}

export function viewerResourceStatsForTests() {
  return {
    ...workCoordinator.statsForTests(),
    activeTikTok: tiktokWorkGate.activeForTests(),
  };
}

export function resetViewerResourcesForTests(): void {
  workCoordinator.resetForTests();
  tiktokWorkGate.resetForTests();
}
