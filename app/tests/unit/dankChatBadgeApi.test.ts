import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { DANKCHAT_BADGES_MAX_BYTES } from '@/pages/api/twitch/dankchat-badges';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoke(method = 'GET') {
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
    setHeader: (name: string, value: string) => headers.set(name, value),
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as NextApiResponse;
  return handler(req, res).then(() => ({ statusCode, body, headers }));
}

afterEach(() => {
  resetFixedProviderResourcesForTests();
  vi.unstubAllGlobals();
});

describe('DankChat badge API boundary', () => {
  it('forwards only valid official DankChat badge assignments', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://flxrs.com/api/badges');
      expect(init?.redirect).toBe('error');
      return jsonResponse([
          { type: 'DankChat', url: 'https://flxrs.com/dankchat/badges/dank.png', users: ['123', 456] },
          { type: 'bad', url: 'http://flxrs.com/dankchat/badges/insecure.png', users: ['123'] },
          { type: '', url: 'https://flxrs.com/dankchat/badges/no-title.png', users: ['123'] },
          { type: 'empty', url: 'https://flxrs.com/dankchat/badges/no-users.png', users: [] },
        ]);
    }));

    const result = await invoke();
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([
      { type: 'DankChat', url: 'https://flxrs.com/dankchat/badges/dank.png', users: ['123', '456'] },
    ]);
    expect(result.headers.get('Cache-Control')).toContain('s-maxage=1800');
  });

  it('rejects non-GET methods without contacting the upstream API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await invoke('POST');
    expect(result.statusCode).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a generic 502 for malformed upstream payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ badges: [] })));
    const result = await invoke();
    expect(result.statusCode).toBe(502);
    expect(result.body).toEqual({ error: 'Unable to load DankChat badges.' });
  });

  it('drops compromised feed entries without failing unrelated valid badges', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { type: 'Valid One', url: 'https://flxrs.com/dankchat/badges/one.png', users: ['1'] },
      { type: 'Public', url: 'https://attacker.com/badge.png', users: ['2'] },
      { type: 'Local', url: 'https://192.168.1.1/badge.png', users: ['3'] },
      { type: 'Credential', url: 'https://user@flxrs.com/badge.png', users: ['4'] },
      { type: 'Port', url: 'https://flxrs.com:444/badge.png', users: ['5'] },
      { type: 'Valid Two', url: 'https://flxrs.com/dankchat/badges/two.png', users: ['6'] },
    ])));

    const result = await invoke();
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([
      { type: 'Valid One', url: 'https://flxrs.com/dankchat/badges/one.png', users: ['1'] },
      { type: 'Valid Two', url: 'https://flxrs.com/dankchat/badges/two.png', users: ['6'] },
    ]);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('attacker.com');
    expect(serialized).not.toContain('192.168.1.1');
    expect(serialized).not.toContain('user@');
    expect(serialized).not.toContain(':444');
    expect(result.headers.get('Cache-Control')).toContain('s-maxage=1800');
  });

  it('cancels an oversized chunked upstream body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(DANKCHAT_BADGES_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => response));

    expect(await invoke()).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to load DankChat badges.' },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
