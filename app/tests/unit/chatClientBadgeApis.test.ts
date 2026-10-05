import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import chattyHandler, { CHATTY_BADGES_MAX_BYTES } from '@/pages/api/twitch/chatty-badges';
import chatsenHandler, { CHATSEN_BADGES_MAX_BYTES } from '@/pages/api/twitch/chatsen-badges';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoke(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  method = 'GET',
) {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const req = {
    method,
    query: {},
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
  vi.unstubAllGlobals();
});

describe('community chat-client badge API boundaries', () => {
  it('normalizes Chatty supporter badges from the official tduva feed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://tduva.com/res/badges');
      expect(init?.redirect).toBe('error');
      return jsonResponse([{
          id: 'supporter',
          version: '2',
          meta_title: 'Chatty Supporter',
          image_url: 'https://cdn.frankerfacez.com/badge/3/1',
          image_url_2: 'https://cdn.frankerfacez.com/badge/3/2',
          image_url_4: 'https://cdn.frankerfacez.com/badge/3/4',
          color: '#123456',
          usernames: ['TargetUser'],
          userids: ['123'],
        }]);
    }));

    const result = await invoke(chattyHandler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([{
      id: 'supporter-2',
      title: 'Chatty Supporter',
      url: 'https://cdn.frankerfacez.com/badge/3/4',
      users: ['123'],
      usernames: ['TargetUser'],
      color: '#123456',
    }]);
  });

  it('normalizes Chatsen badges using the highest-resolution mipmap', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.chatsen.app/account/badges');
      expect(init?.redirect).toBe('error');
      return jsonResponse([{
          id: 'supporter',
          name: 'Chatsen Supporter',
          description: 'Thanks!',
          mipmap: [
            'https://raw.githubusercontent.com/chatsen/resources/master/badges/supporter-1x.png',
            'https://raw.githubusercontent.com/chatsen/resources/master/badges/supporter-2x.png',
            'https://raw.githubusercontent.com/chatsen/resources/master/badges/supporter-4x.png',
          ],
          users: ['123'],
        }]);
    }));

    const result = await invoke(chatsenHandler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([{
      id: 'supporter',
      title: 'Chatsen Supporter',
      url: 'https://raw.githubusercontent.com/chatsen/resources/master/badges/supporter-4x.png',
      users: ['123'],
    }]);
  });

  it('drops compromised Chatty entries while preserving valid order and variant fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      {
        id: 'valid-one',
        meta_title: 'Valid One',
        image_url_4: 'https://attacker.com/badge.png',
        image_url_2: 'https://api.ffzap.com/v1/user/badge/one/2',
        userids: ['1'],
      },
      { id: 'public', image_url: 'https://attacker.com/badge.png', userids: ['2'] },
      { id: 'local', image_url: 'https://127.0.0.1/badge.png', userids: ['3'] },
      { id: 'credential', image_url: 'https://user@api.ffzap.com/badge.png', userids: ['4'] },
      { id: 'port', image_url: 'https://api.ffzap.com:444/badge.png', userids: ['5'] },
      {
        id: 'valid-two',
        meta_title: 'Valid Two',
        image_url: 'https://tduva.com/img/chatty_badge_1.png',
        userids: ['6'],
      },
    ])));

    const result = await invoke(chattyHandler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([
      {
        id: 'valid-one',
        title: 'Valid One',
        url: 'https://api.ffzap.com/v1/user/badge/one/2',
        users: ['1'],
        usernames: [],
      },
      {
        id: 'valid-two',
        title: 'Valid Two',
        url: 'https://tduva.com/img/chatty_badge_1.png',
        users: ['6'],
        usernames: [],
      },
    ]);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('attacker.com');
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toContain('user@');
    expect(serialized).not.toContain(':444');
    expect(result.headers.get('Cache-Control')).toContain('s-maxage=1800');
  });

  it('drops compromised Chatsen entries while preserving a valid mipmap fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      {
        id: 'valid',
        name: 'Valid',
        mipmap: [
          'https://raw.githubusercontent.com/chatsen/resources/master/badges/valid.png',
          'https://attacker.com/badge.png',
        ],
        users: ['1'],
      },
      { id: 'public', mipmap: ['https://attacker.com/badge.png'], users: ['2'] },
      { id: 'local', mipmap: ['https://localhost/badge.png'], users: ['3'] },
      {
        id: 'credential',
        mipmap: ['https://user@raw.githubusercontent.com/chatsen/resources/badge.png'],
        users: ['4'],
      },
      {
        id: 'port',
        mipmap: ['https://raw.githubusercontent.com:444/chatsen/resources/badge.png'],
        users: ['5'],
      },
    ])));

    const result = await invoke(chatsenHandler);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([{
      id: 'valid',
      title: 'Valid',
      url: 'https://raw.githubusercontent.com/chatsen/resources/master/badges/valid.png',
      users: ['1'],
    }]);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('attacker.com');
    expect(serialized).not.toContain('localhost');
    expect(serialized).not.toContain('user@');
    expect(serialized).not.toContain(':444');
    expect(result.headers.get('Cache-Control')).toContain('s-maxage=1800');
  });

  it('rejects non-GET methods without contacting upstream services', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await invoke(chattyHandler, 'POST')).statusCode).toBe(405);
    expect((await invoke(chatsenHandler, 'POST')).statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Chatty', chattyHandler, CHATTY_BADGES_MAX_BYTES, 'Unable to load Chatty badges.'],
    ['Chatsen', chatsenHandler, CHATSEN_BADGES_MAX_BYTES, 'Unable to load Chatsen badges.'],
  ] as const)('bounds %s upstream JSON before parsing', async (_name, route, maximumBytes, error) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(maximumBytes));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => response));

    const result = await invoke(route);
    expect(result).toMatchObject({ statusCode: 502, body: { error } });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
