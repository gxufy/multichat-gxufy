import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const dns = vi.hoisted(() => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: {
    resolve4: dns.resolve4,
    resolve6: dns.resolve6,
  },
  resolve4: dns.resolve4,
  resolve6: dns.resolve6,
}));

import ttsHandler, {
  config,
  TTS_STREAM_ELEMENTS_TIMEOUT_MS,
  TTS_STREAMLABS_AUDIO_TIMEOUT_MS,
  TTS_STREAMLABS_SYNTHESIS_TIMEOUT_MS,
  TTS_TEXT_MAX_CHARS,
  TTS_VOICE_MAX_CHARS,
  resetTtsResourcesForTests,
  ttsResourceStatsForTests,
} from '@/pages/api/tts';
import {
  TTS_ADMISSION_MAX_CLIENTS,
  TTS_ADMISSION_MAX_REQUESTS,
  TTS_ADMISSION_WINDOW_MS,
  TTS_AUDIO_MAX_BYTES,
  TTS_MAX_CONCURRENT_WORK,
} from '@/lib/server/ttsSecurity';

class MockResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.body = value;
    return this;
  }

  send(value: unknown) {
    this.body = value;
    return this;
  }

  end() {
    return this;
  }
}

function request(
  query: Record<string, string | string[]> = {},
  method = 'GET',
  remoteAddress = '127.0.0.1',
): NextApiRequest {
  return {
    method,
    query,
    headers: {},
    socket: { remoteAddress },
  } as unknown as NextApiRequest;
}

async function invoke(
  query: Record<string, string | string[]> = { text: 'hello', voice: 'Brian' },
  method = 'GET',
  remoteAddress = '127.0.0.1',
) {
  const res = new MockResponse();
  await ttsHandler(request(query, method, remoteAddress), res as unknown as NextApiResponse);
  return res;
}

function audioResponse(bytes: number[] = [1, 2, 3], contentType = 'audio/mpeg'): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

function streamlabsResponse(speakUrl = 'https://polly.streamlabs.com/v1/speech?token=signed') {
  return new Response(JSON.stringify({ speak_url: speakUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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

async function waitForCalls(mock: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  for (let index = 0; index < 100 && mock.mock.calls.length < count; index += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

beforeEach(() => {
  resetTtsResourcesForTests();
  dns.resolve4.mockReset().mockResolvedValue(['8.8.8.8']);
  dns.resolve6.mockReset().mockRejectedValue(Object.assign(new Error('no AAAA'), { code: 'ENODATA' }));
});

afterEach(() => {
  resetTtsResourcesForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/tts input and response compatibility', () => {
  it('uses the reviewed production resource limits', () => {
    expect(TTS_MAX_CONCURRENT_WORK).toBe(8);
    expect(TTS_ADMISSION_MAX_REQUESTS).toBe(30);
    expect(TTS_ADMISSION_WINDOW_MS).toBe(60_000);
    expect(TTS_ADMISSION_MAX_CLIENTS).toBe(2_048);
    expect(TTS_AUDIO_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(config.api.responseLimit).toBe(5 * 1024 * 1024);
    expect(config.api.responseLimit).toBeGreaterThan(TTS_AUDIO_MAX_BYTES);
  });

  it('accepts GET and rejects unsupported methods before upstream work', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal('fetch', fetchMock);

    const get = await invoke();
    expect(get.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const post = await invoke(undefined, 'POST');
    expect(post.statusCode).toBe(405);
    expect(post.body).toEqual({ error: 'Method not allowed.' });
    expect(post.headers.get('allow')).toBe('GET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, empty, array, and overlong text before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalidQueries: Array<Record<string, string | string[]>> = [
      {},
      { text: '' },
      { text: '   ' },
      { text: ['hello'] },
      { text: 'x'.repeat(TTS_TEXT_MAX_CHARS + 1) },
    ];
    for (const query of invalidQueries) {
      const response = await invoke(query);
      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid TTS request.' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed, array, empty, and overlong voices before fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const voice of [
      '',
      'Brian<script>',
      ['Brian'],
      `B${'x'.repeat(TTS_VOICE_MAX_CHARS)}`,
    ]) {
      const response = await invoke({ text: 'hello', voice });
      expect(response.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Brian as the default and accepts the exact text limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse([9, 8, 7]));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invoke({ text: ` ${'x'.repeat(TTS_TEXT_MAX_CHARS)} ` });
    expect(response.statusCode).toBe(200);
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.searchParams.get('voice')).toBe('Brian');
    expect(requested.searchParams.get('text')).toHaveLength(TTS_TEXT_MAX_CHARS);
  });

  it('returns bounded audio with private no-store and nosniff headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse([4, 5, 6]));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invoke();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(Buffer.from([4, 5, 6]));
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('content-length')).toBe('3');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('prefers StreamElements and preserves the Streamlabs fallback', async () => {
    const primary = vi.fn().mockResolvedValue(audioResponse([1]));
    vi.stubGlobal('fetch', primary);
    expect((await invoke()).body).toEqual(Buffer.from([1]));
    expect(primary).toHaveBeenCalledTimes(1);

    resetTtsResourcesForTests();
    const fallback = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(streamlabsResponse())
      .mockResolvedValueOnce(audioResponse([7, 7]));
    vi.stubGlobal('fetch', fallback);
    const response = await invoke();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(Buffer.from([7, 7]));
    expect(fallback).toHaveBeenCalledTimes(3);
    expect(fallback.mock.calls[2][1]).toMatchObject({ redirect: 'manual' });
  });

  it('never fetches an untrusted Streamlabs speak_url', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(streamlabsResponse('https://polly.streamlabs.com.attacker.example/audio.mp3'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invoke();
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ error: 'TTS unavailable.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('/api/tts resource admission', () => {
  it('admits through the concurrency cap, rejects the next request, and recovers', async () => {
    const pending = Array.from(
      { length: TTS_MAX_CONCURRENT_WORK + 1 },
      () => deferred<Response>(),
    );
    let call = 0;
    const fetchMock = vi.fn(() => pending[call++].promise);
    vi.stubGlobal('fetch', fetchMock);

    const active = Array.from({ length: TTS_MAX_CONCURRENT_WORK }, (_, index) => (
      invoke({ text: `message-${index}`, voice: 'Brian' })
    ));
    await waitForCalls(fetchMock, TTS_MAX_CONCURRENT_WORK);
    expect(ttsResourceStatsForTests().active).toBe(TTS_MAX_CONCURRENT_WORK);

    const rejected = await invoke({ text: 'one-too-many', voice: 'Brian' });
    expect(rejected.statusCode).toBe(503);
    expect(rejected.body).toEqual({ error: 'TTS temporarily unavailable.' });
    expect(Number(rejected.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(TTS_MAX_CONCURRENT_WORK);

    pending[0].resolve(audioResponse([1]));
    await active[0];
    const replacement = invoke({ text: 'replacement', voice: 'Brian' });
    await waitForCalls(fetchMock, TTS_MAX_CONCURRENT_WORK + 1);

    for (let index = 1; index < pending.length; index += 1) {
      pending[index].resolve(audioResponse([index]));
    }
    await Promise.all([...active.slice(1), replacement]);
    expect(ttsResourceStatsForTests().active).toBe(0);
  });

  it('releases capacity after failure', async () => {
    const failedFetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', failedFetch);
    const failed = await invoke();
    expect(failed.statusCode).toBe(503);
    expect(ttsResourceStatsForTests().active).toBe(0);

    const recoveredFetch = vi.fn().mockResolvedValue(audioResponse([2]));
    vi.stubGlobal('fetch', recoveredFetch);
    const recovered = await invoke();
    expect(recovered.statusCode).toBe(200);
    expect(ttsResourceStatsForTests().active).toBe(0);
  });

  it('bounds the per-client rate without starting rejected provider work', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => audioResponse([1]));
    vi.stubGlobal('fetch', fetchMock);
    for (let index = 0; index < TTS_ADMISSION_MAX_REQUESTS; index += 1) {
      expect((await invoke({ text: `message-${index}` })).statusCode).toBe(200);
    }
    const rejected = await invoke({ text: 'one-more' });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.body).toEqual({ error: 'Too many TTS requests.' });
    expect(fetchMock).toHaveBeenCalledTimes(TTS_ADMISSION_MAX_REQUESTS);
  });
});

describe('/api/tts upstream timeouts', () => {
  it('aborts a timed-out primary request and continues to the fallback', async () => {
    vi.useFakeTimers();
    let primarySignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: RequestInfo | URL, init?: RequestInit) => {
        primarySignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          primarySignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      })
      .mockResolvedValueOnce(streamlabsResponse())
      .mockResolvedValueOnce(audioResponse([8]));
    vi.stubGlobal('fetch', fetchMock);

    const requestPromise = invoke();
    await waitForCalls(fetchMock, 1);
    await vi.advanceTimersByTimeAsync(TTS_STREAM_ELEMENTS_TIMEOUT_MS);
    const response = await requestPromise;
    expect(response.statusCode).toBe(200);
    expect(primarySignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a timed-out Streamlabs synthesis request', async () => {
    vi.useFakeTimers();
    let synthesisSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementationOnce((_url: RequestInfo | URL, init?: RequestInit) => {
        synthesisSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          synthesisSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const requestPromise = invoke();
    await waitForCalls(fetchMock, 2);
    await vi.advanceTimersByTimeAsync(TTS_STREAMLABS_SYNTHESIS_TIMEOUT_MS);
    const response = await requestPromise;
    expect(response.statusCode).toBe(503);
    expect(synthesisSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a timed-out trusted Streamlabs audio request', async () => {
    vi.useFakeTimers();
    let audioSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(streamlabsResponse())
      .mockImplementationOnce((_url: RequestInfo | URL, init?: RequestInit) => {
        audioSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          audioSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const requestPromise = invoke();
    await waitForCalls(fetchMock, 3);
    await vi.advanceTimersByTimeAsync(TTS_STREAMLABS_AUDIO_TIMEOUT_MS);
    const response = await requestPromise;
    expect(response.statusCode).toBe(503);
    expect(audioSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
