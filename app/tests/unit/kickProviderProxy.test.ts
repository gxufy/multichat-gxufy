import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import channelHandler, {
  KICK_CHANNEL_MAX_BYTES,
  KICK_CHANNEL_TIMEOUT_MS,
} from '@/pages/api/kick/channel';
import historyHandler, { KICK_HISTORY_MAX_BYTES } from '@/pages/api/kick/history';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';

class MockResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();
  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }
  status(code: number) { this.statusCode = code; return this; }
  json(value: unknown) { this.body = value; return this; }
}

function request(
  query: Record<string, string | string[]> = {},
  method = 'GET',
): NextApiRequest {
  return {
    method,
    query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
}

async function invoke(
  handler: typeof channelHandler,
  query: Record<string, string | string[]> = {},
  method = 'GET',
) {
  const res = new MockResponse();
  await handler(request(query, method), res as unknown as NextApiResponse);
  return res;
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

beforeEach(() => resetFixedProviderResourcesForTests());
afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Kick fixed-provider proxy routes', () => {
  it('enforces methods and rejects ambiguous or unsafe identifiers before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const method = await invoke(channelHandler, { channel: 'valid' }, 'POST');
    expect(method.statusCode).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect((await invoke(channelHandler, { channel: ['valid'] })).statusCode).toBe(400);
    expect((await invoke(channelHandler, { channel: 'https://attacker.example' })).statusCode).toBe(400);
    expect((await invoke(historyHandler, { channelId: ['123'] })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves Kick channel normalization, fixed host, and response shape', async () => {
    const body = { id: 1, slug: 'Creator_Name' };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invoke(channelHandler, { channel: '@Creator_Name' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(body);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://kick.com/api/v2/channels/Creator_Name');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('preserves Kick history payloads and the numeric fixed path', async () => {
    const body = { data: { messages: [{ id: 'new' }, { id: 'old' }] } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invoke(historyHandler, { channelId: '123' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(body);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://kick.com/api/v2/channels/123/messages');
  });

  it('coalesces identical channel lookups without coalescing different routes', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const first = invoke(channelHandler, { channel: 'same' });
    const second = invoke(channelHandler, { channel: 'same' });
    const history = invoke(historyHandler, { channelId: '123' });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(jsonResponse({ ok: true }));
    await expect(Promise.all([first, second, history])).resolves.toHaveLength(3);
  });

  it('rejects declared and chunked oversized payloads', async () => {
    const declared = new Response(new ReadableStream<Uint8Array>(), {
      headers: { 'Content-Length': String(KICK_CHANNEL_MAX_BYTES + 1) },
    });
    let sent = false;
    const chunked = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new Uint8Array(KICK_HISTORY_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(declared)
      .mockResolvedValueOnce(chunked);
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke(channelHandler, { channel: 'one' })).statusCode).toBe(502);
    expect((await invoke(historyHandler, { channelId: '2' })).statusCode).toBe(502);
  });

  it('aborts a slow channel request, releases work, and clears its timer', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = invoke(channelHandler, { channel: 'slow' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(KICK_CHANNEL_TIMEOUT_MS);
    expect((await pending).statusCode).toBe(502);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ recovered: true })));
    expect((await invoke(channelHandler, { channel: 'recovered' })).statusCode).toBe(200);
  });
});
