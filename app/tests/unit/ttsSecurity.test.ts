import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest } from 'next';
import {
  TTS_AUDIO_MAX_BYTES,
  TtsAdmissionError,
  createTtsAdmissionController,
  fetchTrustedTtsAudio,
  isRestrictedTtsAddress,
  readBoundedAudioResponse,
  readBoundedResponseBody,
  ttsClientKey,
  validateTrustedTtsAudioUrl,
  withTtsAbortTimeout,
} from '@/lib/server/ttsSecurity';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

function request(
  remoteAddress: string,
  headers: NextApiRequest['headers'] = {},
): NextApiRequest {
  return { headers, socket: { remoteAddress } } as unknown as NextApiRequest;
}

function audioResponse(
  bytes: Uint8Array,
  contentType = 'audio/mpeg',
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { 'Content-Type': contentType, ...headers },
  });
}

describe('TTS admission', () => {
  it('uses trusted forwarding headers only under Vercel', () => {
    const req = request('::ffff:127.0.0.1', {
      'x-forwarded-for': '203.0.114.10',
      'x-vercel-forwarded-for': '198.18.0.1',
      'x-real-ip': '198.18.0.2',
    });
    delete process.env.VERCEL;
    expect(ttsClientKey(req)).toBe('127.0.0.1');
    process.env.VERCEL = '1';
    expect(ttsClientKey(req)).toBe('203.0.114.10');
  });

  it('caps concurrent work without a queue and releases exactly once', () => {
    const controller = createTtsAdmissionController({
      maxConcurrent: 2,
      maxRequests: 10,
      maxClients: 10,
    });
    const releaseOne = controller.acquire('client');
    const releaseTwo = controller.acquire('client');
    expect(controller.statsForTests().active).toBe(2);
    expect(() => controller.acquire('client')).toThrow(TtsAdmissionError);

    releaseOne();
    releaseOne();
    expect(controller.statsForTests().active).toBe(1);
    const releaseThree = controller.acquire('client');
    expect(controller.statsForTests().active).toBe(2);
    releaseTwo();
    releaseThree();
    expect(controller.statsForTests().active).toBe(0);
  });

  it('bounds client storage, rejects excess admissions, and prunes stale buckets', () => {
    const controller = createTtsAdmissionController({
      maxConcurrent: 10,
      windowMs: 1_000,
      maxRequests: 1,
      maxClients: 2,
    });
    controller.acquire('one', 0)();
    expect(() => controller.acquire('one', 1)).toThrow(TtsAdmissionError);
    controller.acquire('two', 2)();
    controller.acquire('three', 3)();
    expect(controller.statsForTests().clientBuckets).toBe(2);
    controller.acquire('fresh', 1_003)();
    expect(controller.statsForTests().clientBuckets).toBe(1);
  });
});

describe('TTS timeouts and bounded response reads', () => {
  it('aborts timed work and clears its timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = withTtsAbortTimeout(100, (nextSignal) => {
      signal = nextSignal;
      return new Promise((_resolve, reject) => {
        nextSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const rejection = expect(pending).rejects.toThrow('upstream timeout');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts small, exact-boundary, and missing-length audio payloads', async () => {
    await expect(readBoundedAudioResponse(audioResponse(new Uint8Array([1, 2, 3])), 3))
      .resolves.toMatchObject({ bytes: Buffer.from([1, 2, 3]), contentType: 'audio/mpeg' });
    await expect(readBoundedAudioResponse(audioResponse(
      new Uint8Array([4, 5]),
      'audio/mp3; charset=binary',
    ), 2)).resolves.toMatchObject({ bytes: Buffer.from([4, 5]) });
  });

  it('rejects oversized Content-Length before pulling the stream', async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ pull, cancel }), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(TTS_AUDIO_MAX_BYTES + 1),
      },
    });
    await expect(readBoundedAudioResponse(response)).rejects.toThrow('too large');
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels chunked bodies as soon as the running byte limit is exceeded', async () => {
    const cancel = vi.fn();
    let sent = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
      cancel,
    }), { headers: { 'Content-Type': 'audio/mpeg' } });
    await expect(readBoundedAudioResponse(response, 3)).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds non-audio bodies and rejects unexpected MIME types', async () => {
    await expect(readBoundedResponseBody(
      new Response(new Uint8Array([1, 2, 3])),
      3,
    )).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(readBoundedAudioResponse(audioResponse(
      new TextEncoder().encode('<html>not audio</html>'),
      'text/html',
    ))).rejects.toThrow('content type');
    await expect(readBoundedAudioResponse(audioResponse(
      new TextEncoder().encode('{}'),
      'application/json',
    ))).rejects.toThrow('content type');
  });
});

describe('Streamlabs audio destination policy', () => {
  const publicResolver = vi.fn(async () => ['8.8.8.8', '2606:4700:4700::1111']);

  it('accepts only the exact trusted HTTPS hostname with public DNS results', async () => {
    const result = await validateTrustedTtsAudioUrl(
      'https://polly.streamlabs.com/v1/speech?token=signed',
      publicResolver,
    );
    expect(result.hostname).toBe('polly.streamlabs.com');

    const rejected = [
      'http://polly.streamlabs.com/v1/speech',
      'https://user:pass@polly.streamlabs.com/v1/speech',
      'https://polly.streamlabs.com/v1/speech#fragment',
      'https://polly.streamlabs.com.attacker.example/v1/speech',
      'https://localhost/v1/speech',
      'https://127.0.0.1/v1/speech',
      'https://[::1]/v1/speech',
    ];
    for (const url of rejected) {
      await expect(validateTrustedTtsAudioUrl(url, publicResolver)).rejects.toThrow();
    }
  });

  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '127.0.0.1',
    '169.254.1.2',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:1::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
  ])('rejects a trusted hostname resolving to %s', async (address) => {
    expect(isRestrictedTtsAddress(address)).toBe(true);
    await expect(validateTrustedTtsAudioUrl(
      'https://polly.streamlabs.com/v1/speech',
      async () => ['8.8.8.8', address],
    )).rejects.toThrow('destination');
  });

  it('fails closed on an empty DNS result', async () => {
    await expect(validateTrustedTtsAudioUrl(
      'https://polly.streamlabs.com/v1/speech',
      async () => [],
    )).rejects.toThrow('destination');
  });

  it('follows only manually validated trusted redirects within the limit', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: '/v1/second?token=two' },
      }))
      .mockResolvedValueOnce(audioResponse(new Uint8Array([7, 8, 9])));

    await expect(fetchTrustedTtsAudio(
      'https://polly.streamlabs.com/v1/first?token=one',
      {
        fetchImpl: fetchMock as typeof fetch,
        resolveAddresses: publicResolver,
        timeoutMs: 1_000,
      },
    )).resolves.toMatchObject({ bytes: Buffer.from([7, 8, 9]) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('rejects untrusted redirects before issuing the redirected request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.example/audio.mp3' },
    }));
    await expect(fetchTrustedTtsAudio(
      'https://polly.streamlabs.com/v1/first',
      {
        fetchImpl: fetchMock as typeof fetch,
        resolveAddresses: publicResolver,
        timeoutMs: 1_000,
      },
    )).rejects.toThrow('untrusted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects redirect chains beyond the configured limit', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { Location: '/again' },
    }));
    await expect(fetchTrustedTtsAudio(
      'https://polly.streamlabs.com/start',
      {
        fetchImpl: fetchMock as typeof fetch,
        resolveAddresses: publicResolver,
        timeoutMs: 1_000,
        maximumRedirects: 2,
      },
    )).rejects.toThrow('too many');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
