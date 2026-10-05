import { afterEach, describe, expect, it } from 'vitest';
import {
  TWITCH_PINS_ADMISSION_MAX_CLIENTS,
  TWITCH_PINS_ADMISSION_MAX_REQUESTS,
  TWITCH_PINS_ADMISSION_WINDOW_MS,
  TWITCH_PINS_BODY_MAX_BYTES,
  TWITCH_PINS_MAX_CONCURRENT_WORK,
  TwitchPinsAdmissionError,
  TwitchPinsBodyError,
  createTwitchPinsAdmissionController,
  readBoundedTwitchPinsBody,
  twitchPinsClientKey,
} from '@/lib/server/twitchPinsSecurity';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

function streamRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  cancel?: () => void,
): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel,
  });

  return {
    headers: new Headers(headers),
    body,
    signal: new AbortController().signal,
  } as Request;
}

describe('Twitch pins bounded request bodies', () => {
  it('uses the reviewed byte and admission limits', () => {
    expect(TWITCH_PINS_BODY_MAX_BYTES).toBe(4_096);
    expect(TWITCH_PINS_MAX_CONCURRENT_WORK).toBe(16);
    expect(TWITCH_PINS_ADMISSION_WINDOW_MS).toBe(60_000);
    expect(TWITCH_PINS_ADMISSION_MAX_REQUESTS).toBe(360);
    expect(TWITCH_PINS_ADMISSION_MAX_CLIENTS).toBe(2_048);
  });

  it('accepts bodies at the byte boundary', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(TWITCH_PINS_BODY_MAX_BYTES));
    const request = streamRequest([bytes], {
      'content-length': String(bytes.byteLength),
    });

    await expect(readBoundedTwitchPinsBody(request)).resolves.toHaveLength(
      TWITCH_PINS_BODY_MAX_BYTES,
    );
  });

  it('rejects oversized declared length before pulling the stream', async () => {
    let pulled = false;
    let cancelled = false;
    const request = {
      headers: new Headers({
        'content-length': String(TWITCH_PINS_BODY_MAX_BYTES + 1),
      }),
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled = true;
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      signal: new AbortController().signal,
    } as Request;

    await expect(readBoundedTwitchPinsBody(request)).rejects.toMatchObject({
      kind: 'too-large',
      statusCode: 413,
    });
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it.each(['-1', 'NaN', 'Infinity', '1.5', '+10'])(
    'rejects malformed length %s and cancels without reading',
    async (contentLength) => {
      let pulled = false;
      let cancelled = false;
      const request = {
        headers: new Headers({ 'content-length': contentLength }),
        body: new ReadableStream<Uint8Array>({
          pull() {
            pulled = true;
          },
          cancel() {
            cancelled = true;
          },
        }),
        signal: new AbortController().signal,
      } as Request;

      await expect(readBoundedTwitchPinsBody(request)).rejects.toMatchObject({
        kind: 'invalid',
        statusCode: 400,
      });
      expect(pulled).toBe(false);
      expect(cancelled).toBe(true);
    },
  );

  it('handles arbitrarily large digit-only lengths without numeric overflow', async () => {
    const request = streamRequest(
      [new Uint8Array([1])],
      { 'content-length': '9'.repeat(400) },
    );

    await expect(readBoundedTwitchPinsBody(request)).rejects.toMatchObject({
      kind: 'too-large',
      statusCode: 413,
    });
  });

  it('cancels a missing-length stream as soon as its running byte count exceeds the cap', async () => {
    let cancelled = false;
    const request = streamRequest(
      [
        new Uint8Array(TWITCH_PINS_BODY_MAX_BYTES),
        new Uint8Array([1]),
      ],
      {},
      () => { cancelled = true; },
    );

    await expect(readBoundedTwitchPinsBody(request)).rejects.toBeInstanceOf(
      TwitchPinsBodyError,
    );
    expect(cancelled).toBe(true);
  });

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const text = '\u00e9'.repeat(2_049);
    expect(text.length).toBeLessThanOrEqual(TWITCH_PINS_BODY_MAX_BYTES);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(
      TWITCH_PINS_BODY_MAX_BYTES,
    );

    await expect(readBoundedTwitchPinsBody(streamRequest([
      new TextEncoder().encode(text),
    ]))).rejects.toMatchObject({ kind: 'too-large' });
  });
});

describe('Twitch pins client identity and admission', () => {
  it('trusts forwarding headers only in the Vercel runtime', () => {
    const request = {
      headers: new Headers({
        'x-forwarded-for': '203.0.113.20',
        'x-vercel-forwarded-for': '198.51.100.7',
        'x-real-ip': '198.51.100.8',
      }),
    } as Request;

    delete process.env.VERCEL;
    expect(twitchPinsClientKey(request)).toBe('unknown');
    process.env.VERCEL = '1';
    expect(twitchPinsClientKey(request)).toBe('203.0.113.20');
  });

  it('caps concurrent work without a waiter queue and releases idempotently', () => {
    const controller = createTwitchPinsAdmissionController({
      maxConcurrent: 2,
      maxRequests: 10,
      maxClients: 10,
    });
    const releaseOne = controller.acquire('client');
    const releaseTwo = controller.acquire('client');

    expect(controller.statsForTests().active).toBe(2);
    expect(() => controller.acquire('other')).toThrow(TwitchPinsAdmissionError);

    releaseOne();
    releaseOne();
    expect(controller.statsForTests().active).toBe(1);
    const releaseThree = controller.acquire('other');
    releaseTwo();
    releaseThree();
    expect(controller.statsForTests().active).toBe(0);
  });

  it('rate-limits each client and bounds/ages its bucket map', () => {
    const controller = createTwitchPinsAdmissionController({
      maxConcurrent: 10,
      windowMs: 1_000,
      maxRequests: 1,
      maxClients: 2,
    });

    controller.acquire('one', 0)();
    expect(() => controller.acquire('one', 1)).toThrow(TwitchPinsAdmissionError);
    controller.acquire('two', 2)();
    controller.acquire('three', 3)();
    expect(controller.statsForTests().clientBuckets).toBe(2);

    controller.acquire('fresh', 1_003)();
    expect(controller.statsForTests().clientBuckets).toBe(1);
  });
});
