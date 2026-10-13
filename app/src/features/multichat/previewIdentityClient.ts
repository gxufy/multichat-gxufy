import {
  mergePreviewIdentityRetry,
  parsePreviewIdentityResponse,
  type PreviewIdentityProvider,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';

type InFlightRequest = {
  readonly controller: AbortController;
  promise: Promise<PreviewIdentityResponse>;
  subscribers: number;
  settled: boolean;
};

const cache = new Map<string, PreviewIdentityResponse>();
const inFlight = new Map<string, InFlightRequest>();

function requestKey(login: string, providers: readonly PreviewIdentityProvider[] | null): string {
  return `${login}|${providers ? [...providers].sort().join(',') : 'all'}`;
}

export function cachedPreviewIdentity(login: string): PreviewIdentityResponse | null {
  return cache.get(login) ?? null;
}

export function acquirePreviewIdentity(
  login: string,
  providers: readonly PreviewIdentityProvider[] | null = null,
): { promise: Promise<PreviewIdentityResponse>; release: () => void } {
  const normalizedProviders = providers ? [...providers].sort() : null;
  const key = requestKey(login, normalizedProviders);
  let request = inFlight.get(key);

  if (!request) {
    const controller = new AbortController();
    const params = new URLSearchParams({ login });
    if (normalizedProviders) params.set('providers', normalizedProviders.join(','));
    const next: InFlightRequest = {
      controller,
      subscribers: 0,
      settled: false,
      promise: Promise.resolve(null as never),
    };
    next.promise = fetch(`/api/twitch/preview-identity?${params.toString()}`, {
      signal: controller.signal,
    }).then(async (result) => {
      if (!result.ok) throw new Error(result.status === 404 ? 'not-found' : 'request-failed');
      const parsed = parsePreviewIdentityResponse(await result.json());
      if (!parsed || parsed.identity.login !== login) throw new Error('invalid-response');
      const current = cache.get(login);
      const merged = normalizedProviders && current
        ? mergePreviewIdentityRetry(current, parsed)
        : parsed;
      if (!merged) throw new Error('invalid-response');
      cache.set(login, merged);
      return merged;
    }).finally(() => {
      next.settled = true;
      inFlight.delete(key);
    });
    request = next;
    inFlight.set(key, request);
  }

  request.subscribers += 1;
  let released = false;
  return {
    promise: request.promise,
    release: () => {
      if (released) return;
      released = true;
      request!.subscribers -= 1;
      if (!request!.settled && request!.subscribers === 0) request!.controller.abort();
    },
  };
}

export function __resetPreviewIdentityClient(): void {
  for (const request of inFlight.values()) request.controller.abort();
  inFlight.clear();
  cache.clear();
}
