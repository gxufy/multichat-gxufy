/*
 * One poll of live viewer counts for the generator's FlossCounter preview:
 * /api/audience for Twitch, YouTube and TikTok, and Kick straight from the
 * browser (the server can't reach Kick reliably from its host). Same results
 * the /counter overlay folds in. Used by the generator's preview.
 */
import {
  SERVER_PLATFORMS,
  type PlatformCountStatus,
  type PlatformStatuses,
  type ViewerCounterChannels,
} from './viewerCounterConfig';

export const LIVE_PREVIEW_POLL_INTERVAL_MS = 10_000;
export const LIVE_PREVIEW_REQUEST_TIMEOUT_MS = 8_000;

function unavailable(): PlatformCountStatus {
  return { state: 'unavailable' };
}

/**
 * Poll once. `controller` cancels the requests (and is aborted after the
 * request timeout); the result is whatever each platform settled to.
 */
export async function pollViewerStatuses(
  channels: ViewerCounterChannels,
  controller: AbortController,
  fetcher: typeof fetch = fetch,
): Promise<PlatformStatuses> {
  const signal = controller.signal;
  const fresh: PlatformStatuses = {};

  const deadline = setTimeout(() => controller.abort(), LIVE_PREVIEW_REQUEST_TIMEOUT_MS);
  const jobs: Promise<void>[] = [];

  const serverParams = new URLSearchParams();
  for (const platform of SERVER_PLATFORMS) {
    const channel = channels[platform];
    if (channel) serverParams.set(platform, channel);
  }

  if ([...serverParams].length > 0) {
    jobs.push(
      fetcher(`/api/audience?${serverParams.toString()}`, {
        signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`audience ${response.status}`);
          return response.json() as Promise<Record<string, unknown>>;
        })
        .then((data) => {
          for (const platform of SERVER_PLATFORMS) {
            if (!channels[platform]) continue;

            const rawEntry = data[platform];
            if (!rawEntry || typeof rawEntry !== 'object') {
              fresh[platform] = unavailable();
              continue;
            }

            const entry = rawEntry as { live?: unknown; viewers?: unknown };
            if (entry.live !== true) {
              fresh[platform] = { state: 'offline' };
            } else if (
              typeof entry.viewers === 'number' &&
              Number.isFinite(entry.viewers)
            ) {
              fresh[platform] = { state: 'live', viewers: entry.viewers };
            } else {
              fresh[platform] = { state: 'live-unknown' };
            }
          }
        })
        .catch(() => {
          for (const platform of SERVER_PLATFORMS) {
            if (channels[platform]) fresh[platform] = unavailable();
          }
        }),
    );
  }

  /* Keep Kick browser-side. The server API deliberately cannot query Kick
     reliably from its hosting IP, while the browser endpoint is available. */
  const kick = channels.kick;
  if (kick) {
    jobs.push(
      fetcher(`https://kick.com/api/v2/channels/${encodeURIComponent(kick)}`, {
        headers: { Accept: 'application/json' },
        signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`kick ${response.status}`);
          return response.json() as Promise<{ livestream?: unknown }>;
        })
        .then((data) => {
          const stream = data.livestream;
          if (!stream || typeof stream !== 'object') {
            fresh.kick = { state: 'offline' };
            return;
          }

          const viewers = (stream as { viewer_count?: unknown }).viewer_count;
          fresh.kick =
            typeof viewers === 'number' && Number.isFinite(viewers)
              ? { state: 'live', viewers }
              : { state: 'live-unknown' };
        })
        .catch(() => {
          fresh.kick = unavailable();
        }),
    );
  }

  try {
    await Promise.all(jobs);
  } finally {
    clearTimeout(deadline);
  }


  return fresh;
}
