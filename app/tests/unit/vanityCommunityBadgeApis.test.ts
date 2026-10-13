import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import ffzapHandler from '@/pages/api/twitch/ffzap-badges';
import purpleTvHandler from '@/pages/api/twitch/purpletv-badges';
import jilChatHandler from '@/pages/api/twitch/jilchat-badges';
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
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
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
  } as unknown as NextApiRequest;
  const res = {
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
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

  it('isolates unsafe PurpleTV rows and uses the exact-host fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      defaultBadgeUrl: 'https://nopbreak.ru/shared/badge.png',
      users: [
        { userId: '1', badgeUrl: 'https://attacker.example/one.png' },
        { userId: '2', badgeUrl: 'https://nopbreak.ru/shared/two.png' },
      ],
    })));
    expect(await invoke(purpleTvHandler)).toMatchObject({
      statusCode: 200,
      body: [
        { id: 'donor', title: 'PurpleTV Donor Badge', url: 'https://nopbreak.ru/shared/badge.png', users: ['1'] },
        { id: 'donor', title: 'PurpleTV Donor Badge', url: 'https://nopbreak.ru/shared/two.png', users: ['2'] },
      ],
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

  it('rejects methods and invalid JilChat IDs without upstream work', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke(ffzapHandler, {}, 'POST')).statusCode).toBe(405);
    expect((await invoke(purpleTvHandler, {}, 'POST')).statusCode).toBe(405);
    expect((await invoke(jilChatHandler, { userId: 'name' })).statusCode).toBe(400);
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
