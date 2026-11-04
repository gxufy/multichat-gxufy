import {
  mergePreviewIdentityRetry,
  parsePreviewIdentityResponse,
  type PreviewIdentityProvider,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';
import {
  resolveTwitchCommunityBadgesWithoutJilChat,
} from '@/lib/communityBadges';

type InFlightRequest = {
  readonly controller: AbortController;
  promise: Promise<PreviewIdentityResponse>;
  enrichment: Promise<PreviewIdentityResponse>;
  subscribers: number;
  settled: boolean;
};

const cache = new Map<string, PreviewIdentityResponse>();
const inFlight = new Map<string, InFlightRequest>();

export const PREVIEW_IDENTITY_BROWSER_CACHE_TTL_MS =
  30 * 60_000;

const PREVIEW_IDENTITY_BROWSER_CACHE_PREFIX =
  'gxufy:preview-identity:v1:';

function previewIdentityStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function previewIdentityStorageKey(
  login: string,
): string {
  return `${PREVIEW_IDENTITY_BROWSER_CACHE_PREFIX}${login}`;
}

function isPersistedRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

/*
 * API responses deliberately require HTTPS provider assets.
 *
 * Browser-enriched preview identities can additionally contain our own
 * same-origin badge paths, such as:
 *
 *   /badges/previews/badge_m12.webp
 *   /badges/gxufy/supporter.webp
 *
 * Persisted cache restoration therefore allows exactly HTTPS URLs or safe
 * root-relative paths. Protocol-relative and non-HTTPS schemes stay rejected.
 */
function persistedBadgeUrl(
  value: unknown,
): string | null {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
  ) {
    return null;
  }

  if (
    value.startsWith('/')
    && !value.startsWith('//')
  ) {
    try {
      const base =
        'https://preview-cache.invalid';

      const parsed =
        new URL(
          value,
          base,
        );

      if (
        parsed.origin !== base
        || parsed.username
        || parsed.password
      ) {
        return null;
      }

      return value;
    } catch {
      return null;
    }
  }

  try {
    const parsed =
      new URL(value);

    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function parsePersistedCommunityBadges(
  value: unknown,
): NonNullable<
  PreviewIdentityResponse['communityBadges']
> | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const badges: Array<
    NonNullable<
      PreviewIdentityResponse['communityBadges']
    >[number]
  > = [];

  for (const raw of value) {
    if (
      !isPersistedRecord(raw)
      || typeof raw.type !== 'string'
      || !raw.type.trim()
    ) {
      return null;
    }

    const badge: {
      type: string;
      title?: string;
      version?: string;
      url?: string;
      fallbackUrl?: string;
      backgroundColor?: string;
    } = {
      type: raw.type,
    };

    if (raw.title !== undefined) {
      if (
        typeof raw.title !== 'string'
        || !raw.title.trim()
      ) {
        return null;
      }

      badge.title =
        raw.title;
    }

    if (raw.version !== undefined) {
      if (
        typeof raw.version !== 'string'
        || !raw.version.trim()
      ) {
        return null;
      }

      badge.version =
        raw.version;
    }

    if (raw.url !== undefined) {
      const url =
        persistedBadgeUrl(
          raw.url,
        );

      if (!url) {
        return null;
      }

      badge.url =
        url;
    }

    if (raw.fallbackUrl !== undefined) {
      const fallbackUrl =
        persistedBadgeUrl(
          raw.fallbackUrl,
        );

      if (!fallbackUrl) {
        return null;
      }

      badge.fallbackUrl =
        fallbackUrl;
    }

    if (raw.backgroundColor !== undefined) {
      if (
        typeof raw.backgroundColor !== 'string'
        || !/^#[0-9a-f]{6}$/i.test(
          raw.backgroundColor,
        )
      ) {
        return null;
      }

      badge.backgroundColor =
        raw.backgroundColor;
    }

    badges.push(
      badge,
    );
  }

  return badges;
}

function parsePersistedPreviewIdentity(
  value: unknown,
): PreviewIdentityResponse | null {
  if (!isPersistedRecord(value)) {
    return null;
  }

  /*
   * Let the normal API parser remain authoritative for identity/provider
   * resources. Only browser-enriched community badges use the persisted-cache
   * validator because those can legitimately contain same-origin asset paths.
   */
  const {
    communityBadges:
      rawCommunityBadges,
    ...apiShape
  } = value;

  const parsed =
    parsePreviewIdentityResponse(
      apiShape,
    );

  if (!parsed) {
    return null;
  }

  const communityBadges =
    parsePersistedCommunityBadges(
      rawCommunityBadges,
    );

  if (communityBadges === null) {
    return null;
  }

  return {
    ...parsed,
    ...(communityBadges !== undefined
      ? { communityBadges }
      : {}),
  };
}

function readPersistedPreviewIdentity(
  login: string,
): PreviewIdentityResponse | null {
  const storage =
    previewIdentityStorage();

  if (!storage) {
    return null;
  }

  const key =
    previewIdentityStorageKey(login);

  try {
    const raw =
      storage.getItem(key);

    if (!raw) {
      return null;
    }

    const stored =
      JSON.parse(raw) as {
        cachedAt?: unknown;
        response?: unknown;
      };

    if (
      typeof stored.cachedAt !== 'number'
      || !Number.isFinite(stored.cachedAt)
      || stored.cachedAt > Date.now()
      || Date.now() - stored.cachedAt
        > PREVIEW_IDENTITY_BROWSER_CACHE_TTL_MS
    ) {
      storage.removeItem(key);
      return null;
    }

    const response =
      parsePersistedPreviewIdentity(
        stored.response,
      );

    if (
      !response
      || response.identity.login !== login
    ) {
      storage.removeItem(key);
      return null;
    }

    cache.set(
      login,
      response,
    );

    return response;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore inaccessible browser storage.
    }

    return null;
  }
}

function persistPreviewIdentity(
  login: string,
  response: PreviewIdentityResponse,
): void {
  const storage =
    previewIdentityStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      previewIdentityStorageKey(login),
      JSON.stringify({
        cachedAt: Date.now(),
        response,
      }),
    );
  } catch {
    /*
     * Preview persistence is only a speed optimization. Storage limits or
     * privacy-mode failures must never affect the preview itself.
     */
  }
}

function clearPersistedPreviewIdentitiesForTests(): void {
  const storage =
    previewIdentityStorage();

  if (!storage) {
    return;
  }

  try {
    const keys: string[] = [];

    for (
      let index = 0;
      index < storage.length;
      index += 1
    ) {
      const key =
        storage.key(index);

      if (
        key?.startsWith(
          PREVIEW_IDENTITY_BROWSER_CACHE_PREFIX,
        )
      ) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // Tests can also run without usable browser storage.
  }
}

function requestKey(login: string, providers: readonly PreviewIdentityProvider[] | null): string {
  return `${login}|${providers ? [...providers].sort().join(',') : 'all'}`;
}

export function cachedPreviewIdentity(login: string): PreviewIdentityResponse | null {
  return (
    cache.get(login)
    ?? readPersistedPreviewIdentity(login)
    ?? null
  );
}

/**
 * Persist an asynchronously enriched preview response so reset/cycling keeps
 * deferred badges instead of reverting to the pre-hydration snapshot.
 */
export function updateCachedPreviewIdentity(
  login: string,
  response: PreviewIdentityResponse,
): void {
  if (response.identity.login !== login) return;
  cache.set(login, response);
  persistPreviewIdentity(login, response);
}

export function acquirePreviewIdentity(
  login: string,
  providers: readonly PreviewIdentityProvider[] | null = null,
): {
  promise: Promise<PreviewIdentityResponse>;
  enrichment: Promise<PreviewIdentityResponse>;
  release: () => void;
} {
  const normalizedProviders =
    providers
      ? [...providers].sort()
      : null;

  const key =
    requestKey(
      login,
      normalizedProviders,
    );

  let request =
    inFlight.get(key);

  if (!request) {
    const controller =
      new AbortController();

    const params =
      new URLSearchParams({
        login,
      });

    if (normalizedProviders) {
      params.set(
        'providers',
        normalizedProviders.join(','),
      );
    }

    const next:
    InFlightRequest = {
      controller,
      subscribers: 0,
      settled: false,
      promise:
        Promise.resolve(
          null as never,
        ),
      enrichment:
        Promise.resolve(
          null as never,
        ),
    };

    /*
     * Fast path:
     * return usable Twitch/provider identity as soon as the API responds.
     * Community badge catalogs must not hold up the visible preview.
     */
    next.promise =
      fetch(
        `/api/twitch/preview-identity?${params.toString()}`,
        {
          signal:
            controller.signal,
        },
      )
        .then(
          async (result) => {
            if (!result.ok) {
              throw new Error(
                result.status === 404
                  ? 'not-found'
                  : 'request-failed',
              );
            }

            const parsed =
              parsePreviewIdentityResponse(
                await result.json(),
              );

            if (
              !parsed
              || parsed.identity.login
                !== login
            ) {
              throw new Error(
                'invalid-response',
              );
            }

            const current =
              cache.get(login);

            const merged =
              normalizedProviders
              && current
                ? mergePreviewIdentityRetry(
                    current,
                    parsed,
                  )
                : parsed;

            if (!merged) {
              throw new Error(
                'invalid-response',
              );
            }

            cache.set(
              login,
              merged,
            );

            persistPreviewIdentity(
              login,
              merged,
            );

            return merged;
          },
        )
        .finally(() => {
          next.settled = true;
        });

    /*
     * Slow path:
     * enrich the already-visible identity with community badges afterward.
     */
    next.enrichment =
      next.promise
        .then(
          async (merged) => {
            if (
              merged.communityBadges
              !== undefined
            ) {
              return merged;
            }

            try {
              const communityBadges =
                await resolveTwitchCommunityBadgesWithoutJilChat({
                  userId:
                    merged.identity
                      .userId,
                  login:
                    merged.identity
                      .login,
                  displayName:
                    merged.identity
                      .displayName,
                });

              const enriched:
              PreviewIdentityResponse = {
                ...merged,
                communityBadges,
              };

              updateCachedPreviewIdentity(
                login,
                enriched,
              );

              return enriched;
            } catch {
              return merged;
            }
          },
        )
        .finally(() => {
          inFlight.delete(key);
        });

    request = next;

    inFlight.set(
      key,
      request,
    );
  }

  request.subscribers += 1;

  let released = false;

  return {
    promise:
      request.promise,

    enrichment:
      request.enrichment,

    release: () => {
      if (released) return;

      released = true;

      request!.subscribers -= 1;

      if (
        !request!.settled
        && request!.subscribers
          === 0
      ) {
        request!
          .controller
          .abort();
      }
    },
  };
}
export function __dropPreviewIdentityMemoryCacheForTests(): void {
  cache.clear();
}

export function __resetPreviewIdentityClient(): void {
  for (const request of inFlight.values()) {
    request.controller.abort();
  }

  inFlight.clear();
  cache.clear();
  clearPersistedPreviewIdentitiesForTests();
}
