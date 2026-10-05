import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  failedPreviewIdentityProviders,
  mergePreviewIdentityRetry,
  parsePreviewIdentityResponse,
  type PreviewIdentityProvider,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';

export type TwitchPreviewIdentityStatus =
  | 'idle'
  | 'loading'
  | 'retrying'
  | 'success'
  | 'partial'
  | 'not-found'
  | 'error';

export type TwitchPreviewIdentityState = {
  readonly input: string;
  readonly response: PreviewIdentityResponse | null;
  readonly status: TwitchPreviewIdentityStatus;
  readonly failedProviders: readonly PreviewIdentityProvider[];
  setInput: (value: string) => void;
  load: () => void;
  retryFailed: () => void;
  reset: () => void;
};

function normalizeLogin(value: string): string | null {
  const normalized = value.trim().replace(/^[@#]/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(normalized) ? normalized : null;
}

function settledStatus(response: PreviewIdentityResponse): TwitchPreviewIdentityStatus {
  return Object.values(response.providers).some((provider) => provider?.status === 'failed')
    ? 'partial'
    : 'success';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useTwitchPreviewIdentity(): TwitchPreviewIdentityState {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState<PreviewIdentityResponse | null>(null);
  const [status, setStatus] = useState<TwitchPreviewIdentityStatus>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  const request = useCallback(
    (login: string, providers: readonly PreviewIdentityProvider[] | null, current: PreviewIdentityResponse | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestRef.current;
      const retrying = providers !== null;
      setStatus(retrying ? 'retrying' : 'loading');
      if (!retrying && current?.identity.login !== login) setResponse(null);

      const params = new URLSearchParams({ login });
      if (providers) params.set('providers', providers.join(','));

      void fetch(`/api/twitch/preview-identity?${params.toString()}`, {
        signal: controller.signal,
      }).then(async (result) => {
        if (!aliveRef.current || requestId !== requestRef.current || controller.signal.aborted) return;
        if (result.status === 404) {
          setResponse(null);
          setStatus('not-found');
          return;
        }
        if (!result.ok) throw new Error('preview identity request failed');
        const parsed = parsePreviewIdentityResponse(await result.json());
        if (!parsed) throw new Error('invalid preview identity response');
        if (!aliveRef.current || requestId !== requestRef.current || controller.signal.aborted) return;
        const next = retrying && current ? mergePreviewIdentityRetry(current, parsed) : parsed;
        if (!next) throw new Error('incompatible preview identity retry');
        setResponse(next);
        setStatus(settledStatus(next));
      }).catch((error: unknown) => {
        if (
          isAbort(error) ||
          controller.signal.aborted ||
          !aliveRef.current ||
          requestId !== requestRef.current
        ) return;
        if (!retrying) setResponse(null);
        setStatus('error');
      });
    },
    [],
  );

  const load = useCallback(() => {
    const login = normalizeLogin(input);
    if (!login) {
      abortRef.current?.abort();
      requestRef.current += 1;
      setResponse(null);
      setStatus('error');
      return;
    }
    request(login, null, response);
  }, [input, request, response]);

  const failedProviders = useMemo(
    () => (response ? failedPreviewIdentityProviders(response) : []),
    [response],
  );

  const retryFailed = useCallback(() => {
    if (!response) return;
    const failed = failedPreviewIdentityProviders(response);
    if (!failed.length) return;
    request(response.identity.login, failed, response);
  }, [request, response]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestRef.current += 1;
    setInput('');
    setResponse(null);
    setStatus('idle');
  }, []);

  return {
    input,
    response,
    status,
    failedProviders,
    setInput,
    load,
    retryFailed,
    reset,
  };
}
