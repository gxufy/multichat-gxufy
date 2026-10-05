import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TWITCH_PINS_ADMISSION_MAX_REQUESTS,
  TWITCH_PINS_BODY_MAX_BYTES,
  TWITCH_PINS_MAX_CONCURRENT_WORK,
  resetTwitchPinsResourcesForTests,
  twitchPinsResourceStatsForTests,
} from '@/lib/server/twitchPinsSecurity';

const helpers = vi.hoisted(() => ({
  getStoredPin: vi.fn(),
  getColor: vi.fn(),
  getBadges: vi.fn(),
  isActive: vi.fn(),
}));

vi.mock('@/lib/server/twitchStoredChannelPin', () => ({
  getStoredTwitchChannelPin: helpers.getStoredPin,
}));
vi.mock('@/lib/server/twitchStoredUserChatColor', () => ({
  getStoredTwitchUserChatColor: helpers.getColor,
}));
vi.mock('@/lib/server/twitchStoredPinnedAuthorBadges', () => ({
  getStoredTwitchPinnedAuthorBadges: helpers.getBadges,
}));
vi.mock('@/lib/server/twitchConnectionReader', () => ({
  isTwitchConnectionActive: helpers.isActive,
}));

import * as pinsRoute from '@/app/api/twitch/pins/route';

const CONNECTION_ID = '01234567-89ab-cdef-0123-456789abcdef';
const VALID_BODY = JSON.stringify({ connectionId: CONNECTION_ID, login: 'channel' });
const originalVercel = process.env.VERCEL;

function broadcasterWithoutPin() {
  return {
    broadcaster: {
      userId: '1234',
      login: 'channel',
      displayName: 'Channel',
    },
    pin: null,
  };
}

function broadcasterWithPin() {
  return {
    broadcaster: {
      userId: '1234',
      login: 'channel',
      displayName: 'Channel',
    },
    pin: {
      messageId: 'pin-1',
      broadcasterId: '1234',
      senderUserId: '5678',
      senderUserLogin: 'sender',
      senderUserName: 'Sender',
      pinnedByUserId: '1234',
      pinnedByUserLogin: 'channel',
      pinnedByUserName: 'Channel',
      text: 'Hello',
      emotes: [],
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: null,
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
  };
}

function jsonRequest(
  body = VALID_BODY,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/twitch/pins', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

function streamRouteRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  cancel?: () => void,
): Request {
  let index = 0;
  return {
    headers: new Headers({
      'content-type': 'application/json',
      ...headers,
    }),
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[index]);
        index += 1;
      },
      cancel,
    }),
    signal: new AbortController().signal,
  } as Request;
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
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
  resetTwitchPinsResourcesForTests();
  helpers.getStoredPin.mockReset().mockResolvedValue(broadcasterWithoutPin());
  helpers.getColor.mockReset().mockResolvedValue('#ABCDEF');
  helpers.getBadges.mockReset().mockResolvedValue([
    { type: 'moderator', version: '1' },
  ]);
  helpers.isActive.mockReset().mockResolvedValue(true);
  delete process.env.VERCEL;
});

afterEach(() => {
  resetTwitchPinsResourcesForTests();
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

describe('/api/twitch/pins bounded body handling', () => {
  it('preserves a normal pin lookup and its display-safe response', async () => {
    helpers.getStoredPin.mockResolvedValueOnce(broadcasterWithPin());
    const response = await pinsRoute.POST(jsonRequest());

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual({
      broadcaster: { login: 'channel', displayName: 'Channel' },
      pin: expect.objectContaining({
        messageId: 'pin-1',
        senderUserId: '5678',
        color: '#ABCDEF',
        badges: [{ type: 'moderator', version: '1' }],
        text: 'Hello',
      }),
    });
    expect(helpers.getStoredPin).toHaveBeenCalledWith(CONNECTION_ID, 'channel');
    expect(helpers.getColor).toHaveBeenCalledWith(CONNECTION_ID, '5678');
    expect(helpers.getBadges).toHaveBeenCalledWith(CONNECTION_ID, '1234', '5678');
    expect(twitchPinsResourceStatsForTests().active).toBe(0);
  });

  it('accepts a valid JSON request padded to exactly 4096 bytes', async () => {
    const padding = TWITCH_PINS_BODY_MAX_BYTES - new TextEncoder().encode(VALID_BODY).byteLength;
    const body = `${VALID_BODY}${' '.repeat(padding)}`;
    expect(new TextEncoder().encode(body)).toHaveLength(TWITCH_PINS_BODY_MAX_BYTES);

    const response = await pinsRoute.POST(jsonRequest(body, {
      'content-length': String(TWITCH_PINS_BODY_MAX_BYTES),
    }));
    expect(response.status).toBe(200);
    expect(helpers.getStoredPin).toHaveBeenCalledTimes(1);
  });

  it('rejects declared oversize before reading or starting stored/Twitch work', async () => {
    let pulled = false;
    let cancelled = false;
    const response = await pinsRoute.POST({
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': String(TWITCH_PINS_BODY_MAX_BYTES + 1),
      }),
      body: new ReadableStream<Uint8Array>({
        pull() { pulled = true; },
        cancel() { cancelled = true; },
      }),
      signal: new AbortController().signal,
    } as Request);

    expect(response.status).toBe(413);
    expect(await responseBody(response)).toEqual({
      error: 'Twitch pin request body too large.',
    });
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
    expect(helpers.getStoredPin).not.toHaveBeenCalled();
  });

  it('rejects a lying or missing length when the streamed body reaches 4097 bytes', async () => {
    const headerCases: Array<Record<string, string>> = [
      {},
      { 'content-length': '1' },
    ];

    for (const headers of headerCases) {
      helpers.getStoredPin.mockClear();
      let cancelled = false;
      const response = await pinsRoute.POST(streamRouteRequest(
        [
          new Uint8Array(TWITCH_PINS_BODY_MAX_BYTES),
          new Uint8Array([1]),
        ],
        headers,
        () => { cancelled = true; },
      ));

      expect(response.status).toBe(413);
      expect(cancelled).toBe(true);
      expect(helpers.getStoredPin).not.toHaveBeenCalled();
    }
  });

  it('rejects a multibyte body by encoded byte count', async () => {
    const text = '\u00e9'.repeat(2_049);
    expect(text.length).toBeLessThan(TWITCH_PINS_BODY_MAX_BYTES);
    const response = await pinsRoute.POST(streamRouteRequest([
      new TextEncoder().encode(text),
    ]));

    expect(response.status).toBe(413);
    expect(helpers.getStoredPin).not.toHaveBeenCalled();
  });

  it('handles malformed Content-Length as a bounded invalid request', async () => {
    const response = await pinsRoute.POST(streamRouteRequest(
      [new TextEncoder().encode(VALID_BODY)],
      { 'content-length': 'not-a-number' },
    ));

    expect(response.status).toBe(400);
    expect(await responseBody(response)).toEqual({ error: 'Invalid Twitch pin request.' });
    expect(helpers.getStoredPin).not.toHaveBeenCalled();
  });
});

describe('/api/twitch/pins admission and compatibility', () => {
  it('keeps content-type, UUID/schema validation, and supported methods unchanged', async () => {
    const unsupported = await pinsRoute.POST(jsonRequest(VALID_BODY, {
      'content-type': 'text/plain',
    }));
    expect(unsupported.status).toBe(415);

    const invalid = await pinsRoute.POST(jsonRequest(JSON.stringify({
      connectionId: 'not-a-capability',
      login: 'channel',
    })));
    expect(invalid.status).toBe(400);
    expect(helpers.getStoredPin).not.toHaveBeenCalled();

    const exports = pinsRoute as Record<string, unknown>;
    expect(exports.POST).toBeTypeOf('function');
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(exports[method]).toBeUndefined();
    }
  });

  it('rejects excess global concurrency without starting more work, then recovers', async () => {
    const pending = deferred<ReturnType<typeof broadcasterWithoutPin>>();
    helpers.getStoredPin.mockImplementation(() => pending.promise);

    const active = Array.from(
      { length: TWITCH_PINS_MAX_CONCURRENT_WORK },
      () => pinsRoute.POST(jsonRequest()),
    );
    await waitForCalls(helpers.getStoredPin, TWITCH_PINS_MAX_CONCURRENT_WORK);
    expect(twitchPinsResourceStatsForTests().active).toBe(
      TWITCH_PINS_MAX_CONCURRENT_WORK,
    );

    const rejected = await pinsRoute.POST(jsonRequest());
    expect(rejected.status).toBe(503);
    expect(await responseBody(rejected)).toEqual({
      error: 'Twitch pin service temporarily unavailable.',
    });
    expect(helpers.getStoredPin).toHaveBeenCalledTimes(TWITCH_PINS_MAX_CONCURRENT_WORK);

    pending.resolve(broadcasterWithoutPin());
    await Promise.all(active);
    expect(twitchPinsResourceStatsForTests().active).toBe(0);

    helpers.getStoredPin.mockResolvedValueOnce(broadcasterWithoutPin());
    expect((await pinsRoute.POST(jsonRequest())).status).toBe(200);
  });

  it('bounds one client rate before stored/Twitch work', async () => {
    process.env.VERCEL = '1';
    const headers = { 'x-forwarded-for': '203.0.113.10' };

    for (let index = 0; index < TWITCH_PINS_ADMISSION_MAX_REQUESTS; index += 1) {
      expect((await pinsRoute.POST(jsonRequest(VALID_BODY, headers))).status).toBe(200);
    }

    const rejected = await pinsRoute.POST(jsonRequest(VALID_BODY, headers));
    expect(rejected.status).toBe(429);
    expect(await responseBody(rejected)).toEqual({
      error: 'Too many Twitch pin requests.',
    });
    expect(helpers.getStoredPin).toHaveBeenCalledTimes(
      TWITCH_PINS_ADMISSION_MAX_REQUESTS,
    );
  });

  it('releases permits after helper failure', async () => {
    helpers.getStoredPin.mockRejectedValueOnce(new Error('private upstream detail'));
    const failed = await pinsRoute.POST(jsonRequest());
    expect(failed.status).toBe(500);
    const failedBody = JSON.stringify(await responseBody(failed));
    expect(failedBody).not.toContain('private upstream detail');
    expect(failedBody).not.toContain(CONNECTION_ID);
    expect(twitchPinsResourceStatsForTests().active).toBe(0);
  });

  it('holds an aborted caller permit until non-abortable helper work settles', async () => {
    const pending = deferred<ReturnType<typeof broadcasterWithoutPin>>();
    helpers.getStoredPin.mockImplementationOnce(() => pending.promise);
    const controller = new AbortController();
    const request = new Request('http://localhost/api/twitch/pins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: VALID_BODY,
      signal: controller.signal,
    });
    const responsePromise = pinsRoute.POST(request);
    await waitForCalls(helpers.getStoredPin, 1);
    controller.abort();
    expect(twitchPinsResourceStatsForTests().active).toBe(1);
    pending.resolve(broadcasterWithoutPin());

    expect((await responsePromise).status).toBe(200);
    expect(twitchPinsResourceStatsForTests().active).toBe(0);
  });

  it('does not allocate limiter state for repeated empty requests', async () => {
    for (let index = 0; index < 20; index += 1) {
      expect((await pinsRoute.POST(jsonRequest(''))).status).toBe(400);
    }
    expect(twitchPinsResourceStatsForTests()).toEqual({
      active: 0,
      clientBuckets: 0,
    });
    expect(helpers.getStoredPin).not.toHaveBeenCalled();
  });
});
