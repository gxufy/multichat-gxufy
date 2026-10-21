import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  failedPreviewIdentityProviders,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';
import {
  acquirePreviewIdentity,
  cachedPreviewIdentity,
  updateCachedPreviewIdentity,
} from '@/features/multichat/previewIdentityClient';
import {
  PREVIEW_ROSTER,
  PREVIEW_ROSTER_CONCURRENCY,
  rosterFeedTemplates,
  rosterTemplates,
} from '@/features/multichat/previewRoster';
import {
  loadPreviewBttvProBadges,
} from '@/features/multichat/previewBttvPro';
import {
  resolveTwitchJilChatBadges,
} from '@/lib/communityBadges';
import type { UnifiedBadge } from '@/lib/types';

export type PreviewRosterMemberStatus = 'loading' | 'ready' | 'partial' | 'unavailable' | 'failed';

type StatusMap = Readonly<Record<string, PreviewRosterMemberStatus>>;

const PREVIEW_JILCHAT_CONCURRENCY = 2;

type DeferredJilChatEntry = {
  readonly generation: number;
  readonly login: string;
  readonly userId: string;
};

function mergeDeferredBadges(
  current: readonly UnifiedBadge[] | undefined,
  additions: readonly UnifiedBadge[],
): readonly UnifiedBadge[] {
  const badges = [...(current ?? [])];
  const keys = new Set(
    badges.map((badge) => [
      badge.type,
      badge.version ?? '',
      badge.url ?? '',
    ].join('|')),
  );

  for (const badge of additions) {
    const key = [
      badge.type,
      badge.version ?? '',
      badge.url ?? '',
    ].join('|');

    if (keys.has(key)) continue;
    keys.add(key);
    badges.push(badge);
  }

  return badges;
}

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
  const jilChatQueueRef = useRef<DeferredJilChatEntry[]>([]);
  const jilChatStartedRef = useRef(new Set<string>());
  const jilChatActiveRef = useRef(0);
  const bttvProStartedRef = useRef(false);

  const drainDeferredJilChat = useCallback(() => {
    while (
      jilChatActiveRef.current < PREVIEW_JILCHAT_CONCURRENCY
      && jilChatQueueRef.current.length > 0
    ) {
      const next = jilChatQueueRef.current.shift();

      if (!next) break;

      if (next.generation !== generationRef.current) {
        continue;
      }

      jilChatActiveRef.current += 1;

      void resolveTwitchJilChatBadges(next.userId)
        .then((badges) => {
          if (
            next.generation !== generationRef.current
            || badges.length === 0
          ) {
            return;
          }

          setResponses((current) => {
            const response = current.get(next.login);

            if (!response) return current;

            const communityBadges = mergeDeferredBadges(
              response.communityBadges,
              badges,
            );

            const updated: PreviewIdentityResponse = {
              ...response,
              communityBadges,
            };

            updateCachedPreviewIdentity(
              next.login,
              updated,
            );

            return new Map(current).set(
              next.login,
              updated,
            );
          });
        })
        .finally(() => {
          jilChatActiveRef.current = Math.max(
            0,
            jilChatActiveRef.current - 1,
          );

          drainDeferredJilChat();
        });
    }
  }, []);

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
    if (Object.values(statuses).some((status) => status === 'loading')) return;

    for (const [login, response] of responses) {
      if (jilChatStartedRef.current.has(login)) {
        continue;
      }

      if (
        response.communityBadges?.some(
          (badge) => badge.type.startsWith('community:jilchat:'),
        )
      ) {
        jilChatStartedRef.current.add(login);
        continue;
      }

      jilChatStartedRef.current.add(login);

      jilChatQueueRef.current.push({
        generation: generationRef.current,
        login,
        userId: response.identity.userId,
      });
    }

    drainDeferredJilChat();
  }, [drainDeferredJilChat, responses, statuses]);

  useEffect(() => {
    const uncached = PREVIEW_ROSTER.filter((entry) => !cachedPreviewIdentity(entry.login)).map((entry) => entry.login);
    load(uncached);
    return () => {
      generationRef.current += 1;
      for (const release of releasesRef.current) release();
      releasesRef.current.clear();
      jilChatQueueRef.current.splice(0);
      jilChatStartedRef.current.clear();
      bttvProStartedRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (bttvProStartedRef.current) return;

    const statusValues = Object.values(statuses);

    if (
      statusValues.some((status) => status === 'loading')
      || responses.size === 0
    ) {
      return;
    }

    const generation = generationRef.current;
    const identityResponses = [...responses.entries()];

    bttvProStartedRef.current = true;

    void loadPreviewBttvProBadges(
      identityResponses.map(([, response]) => ({
        userId: response.identity.userId,
      })),
    ).then((badgesByUserId) => {
      if (
        generation !== generationRef.current
        || badgesByUserId.size === 0
      ) {
        return;
      }

      setResponses((current) => {
        let changed = false;
        const updatedResponses = new Map(current);

        for (const [login, response] of current) {
          const badgeUrl = badgesByUserId.get(
            response.identity.userId,
          );

          if (!badgeUrl) continue;

          /*
           * Auto-select Pro only when the BTTV provider slot
           * is otherwise empty. An already-selected regular BTTV badge wins.
           */
          if (
            (response.providers.BTTV?.resources.ownedBadges ?? [])
              .length > 0
          ) {
            continue;
          }

          const proBadge: UnifiedBadge = {
            type: 'community:bttv:bttv-pro',
            title: 'BetterTTV Pro',
            url: badgeUrl,
          };

          const communityBadges = mergeDeferredBadges(
            response.communityBadges,
            [proBadge],
          );

          if (
            communityBadges.length
            === (response.communityBadges ?? []).length
          ) {
            continue;
          }

          const updated: PreviewIdentityResponse = {
            ...response,
            communityBadges,
          };

          updateCachedPreviewIdentity(
            login,
            updated,
          );

          updatedResponses.set(
            login,
            updated,
          );

          changed = true;
        }

        return changed
          ? updatedResponses
          : current;
      });
    });
  }, [responses, statuses]);

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
    bttvProStartedRef.current = false;
    jilChatStartedRef.current.clear();
    jilChatQueueRef.current.splice(0);
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
