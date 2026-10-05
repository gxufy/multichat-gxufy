import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, {
  TWITCH_PROFILE_MAX_BYTES,
  __resetTwitchProfileResourcesForTests,
} from '@/pages/api/twitch/profile';
import { parseTwitchProfile } from '@/lib/twitchProfileClient';
import {
  FIXED_PROVIDER_MAX_CONCURRENT_WORK,
  fixedProviderResourceStatsForTests,
  resetFixedProviderResourcesForTests,
} from '@/lib/server/fixedProviderProxy';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoke(id: string, ip = '203.0.113.10') {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const req = {
    method: 'GET',
    query: { id },
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as NextApiRequest;
  const res = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
  return Promise.resolve(handler(req, res)).then(() => ({ statusCode, body, headers }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetTwitchProfileResourcesForTests();
  resetFixedProviderResourcesForTests();
});

afterEach(() => {
  __resetTwitchProfileResourcesForTests();
  resetFixedProviderResourcesForTests();
  vi.unstubAllGlobals();
});

describe('Twitch profile API and client validation', () => {
  it('returns only a matching canonical room profile with fixed redirect policy', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => jsonResponse({
      data: { user: { id: '200', displayName: 'Partner', profileImageURL: 'https://cdn.example/p.png' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await invoke('200')).toMatchObject({
      statusCode: 200,
      body: { roomId: '200', displayName: 'Partner', profileImageUrl: 'https://cdn.example/p.png' },
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('error');
  });

  it('rejects invalid IDs, mismatches, and unsafe artwork', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke('bad')).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(parseTwitchProfile({ roomId: '201', displayName: 'Wrong' }, '200')).toBeNull();
    expect(parseTwitchProfile({ roomId: '200', displayName: 'Partner', profileImageUrl: 'http://bad/p.png' }, '200')).toBeNull();
  });

  it('coalesces same-room work and releases admission after success and failure', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);

    const first = invoke('300', '203.0.113.11');
    const second = invoke('300', '203.0.113.12');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fixedProviderResourceStatsForTests()).toMatchObject({ active: 1, inFlight: 1 });

    pending.resolve(jsonResponse({ data: { user: { id: '300', displayName: 'Shared' } } }));
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    await vi.waitFor(() => expect(fixedProviderResourceStatsForTests()).toMatchObject({ active: 0, inFlight: 0 }));

    __resetTwitchProfileResourcesForTests();
    const retryFetch = vi.fn()
      .mockRejectedValueOnce(new Error('private upstream detail'))
      .mockResolvedValueOnce(jsonResponse({ data: { user: { id: '301', displayName: 'Recovered' } } }));
    vi.stubGlobal('fetch', retryFetch);
    expect((await invoke('301')).statusCode).toBe(502);
    expect((await invoke('301')).statusCode).toBe(200);
    expect(retryFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects global overload before starting more upstream work', async () => {
    const pending: Array<{ id: string; work: ReturnType<typeof deferred<Response>> }> = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as { variables: { id: string } };
      const work = deferred<Response>();
      pending.push({ id: requestBody.variables.id, work });
      return work.promise;
    });
    vi.stubGlobal('fetch', fetchMock);

    const requests = Array.from({ length: FIXED_PROVIDER_MAX_CONCURRENT_WORK }, (_, index) => (
      invoke(String(1_000 + index), `203.0.113.${index + 20}`)
    ));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(FIXED_PROVIDER_MAX_CONCURRENT_WORK));

    const rejected = await invoke('99999', '198.51.100.20');
    expect(rejected.statusCode).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(FIXED_PROVIDER_MAX_CONCURRENT_WORK);

    for (const { id, work } of pending) {
      work.resolve(jsonResponse({ data: { user: { id, displayName: `User ${id}` } } }));
    }
    expect((await Promise.all(requests)).every((result) => result.statusCode === 200)).toBe(true);
  });

  it('rejects malformed and oversized provider JSON without exposing it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{private malformed body'))
      .mockResolvedValueOnce(new Response('x', {
        headers: { 'Content-Length': String(TWITCH_PROFILE_MAX_BYTES + 1) },
      }));
    vi.stubGlobal('fetch', fetchMock);

    for (const id of ['400', '401']) {
      const result = await invoke(id);
      expect(result).toMatchObject({
        statusCode: 502,
        body: { error: 'Unable to load Twitch profile.' },
      });
      expect(JSON.stringify(result.body)).not.toContain('private malformed body');
    }
  });
});
