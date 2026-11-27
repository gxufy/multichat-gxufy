import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import ffzapHandler from '@/api/twitch/ffzap-badges';
import jilChatHandler from '@/api/twitch/jilchat-badges';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';
import {
  VANITY_BADGE_RESPONSE_MAX_BYTES,
  resetVanityCommunityBadgeCachesForTests,
} from '@/lib/server/vanityCommunityBadges';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoke(
  handler: (req: ApiRequest, res: ApiResponse) => unknown,
  query: Record<string, string | string[]> = {},
  method = 'GET',
) {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const req = {
    method,
    query,
    headers: {},
    socket: { remoteAddress: '203.0.113.10' },
  } as unknown as ApiRequest;
  const res = {
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as ApiResponse;
  return Promise.resolve(handler(req, res)).then(() => ({ statusCode, body, headers }));
}

afterEach(() => {
  resetFixedProviderResourcesForTests();
  resetVanityCommunityBadgeCachesForTests();
  vi.unstubAllGlobals();
});

describe('Vanity community badge API boundaries', () => {
  it('returns only normalized FFZ:AP assignments', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.ffzap.com/v1/supporters');
      expect(init?.redirect).toBe('error');
      return jsonResponse([
        { id: '123', badge_color: '#812FA8', badge_is_colored: 1, tier: 3 },
        { id: 'bad' },
      ]);
    }));
    const result = await invoke(ffzapHandler);
    expect(result).toMatchObject({
      statusCode: 200,
      body: [{
        id: 'supporter', title: 'FFZ:AP Supporter',
        url: 'https://api.ffzap.com/v1/user/badge/123/3', users: ['123'],
        color: '#812FA8',
      }],
    });
  });


  it('combines the JilChat catalog with deduplicated per-user owned slugs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.jil.chat/v1/badges') {
        return jsonResponse([{ slug: 'carrot', name: 'JilChat Carrot', image_url: 'https://api.jil.chat/carrot.png' }]);
      }
      expect(url).toBe('https://api.jil.chat/v1/badges/user/418724417/all');
      return jsonResponse([{ slug: 'carrot' }, { slug: 'carrot' }]);
    }));
    expect(await invoke(jilChatHandler, { userId: '418724417' })).toMatchObject({
      statusCode: 200,
      body: [{ id: 'carrot', title: 'JilChat Carrot', url: 'https://api.jil.chat/carrot.png' }],
    });
  });

  it('without a user id, returns the whole JilChat list so overlays ask once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { slug: 'first', name: 'JilChat First', image_url: 'https://api.jil.chat/first.png', users: [{ twitch_id: '7' }, { twitch_id: '8' }] },
      { slug: 'owner', name: 'JilChat Owner', image_url: 'https://api.jil.chat/owner.png', users: [] },
    ])));
    const result = await invoke(jilChatHandler);
    expect(result).toMatchObject({
      statusCode: 200,
      body: {
        listsUsers: true,
        badges: [{ id: 'first', title: 'JilChat First', url: 'https://api.jil.chat/first.png', userIds: ['7', '8'] }],
      },
    });
    expect(result.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=300');
  });

  it('rejects methods and invalid JilChat IDs without upstream work', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke(ffzapHandler, {}, 'POST')).statusCode).toBe(405);
    expect((await invoke(jilChatHandler, { userId: 'name' })).statusCode).toBe(400);
    expect((await invoke(jilChatHandler, { userId: ['1', '2'] })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a generic error and cancels an oversized upstream response', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(VANITY_BADGE_RESPONSE_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    }))));
    expect(await invoke(ffzapHandler)).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to load FFZ:AP badges.' },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
