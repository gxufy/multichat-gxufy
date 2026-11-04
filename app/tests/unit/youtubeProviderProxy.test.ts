import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import chatHandler, {
  YOUTUBE_CHAT_CONTINUATION_MAX_CHARS,
} from '@/pages/api/youtube/chat';
import liveHandler from '@/pages/api/youtube/live';
import {
  YOUTUBE_CHAT_MAX_BYTES,
  YOUTUBE_UPSTREAM_TIMEOUT_MS,
  validateYouTubePageUrl,
} from '@/lib/server/youtubeUpstream';
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
  end() { return this; }
}

function request(options: {
  method?: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
} = {}): NextApiRequest {
  return {
    method: options.method ?? 'GET',
    query: options.query ?? {},
    body: options.body,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as NextApiRequest;
}

async function invoke(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>,
  req: NextApiRequest,
) {
  const res = new MockResponse();
  await handler(req, res as unknown as NextApiResponse);
  return res;
}

function html(value: string, init: ResponseInit = {}): Response {
  return new Response(value, { status: 200, ...init });
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const validChatBody = {
  apiKey: 'api_key-123',
  clientVersion: '2.20260925.00.00',
  continuation: 'continuation-token',
};

beforeEach(() => resetFixedProviderResourcesForTests());
afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('YouTube fixed-provider proxy boundaries', () => {
  it('enforces methods and bounded scalar inputs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const liveMethod = await invoke(liveHandler, request({
      method: 'POST',
      query: { channel: 'creator' },
    }));
    expect(liveMethod.statusCode).toBe(405);
    expect(liveMethod.headers.get('allow')).toBe('GET');
    expect((await invoke(liveHandler, request({ query: { channel: ['creator'] } }))).statusCode)
      .toBe(400);

    const chatMethod = await invoke(chatHandler, request({ method: 'GET' }));
    expect(chatMethod.statusCode).toBe(405);
    expect(chatMethod.headers.get('allow')).toBe('POST');
    expect((await invoke(chatHandler, request({ method: 'POST', body: {
      ...validChatBody,
      continuation: 'x'.repeat(YOUTUBE_CHAT_CONTINUATION_MAX_CHARS + 1),
    } }))).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves live discovery, bootstrap, and response shape', async () => {
    const videoId = 'AAAAAAAAAAA';
    const channelId = `UC${'a'.repeat(22)}`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/@creator/live')) {
        return new Response(null, { status: 302, headers: { Location: `/watch?v=${videoId}` } });
      }
      if (url.endsWith('/@creator/shorts')) return html('<html>ordinary shorts</html>');
      if (url.includes('/watch?')) {
        return html(`window.ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { channelId } })};`);
      }
      if (url.includes('/live_chat?')) {
        return html([
          '"INNERTUBE_API_KEY":"api_key-123"',
          '"INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260925.00.00"',
          '"continuation":"continuation-token"',
        ].join(''));
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await invoke(liveHandler, request({ query: { channel: '@creator' } }));
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      videoId,
      apiKey: 'api_key-123',
      clientVersion: '2.20260925.00.00',
      continuation: 'continuation-token',
      channelId,
      videoIds: [videoId],
    });
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
  });

  it('keeps chat on the fixed Innertube host and preserves its JSON body', async () => {
    const upstreamBody = { continuationContents: { liveChatContinuation: { actions: [] } } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(upstreamBody));
    vi.stubGlobal('fetch', fetchMock);
    const response = await invoke(chatHandler, request({ method: 'POST', body: validChatBody }));
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(upstreamBody);
    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstreamUrl.origin).toBe('https://www.youtube.com');
    expect(upstreamUrl.pathname).toBe('/youtubei/v1/live_chat/get_live_chat');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('rejects redirect escape targets without fetching them', async () => {
    expect(() => validateYouTubePageUrl('https://attacker.example/watch?v=AAAAAAAAAAA'))
      .toThrow('untrusted');
    expect(() => validateYouTubePageUrl('https://user@www.youtube.com/watch?v=AAAAAAAAAAA'))
      .toThrow('untrusted');
    expect(() => validateYouTubePageUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA#'))
      .toThrow('untrusted');

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/shorts')) return html('no live short');
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://attacker.example/video' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke(liveHandler, request({ query: { channel: 'creator' } }));
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ offline: true });
    expect(fetchMock.mock.calls.every(([input]) => new URL(String(input)).hostname === 'www.youtube.com'))
      .toBe(true);
  });

  it('rejects oversized chat payloads before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>(), {
      headers: { 'Content-Length': String(YOUTUBE_CHAT_MAX_BYTES + 1) },
    })));
    const response = await invoke(chatHandler, request({ method: 'POST', body: validChatBody }));
    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({ error: 'YouTube chat poll failed' });
  });

  it('aborts a slow chat request and clears the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }));
    const pending = invoke(chatHandler, request({ method: 'POST', body: validChatBody }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(YOUTUBE_UPSTREAM_TIMEOUT_MS);
    expect((await pending).statusCode).toBe(502);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
