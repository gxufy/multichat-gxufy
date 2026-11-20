import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler, { __resetJilTVCosmeticsForTests } from '@/pages/api/jiltv/cosmetics';
import {
  JILTV_CATALOG_URL,
  JILTV_GRAPHQL_URL,
  jiltvCosmeticsServerEnabled,
} from '@/lib/server/jiltvCosmetics';
import {
  buildJilTVPaintStyle,
  isJilTVAssetUrl,
  parseJilTVCatalog,
  parseJilTVUserCosmetics,
  parseJilTVUserResponse,
} from '@/lib/jiltvCosmeticsContract';
import {
  JILTV_COSMETICS_ENABLED,
  __resetJilTVCosmeticsClientForTests,
  lookupJilTVCosmetics,
} from '@/lib/jiltvCosmetics';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';

/* Shape copied from the live catalog (2026-11-15), trimmed. */
const MOLTEN_GOLD = {
  id: '01M5Q3S869E87B1QV8ZEWEHJSJ',
  name: 'Molten Gold',
  v: 2,
  data: {
    v: 1,
    layers: [{ id: 'gold', kind: 'linear', angle: 100 }],
    shadows: [{ x: 0, y: 0, blur: 5, color: '#ffb30059' }],
    fallback: '#e7be6cff',
  },
  by: ['Jilence'],
  texture: {
    url: 'https://cdn.jiltv.app/paints/8e6c43fd.webp',
    still: 'https://cdn.jiltv.app/paints/8e6c43fd-0.webp',
    w: 360,
    h: 54,
  },
};
const CATALOG = { paints: [MOLTEN_GOLD], badges: [], decorations: [], cdn: 'https://cdn.jiltv.app' };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function userAnswer(user: unknown) {
  return json({ data: { userByPlatform: user } });
}

async function call(query: Record<string, unknown>, method = 'GET') {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string>();
  const req = {
    method,
    query,
    headers: {},
    socket: { remoteAddress: '203.0.113.20' },
  } as unknown as NextApiRequest;
  const res = {
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return { statusCode, body, headers };
}

describe('JilTV cosmetics contract', () => {
  it('reads paints from the catalog with JilTV-only asset URLs', () => {
    const catalog = parseJilTVCatalog({
      ...CATALOG,
      paints: [
        MOLTEN_GOLD,
        { ...MOLTEN_GOLD, id: 'evil', texture: { url: 'https://evil.example/p.webp' } },
        { ...MOLTEN_GOLD, id: 'breaker', texture: { url: 'https://cdn.jiltv.app/a").webp' } },
        { ...MOLTEN_GOLD, id: 'plain', texture: { url: 'http://cdn.jiltv.app/p.webp' } },
      ],
    });
    expect([...catalog!.paints.keys()]).toEqual([MOLTEN_GOLD.id]);
    expect(catalog!.paints.get(MOLTEN_GOLD.id)).toEqual({
      id: MOLTEN_GOLD.id,
      name: 'Molten Gold',
      texture: MOLTEN_GOLD.texture.url,
      still: MOLTEN_GOLD.texture.still,
      fallback: '#e7be6cff',
      shadows: [{ x: 0, y: 0, blur: 5, color: '#ffb30059' }],
    });
    expect(parseJilTVCatalog({ nope: true })).toBeNull();
  });

  it('only trusts jiltv.app hosts', () => {
    expect(isJilTVAssetUrl('https://cdn.jiltv.app/x.webp')).toBe(true);
    expect(isJilTVAssetUrl('https://jiltv.app.evil.com/x.webp')).toBe(false);
    expect(isJilTVAssetUrl('https://user:pw@cdn.jiltv.app/x.webp')).toBe(false);
    expect(isJilTVAssetUrl('https://cdn.jiltv.app:8443/x.webp')).toBe(false);
    expect(isJilTVAssetUrl('javascript:alert(1)')).toBe(false);
  });

  it('reads what a user wears, and treats unknown users as wearing nothing', () => {
    expect(parseJilTVUserResponse({ data: { userByPlatform: null } })).toEqual({ paintId: null, badge: null });
    expect(parseJilTVUserResponse({
      data: {
        userByPlatform: {
          paint: { id: MOLTEN_GOLD.id },
          badge: { id: 'b1', name: 'Founder', imageUrl: 'https://cdn.jiltv.app/badges/b1.webp' },
        },
      },
    })).toEqual({
      paintId: MOLTEN_GOLD.id,
      badge: { id: 'b1', title: 'Founder', url: 'https://cdn.jiltv.app/badges/b1.webp' },
    });
    expect(parseJilTVUserResponse({
      data: { userByPlatform: { paint: null, badge: { id: 'b2', imageUrl: 'https://evil.example/b.png' } } },
    })).toEqual({ paintId: null, badge: null });
    expect(parseJilTVUserResponse({ errors: [{ message: 'x' }] })).toBeNull();
  });

  it('turns a paint into name CSS with a fallback colour, shadows and a still frame for reduced motion', () => {
    const paint = parseJilTVCatalog(CATALOG)!.paints.get(MOLTEN_GOLD.id)!;
    expect(buildJilTVPaintStyle(paint, true)).toEqual({
      background: `url("${MOLTEN_GOLD.texture.url}"), linear-gradient(#e7be6cff, #e7be6cff)`,
      filter: 'drop-shadow(0px 0px 5px #ffb30059)',
    });
    expect(buildJilTVPaintStyle(paint, false).filter).toBe('');
    expect(buildJilTVPaintStyle(paint, true, true).background).toContain(MOLTEN_GOLD.texture.still);
    expect(buildJilTVPaintStyle({ ...paint, texture: 'https://evil.example/x.webp' }, true)).toEqual({ background: '', filter: '' });
  });

  it('re-checks what the browser gets back', () => {
    const parsed = parseJilTVUserCosmetics({
      paint: { id: 'p1', name: 'P', texture: 'https://evil.example/p.webp', shadows: [] },
      badge: { id: 'b1', title: 'B', url: 'https://cdn.jiltv.app/b.webp' },
    });
    expect(parsed).toEqual({ paint: null, badge: { id: 'b1', title: 'B', url: 'https://cdn.jiltv.app/b.webp' } });
  });
});

describe('JilTV cosmetics release gate', () => {
  it('is off unless explicitly enabled', () => {
    expect(JILTV_COSMETICS_ENABLED).toBe(false);
    expect(jiltvCosmeticsServerEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(jiltvCosmeticsServerEnabled({ GXUFY_JILTV_COSMETICS_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(jiltvCosmeticsServerEnabled({ GXUFY_JILTV_COSMETICS_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the overlay never asks while the gate is off', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await lookupJilTVCosmetics('438697907')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the API answers 404 while the gate is off', async () => {
    vi.stubEnv('GXUFY_JILTV_COSMETICS_ENABLED', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await call({ userId: '438697907' });
    expect(result.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});

describe('JilTV cosmetics API (gate on)', () => {
  beforeEach(() => {
    vi.stubEnv('GXUFY_JILTV_COSMETICS_ENABLED', '1');
    __resetJilTVCosmeticsForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetFixedProviderResourcesForTests();
  });

  it('joins the worn paint with the catalog and caches the answer', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.redirect).toBe('error');
      if (url === JILTV_GRAPHQL_URL) {
        expect(JSON.parse(String(init?.body)).variables).toEqual({ id: '438697907' });
        return userAnswer({ paint: { id: MOLTEN_GOLD.id }, badge: null });
      }
      if (url === JILTV_CATALOG_URL) return json(CATALOG, { headers: { etag: '"v1"' } });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await call({ userId: '438697907' });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({ paint: { id: MOLTEN_GOLD.id, texture: MOLTEN_GOLD.texture.url }, badge: null });
    const second = await call({ userId: '438697907' });
    expect(second.body).toEqual(first.body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers "nothing" for people not on JilTV without loading the catalog', async () => {
    const fetchMock = vi.fn(async () => userAnswer(null));
    vi.stubGlobal('fetch', fetchMock);
    const result = await call({ userId: '1' });
    expect(result).toMatchObject({ statusCode: 200, body: { paint: null, badge: null } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects bad ids and methods, and hides upstream failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect((await call({ userId: 'gxufy' })).statusCode).toBe(400);
    expect((await call({ userId: ['1', '2'] })).statusCode).toBe(400);
    expect((await call({ userId: '1' }, 'POST')).statusCode).toBe(405);
    const failed = await call({ userId: '2' });
    expect(failed.statusCode).toBe(502);
    expect(failed.body).toEqual({ error: 'Unable to load JilTV cosmetics.' });
  });

  it('drops paints missing from the catalog, without re-fetching the catalog more than once a minute', async () => {
    let catalogCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === JILTV_GRAPHQL_URL) return userAnswer({ paint: { id: 'BRANDNEW' }, badge: null });
      catalogCalls += 1;
      return json(CATALOG);
    }));
    const result = await call({ userId: '3' });
    expect(result.body).toEqual({ paint: null, badge: null });
    expect(catalogCalls).toBe(1);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await call({ userId: '4' });
    expect(catalogCalls).toBe(2);
    clock.mockRestore();
  });
});

describe('JilTV lookup in the browser (gate forced on)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetJilTVCosmeticsClientForTests();
  });

  it('asks our proxy, never JilTV directly', async () => {
    const fetchMock = vi.fn(async () => json({
      paint: { id: 'p1', name: 'P', texture: 'https://cdn.jiltv.app/p.webp', shadows: [] },
      badge: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await lookupJilTVCosmetics('42', true);
    expect(fetchMock).toHaveBeenCalledWith('/api/jiltv/cosmetics?userId=42', expect.anything());
    expect(result?.paint?.texture).toBe('https://cdn.jiltv.app/p.webp');
  });
});
