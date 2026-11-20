import { useEffect, useMemo, useState } from 'react';
import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import {
  PREVIEW_LIVE_COSMETICS_DELAY_MS,
  applyPreviewLiveCosmetics,
  fetchPreviewEnhancerShown,
  fetchPreviewJilChatShown,
  loadPreviewLiveCosmetics,
  mergeShownProviderBadges,
  type PreviewLiveCosmetics,
  type ShownProvider,
} from '@/features/multichat/previewLiveCosmetics';
import type { UnifiedBadge } from '@/lib/types';

export type PreviewLiveCosmeticsStatus = 'idle' | 'loading' | 'live' | 'partial' | 'failed';

/**
 * Hydrates the bundled Preview Data catalog with current equipped cosmetics
 * once per generator mount, after first paint. The catalog renders first and
 * remains the fallback for anything a live source cannot confirm.
 */
export function usePreviewLiveCosmetics(
  catalog: ReadonlyMap<string, PreviewIdentityResponse>,
  { enabled = true, delayMs = PREVIEW_LIVE_COSMETICS_DELAY_MS }: { enabled?: boolean; delayMs?: number } = {},
): {
  readonly responses: ReadonlyMap<string, PreviewIdentityResponse>;
  readonly status: PreviewLiveCosmeticsStatus;
} {
  const [live, setLive] = useState<PreviewLiveCosmetics | null>(null);
  const [status, setStatus] = useState<PreviewLiveCosmeticsStatus>('idle');

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('loading');
      /*
       * Stage 2: per-user shown badges fill in per provider whenever they
       * arrive (Enhancer is quick; JilChat is paced by its traffic guard),
       * without holding back stage 1 or each other.
       */
      const userIds = [...catalog.values()].map((response) => response.identity.userId);
      const applyShown = (provider: ShownProvider) => (badges: ReadonlyMap<string, readonly UnifiedBadge[]>) => {
        if (controller.signal.aborted || !badges.size) return;
        setLive((current) => ({
          sevenTV: current?.sevenTV ?? new Map(),
          communityBadges: current?.communityBadges ?? new Map(),
          ...(current?.communityFailedProviders ? { communityFailedProviders: current.communityFailedProviders } : {}),
          ...(current?.twitchBadgeArt ? { twitchBadgeArt: current.twitchBadgeArt } : {}),
          ...(current?.twitchWornBadges ? { twitchWornBadges: current.twitchWornBadges } : {}),
          shownProviderBadges: mergeShownProviderBadges(current?.shownProviderBadges, provider, badges),
        }));
      };
      void fetchPreviewEnhancerShown(userIds, { signal: controller.signal }).then(applyShown('enhancer')).catch(() => undefined);
      void fetchPreviewJilChatShown(userIds, { signal: controller.signal }).then(applyShown('jilchat')).catch(() => undefined);
      /* Stage 1: 7TV, community catalogs, Twitch worn badge + art. */
      void loadPreviewLiveCosmetics(catalog, { signal: controller.signal })
        .then(({ live: next, failedSources, totalSources }) => {
          if (controller.signal.aborted) return;
          setLive((current) => (current?.shownProviderBadges
            ? { ...next, shownProviderBadges: current.shownProviderBadges }
            : next));
          setStatus(failedSources === 0 ? 'live' : failedSources < totalSources ? 'partial' : 'failed');
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus('failed');
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [catalog, enabled, delayMs]);

  const responses = useMemo(
    () => (live ? applyPreviewLiveCosmetics(catalog, live) : catalog),
    [catalog, live],
  );

  return { responses, status };
}
