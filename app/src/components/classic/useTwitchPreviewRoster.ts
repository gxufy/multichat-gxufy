import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  failedPreviewIdentityProviders,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';
import {
  acquirePreviewIdentity,
  cachedPreviewIdentity,
} from '@/features/multichat/previewIdentityClient';
import {
  PREVIEW_ROSTER,
  PREVIEW_ROSTER_CONCURRENCY,
  rosterFeedTemplates,
  rosterTemplates,
} from '@/features/multichat/previewRoster';

export type PreviewRosterMemberStatus = 'loading' | 'ready' | 'partial' | 'unavailable' | 'failed';

type StatusMap = Readonly<Record<string, PreviewRosterMemberStatus>>;

export type TwitchPreviewRosterState = {
  readonly responses: ReadonlyMap<string, PreviewIdentityResponse>;
  readonly templates: ReturnType<typeof rosterTemplates>;
  readonly feedTemplates: ReturnType<typeof rosterFeedTemplates>;
  readonly statusText: string;
  readonly page: number;
  loadMore: () => void;
  reset: () => void;
};

function responseStatus(response: PreviewIdentityResponse): PreviewRosterMemberStatus {
  return failedPreviewIdentityProviders(response).length ? 'partial' : 'ready';
}

function initialResponses(): Map<string, PreviewIdentityResponse> {
  return new Map(PREVIEW_ROSTER.flatMap((entry) => {
    const cached = cachedPreviewIdentity(entry.login);
    return cached ? [[entry.login, cached] as const] : [];
  }));
}

function initialStatuses(responses: ReadonlyMap<string, PreviewIdentityResponse>): StatusMap {
  return Object.fromEntries(PREVIEW_ROSTER.map((entry) => [
    entry.login,
    responses.has(entry.login) ? responseStatus(responses.get(entry.login)!) : 'loading',
  ]));
}

export function useTwitchPreviewRoster(): TwitchPreviewRosterState {
  const [responses, setResponses] = useState<ReadonlyMap<string, PreviewIdentityResponse>>(() => initialResponses());
  const [statuses, setStatuses] = useState<StatusMap>(() => initialStatuses(initialResponses()));
  const [page, setPage] = useState(0);
  const generationRef = useRef(0);
  const releasesRef = useRef(new Set<() => void>());

  const load = useCallback((logins: readonly string[], providersByLogin?: ReadonlyMap<string, ReturnType<typeof failedPreviewIdentityProviders>>) => {
    const generation = generationRef.current;
    let cursor = 0;
    let active = 0;

    const launch = () => {
      while (active < PREVIEW_ROSTER_CONCURRENCY && cursor < logins.length) {
        const login = logins[cursor++]!;
        const providers = providersByLogin?.get(login) ?? null;
        active += 1;
        setStatuses((current) => ({ ...current, [login]: current[login] === 'partial' ? 'partial' : 'loading' }));
        const acquired = acquirePreviewIdentity(login, providers);
        releasesRef.current.add(acquired.release);
        void acquired.promise.then((response) => {
          if (generation !== generationRef.current) return;
          setResponses((current) => new Map(current).set(login, response));
          setStatuses((current) => ({ ...current, [login]: responseStatus(response) }));
        }).catch((error: unknown) => {
          if (generation !== generationRef.current || (error instanceof DOMException && error.name === 'AbortError')) return;
          const unavailable = error instanceof Error && error.message === 'not-found';
          setStatuses((current) => ({ ...current, [login]: unavailable ? 'unavailable' : 'failed' }));
        }).finally(() => {
          acquired.release();
          releasesRef.current.delete(acquired.release);
          active -= 1;
          if (generation === generationRef.current) launch();
        });
      }
    };
    launch();
  }, []);

  useEffect(() => {
    const uncached = PREVIEW_ROSTER.filter((entry) => !cachedPreviewIdentity(entry.login)).map((entry) => entry.login);
    load(uncached);
    return () => {
      generationRef.current += 1;
      for (const release of releasesRef.current) release();
      releasesRef.current.clear();
    };
  }, [load]);

  const loadMore = useCallback(() => {
    setPage((current) => current + 1);
    const retries = new Map<string, ReturnType<typeof failedPreviewIdentityProviders>>();
    const logins: string[] = [];
    for (const entry of PREVIEW_ROSTER) {
      const response = responses.get(entry.login);
      const failed = response ? failedPreviewIdentityProviders(response) : [];
      if (failed.length) {
        retries.set(entry.login, failed);
        logins.push(entry.login);
      } else if (!response && statuses[entry.login] !== 'loading') {
        logins.push(entry.login);
      }
    }
    load(logins, retries);
  }, [load, responses, statuses]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    for (const release of releasesRef.current) release();
    releasesRef.current.clear();
    const cached = initialResponses();
    setResponses(cached);
    setStatuses(initialStatuses(cached));
    setPage(0);
    const missing = PREVIEW_ROSTER.filter((entry) => !cached.has(entry.login)).map((entry) => entry.login);
    load(missing);
  }, [load]);

  const templates = useMemo(() => rosterTemplates(responses, page), [page, responses]);
  const feedTemplates = useMemo(() => rosterFeedTemplates(responses, page), [page, responses]);
  const statusText = useMemo(() => {
    const values = Object.values(statuses);
    const loading = values.filter((status) => status === 'loading').length;
    const ready = values.filter((status) => status === 'ready' || status === 'partial').length;
    const partial = values.filter((status) => status === 'partial').length;
    const unavailable = values.filter((status) => status === 'unavailable' || status === 'failed').length;
    if (loading) return `Loading preview resources · ${ready} of ${PREVIEW_ROSTER.length} loaded`;
    if (unavailable && ready === 0) return 'Preview resources unavailable · retry available';
    if (partial || unavailable) return `Preview resources partially loaded · ${ready} of ${PREVIEW_ROSTER.length}`;
    return `Preview resources loaded · ${ready} of ${PREVIEW_ROSTER.length}`;
  }, [statuses]);

  return { responses, templates, feedTemplates, statusText, page, loadMore, reset };
}
