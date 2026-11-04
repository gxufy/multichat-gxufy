/* LiveCounterPreview — live viewer counts rendered inside the generator itself.
 *
 * The old configured Counter preview navigated a nested iframe to /counter.
 * Content blockers can treat a nested counter URL differently from a top-level
 * browser source and block that navigation even though the same URL works in
 * OBS. This component keeps the production counter renderer, but moves polling
 * into the parent generator document and uses only a local isolated frame for
 * visual containment. No network request is initiated by the frame itself.
 */
import { useEffect, useMemo, useState } from 'react';
import ViewerCounterDisplay from '@/components/overlay/ViewerCounterDisplay';
import IsolatedPreviewFrame from '@/components/classic/IsolatedPreviewFrame';
import { counterTool } from '@/features/counter/config';
import {
  SERVER_PLATFORMS,
  channelPollKey,
  parseViewerCounterConfig,
  type PlatformCountStatus,
  type PlatformStatuses,
  type ViewerCounterChannels,
  type ViewerCounterConfig,
} from '@/lib/viewerCounterConfig';

const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

function configFromUrl(url: string): ViewerCounterConfig {
  const parsed = new URL(url);
  const raw = Object.fromEntries(parsed.searchParams.entries());
  return parseViewerCounterConfig(raw);
}

function unavailable(): PlatformCountStatus {
  return { state: 'unavailable' };
}

function useLiveStatuses(channels: ViewerCounterChannels): PlatformStatuses {
  const pollKey = channelPollKey(channels);
  const [statuses, setStatuses] = useState<PlatformStatuses>({});

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    setStatuses({});

    async function poll(): Promise<void> {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const fresh: PlatformStatuses = {};

      const deadline = window.setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      const jobs: Promise<void>[] = [];

      const serverParams = new URLSearchParams();
      for (const platform of SERVER_PLATFORMS) {
        const channel = channels[platform];
        if (channel) serverParams.set(platform, channel);
      }

      if ([...serverParams].length > 0) {
        jobs.push(
          fetch(`/api/audience?${serverParams.toString()}`, {
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
          fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(kick)}`, {
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
        window.clearTimeout(deadline);
      }

      if (!cancelled) setStatuses(fresh);
    }

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [pollKey]);

  return statuses;
}

export default function LiveCounterPreview({
  url,
  height,
}: {
  url: string;
  height: number;
}) {
  const config = useMemo(() => configFromUrl(url), [url]);
  const statuses = useLiveStatuses(config.channels);

  return (
    <div
      role="group"
      aria-label="Live viewer counter preview"
      data-testid="counter-live-preview"
      data-overlay-url={url}
      data-preview-height={String(height)}
    >
      <IsolatedPreviewFrame
        title="Live viewer counter preview"
        width={counterTool.obs.width}
        height={height}
        testId="counter-live-preview-frame"
      >
        <div style={{ padding: 8, boxSizing: 'border-box', width: '100%' }}>
          <ViewerCounterDisplay statuses={statuses} style={config.style} />
        </div>
      </IsolatedPreviewFrame>
    </div>
  );
}
