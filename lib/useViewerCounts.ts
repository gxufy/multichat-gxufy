/**
 * useViewerCounts — shared hook for real-time viewer data.
 *
 * Fetches from:
 *   - /api/viewers (twitch, youtube, tiktok — server-side cached)
 *   - Kick browser API directly (kick — server IPs blocked by Kick)
 *
 * Features:
 *   - 500 ms debounce on channel changes
 *   - AbortController to cancel stale in-flight requests
 *   - Monotonically increasing request ID to prevent stale-response overwrites
 *   - Loading / error / offline state per platform
 *
 * Usage:
 *   const { counts, loading } = useViewerCounts({
 *     kick: 'mychannel', twitch: 'other', youtube: '', tiktok: ''
 *   });
 */
import { useRef, useCallback, useEffect } from 'react';

type Plat = 'twitch' | 'youtube' | 'kick' | 'tiktok';
const ORDER: Plat[] = ['twitch', 'youtube', 'kick', 'tiktok'];
const SERVER_PLATS: Plat[] = ['twitch', 'youtube', 'tiktok'];

export interface ViewerResult {
  viewers: number;
  live: boolean;
  error?: string;
}

export interface ViewerCounts {
  loading: boolean;
  counts: Record<Plat, ViewerResult | null>;
  hasError: boolean;
  combinedValue: number;
}

interface Channels {
  kick?: string;
  twitch?: string;
  youtube?: string;
  tiktok?: string;
}

export function useViewerCounts(channels: Channels): ViewerCounts {
  const countsRef = useRef<Record<Plat, ViewerResult | null>>({
    twitch: null, youtube: null, kick: null, tiktok: null,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchCounts = useCallback(async () => {
    const ch = { kick: channels.kick, twitch: channels.twitch, youtube: channels.youtube, tiktok: channels.tiktok };
    const activePlats = ORDER.filter(p => ch[p]);

    if (!activePlats.length) {
      countsRef.current = { twitch: null, youtube: null, kick: null, tiktok: null };
      return;
    }

    const thisReqId = ++reqIdRef.current;
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    /* Mark loading. */
    countsRef.current = {
      ...countsRef.current,
      ...Object.fromEntries(activePlats.map(p => [p, null])),
    };

    const results: Record<Plat, ViewerResult | null> = { ...countsRef.current };

    const jobs: Promise<void>[] = [];

    /* Server-side: twitch/youtube/tiktok */
    const serverPlats = SERVER_PLATS.filter(p => ch[p] as string) as Plat[];
    if (serverPlats.length) {
      const params = new URLSearchParams();
      serverPlats.forEach(p => params.set(p, ch[p]!));
      jobs.push(
        fetch(`/api/viewers?${params}`, { signal: ac.signal })
          .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
          .then((data: Record<string, { live: boolean; viewers: number }>) => {
            if (reqIdRef.current !== thisReqId) return;
            for (const p of serverPlats) {
              const d = data[p];
              if (d) results[p] = { viewers: d.viewers, live: d.live };
            }
          })
          .catch((err: Error) => {
            if (err.name === 'AbortError') return;
            if (reqIdRef.current !== thisReqId) return;
            for (const p of serverPlats) {
              if (!results[p]) results[p] = { viewers: 0, live: false, error: err.message };
            }
          })
      );
    }

    /* Kick browser API */
    if (ch.kick) {
      jobs.push(
        fetch(`https://kick.com/api/v2/channels/${ch.kick}`, {
          headers: { Accept: 'application/json' },
          signal: ac.signal,
        })
          .then(r => r.ok ? r.json() : null)
          .then((j: any) => {
            if (reqIdRef.current !== thisReqId) return;
            if (j) {
              results.kick = {
                viewers: j.livestream?.viewer_count ?? 0,
                live: !!j.livestream,
              };
            } else {
              results.kick = { viewers: 0, live: false, error: 'Channel not found' };
            }
          })
          .catch((err: Error) => {
            if (err.name === 'AbortError') return;
            if (reqIdRef.current !== thisReqId) return;
            results.kick = results.kick
              ? { ...results.kick, error: err.message }
              : { viewers: 0, live: false, error: err.message };
          })
      );
    }

    await Promise.all(jobs);

    if (reqIdRef.current === thisReqId) {
      countsRef.current = results;
    }
  }, [channels]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchCounts, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchCounts]);

  /* Derived state for render. */
  const c = countsRef.current;
  const loading = ORDER.some(p => c[p] === null);
  const hasError = ORDER.some(p => c[p]?.error);
  const combinedValue = ORDER.reduce((n, p) => {
    const r = c[p];
    return n + (r && r.live && r.viewers > 0 ? r.viewers : 0);
  }, 0);

  return { counts: c, loading, hasError, combinedValue };
}
