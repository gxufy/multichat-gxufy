
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PREVIEW_BADGE_CATALOG,
  cachedPreviewBadgeResources,
  groupByProvider,
  loadPreviewBadgeResources,
  type BadgeProvider,
  type BadgeProviderRow,
  type PreviewBadgeAsset,
  type PreviewBadgeChannels,
  type PreviewBadgeResources,
} from '@/features/multichat/previewBadgeLibrary';

export type BadgeLibraryStatus = 'idle' | 'loading' | 'success' | 'partial' | 'error';

const EMPTY_RESOURCES: PreviewBadgeResources = {
  assets: PREVIEW_BADGE_CATALOG,
  twitchBadges: {},
  ffzBadges: {},
  kickChannel: null,
  failedProviders: [],
};

export type PreviewBadgeLibraryState = {
  readonly rows: readonly BadgeProviderRow[];
  readonly assets: readonly PreviewBadgeAsset[];
  readonly resources: PreviewBadgeResources;
  readonly count: number;
  readonly status: BadgeLibraryStatus;
  readonly loaded: boolean;
  readonly failedProviders: readonly BadgeProvider[];
  load: () => void;
  reset: () => void;
};

export function usePreviewBadgeLibrary(
  channels: PreviewBadgeChannels = {},
): PreviewBadgeLibraryState {
  const twitch = channels.twitch ?? '';
  const kick = channels.kick ?? '';
  const key = `${twitch.trim().toLowerCase()}|${kick.trim().toLowerCase()}`;
  const initial = useMemo(() => cachedPreviewBadgeResources({ twitch, kick }) ?? EMPTY_RESOURCES, [key]);
  const [resources, setResources] = useState<PreviewBadgeResources>(initial);
  const [status, setStatus] = useState<BadgeLibraryStatus>(
    initial === EMPTY_RESOURCES ? 'idle' : initial.failedProviders.length ? 'partial' : 'success',
  );
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const loadingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    loadingRef.current = false;
    const cached = cachedPreviewBadgeResources({ twitch, kick });
    setResources(cached ?? EMPTY_RESOURCES);
    setStatus(cached ? (cached.failedProviders.length ? 'partial' : 'success') : 'idle');
  }, [key]);

  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    loadPreviewBadgeResources({ twitch, kick }, controller.signal).then(
      (loaded) => {
        loadingRef.current = false;
        if (!aliveRef.current || controller.signal.aborted) return;
        setResources(loaded);
        setStatus(loaded.failedProviders.length ? 'partial' : 'success');
      },
      (error) => {
        loadingRef.current = false;
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (aliveRef.current) setStatus('error');
      },
    );
  }, [twitch, kick]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    loadingRef.current = false;
    setResources(EMPTY_RESOURCES);
    setStatus('idle');
  }, []);

  return {
    rows: groupByProvider(resources.assets),
    assets: resources.assets,
    resources,
    count: resources.assets.length,
    status,
    loaded: status === 'success' || status === 'partial',
    failedProviders: resources.failedProviders,
    load,
    reset,
  };
}
