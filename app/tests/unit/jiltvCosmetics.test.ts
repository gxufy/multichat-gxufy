import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler, { __resetJilTVCosmeticsForTests } from '@/api/jiltv/cosmetics';
import {
  JILTV_CATALOG_URL,
  JILTV_LOOKS_URL,
  jiltvCosmeticsServerEnabled,
} from '@/lib/server/jiltvCosmetics';
import {
  buildJilTVPaintStyle,
  isJilTVAssetUrl,
  parseJilTVCatalog,
  parseJilTVLooks,
  parseJilTVPaintAnswer,
} from '@/lib/jiltvCosmeticsContract';
import {
  JILTV_CLIENT_BATCH_WINDOW_MS,
  JILTV_COSMETICS_ENABLED,
  __resetJilTVCosmeticsClientForTests,
  createJilTVPaintLookups,
  lookupJilTVPaint,
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
/* A paint JilTV has no baked texture for (shape from the live catalog, 2026-11-24). */
const HAZARD = {
  id: '01M5TBADDDFWXTBG30A90BDEQ7',
  name: 'Hazard',
  v: 2,
  data: {
    v: 1,
    layers: [{ id: 'tape', kind: 'pattern', pattern: 'stripes' }],
    shadows: [{ x: 0, y: 0, blur: 8, color: '#00000000' }],
    fallback: '#806c2eff',
  },
  by: ['Jilence'],
};
/* A tiling texture (same catalog). */
const ANDROID = {
  id: '01M5TCPBHMFJ8BX1VCFQWEP8ST',
  name: 'Android',
  v: 2,
  data: {
    v: 1,
    layers: [{ id: 'feed', kind: 'linear', angle: 100 }],
    shadows: [{ x: -1, y: 0, blur: 0, color: '#ff0040cc' }],
    fallback: '#5cae54ff',
  },
  by: ['Jilence'],
  texture: {
    url: 'https://cdn.jiltv.app/paints/461f944f.webp',
    still: 'https://cdn.jiltv.app/paints/461f944f-0.webp',
    tile: true,
    w: 420,
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

/* JilTV's chat-client lookup answer: logins wearing nothing are left out. */
function looks(users: Record<string, unknown>) {
  return json({ users });
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
  } as unknown as ApiRequest;
  const res = {
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as ApiResponse;
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

  it('reads what each login wears from the chat-client lookup', () => {
    expect(parseJilTVLooks({
      users: {
        jilence: { p: MOLTEN_GOLD.id, b: '01M7QCME61F1FTM4XTCPMVDGHN', d: '01M7TREE5TFHWSGDKNGTVAYEZC' },
        Gxufy: { p: ANDROID.id },
        nopaint: { b: 'b1' },
        'bad login!': { p: MOLTEN_GOLD.id },
        weird: { p: 'not an id!' },
      },
    })).toEqual(new Map([['jilence', MOLTEN_GOLD.id], ['gxufy', ANDROID.id]]));
    expect(parseJilTVLooks({ users: {} })).toEqual(new Map());
    expect(parseJilTVLooks({ errors: [] })).toBeNull();
    expect(parseJilTVLooks(null)).toBeNull();
  });

  it('turns a paint into name CSS with a fallback colour, shadows and a still frame for reduced motion', () => {
    const paint = parseJilTVCatalog(CATALOG)!.paints.get(MOLTEN_GOLD.id)!;
    expect(buildJilTVPaintStyle(paint, true)).toEqual({
      background: `url("${MOLTEN_GOLD.texture.url}"), linear-gradient(#e7be6cff, #e7be6cff)`,
      filter: 'drop-shadow(0px 0px 5px #ffb30059)',
      size: '100% 100%',
      repeat: 'no-repeat',
    });
    expect(buildJilTVPaintStyle(paint, false).filter).toBe('');
    expect(buildJilTVPaintStyle(paint, true, true).background).toContain(MOLTEN_GOLD.texture.still);
    expect(buildJilTVPaintStyle({ ...paint, texture: 'https://evil.example/x.webp' }, true)).toEqual({ background: '', filter: '' });
  });

  it('draws a paint without a texture in its fallback colour', () => {
    const paint = parseJilTVCatalog({ paints: [HAZARD] })!.paints.get(HAZARD.id)!;
    expect(paint).toEqual({
      id: HAZARD.id,
      name: 'Hazard',
      fallback: '#806c2eff',
      shadows: [{ x: 0, y: 0, blur: 8, color: '#00000000' }],
    });
    expect(buildJilTVPaintStyle(paint, true)).toEqual({
      background: 'linear-gradient(#806c2eff, #806c2eff)',
      filter: 'drop-shadow(0px 0px 8px #00000000)',
      size: '100% 100%',
      repeat: 'no-repeat',
    });
    expect(buildJilTVPaintStyle(paint, true, true).background).toBe('linear-gradient(#806c2eff, #806c2eff)');
    /* Neither a texture nor a colour: nothing to draw. */
    const bare = { ...HAZARD, id: 'bare', data: { ...HAZARD.data, fallback: 'red' } };
    expect(parseJilTVCatalog({ paints: [bare] })!.paints.size).toBe(0);
  });

  it('repeats a tiling texture sideways at its own width', () => {
    const paint = parseJilTVCatalog({ paints: [ANDROID] })!.paints.get(ANDROID.id)!;
    expect(paint.tileWidth).toBe(420);
    expect(buildJilTVPaintStyle(paint, false)).toEqual({
      background: `url("${ANDROID.texture.url}"), linear-gradient(#5cae54ff, #5cae54ff)`,
      filter: '',
      size: '420px 100%',
      repeat: 'repeat-x',
    });
    /* Without a usable width it is stretched like any other texture. */
    const noWidth = { ...ANDROID, id: 'nowidth', texture: { ...ANDROID.texture, w: 'wide' } };
    const stretched = parseJilTVCatalog({ paints: [noWidth] })!.paints.get('nowidth')!;
    expect(stretched.tileWidth).toBeUndefined();
    expect(buildJilTVPaintStyle(stretched, false).size).toBe('100% 100%');
  });

  it('passes the tiling width and texture-less paints through to the browser', () => {
    const android = parseJilTVCatalog({ paints: [ANDROID] })!.paints.get(ANDROID.id)!;
    const hazard = parseJilTVCatalog({ paints: [HAZARD] })!.paints.get(HAZARD.id)!;
    const roundTrip = (paint: unknown) => parseJilTVPaintAnswer(JSON.parse(JSON.stringify({ paints: { x: paint } })))!.get('x');
    expect(roundTrip(android)).toEqual(android);
    expect(roundTrip(hazard)).toEqual(hazard);
    expect(roundTrip(null)).toBeNull();
  });

  it('re-checks what the browser gets back', () => {
    const parsed = parseJilTVPaintAnswer({
      paints: {
        evil: { id: 'p1', name: 'P', texture: 'https://evil.example/p.webp', shadows: [] },
        good: { id: 'p2', name: 'P', texture: 'https://cdn.jiltv.app/p.webp', shadows: [] },
        'not a login': { id: 'p3', name: 'P', texture: 'https://cdn.jiltv.app/p.webp', shadows: [] },
      },
    });
    expect([...parsed!.keys()]).toEqual(['evil', 'good']);
    expect(parsed!.get('evil')).toBeNull();
    expect(parsed!.get('good')?.texture).toBe('https://cdn.jiltv.app/p.webp');
    expect(parseJilTVPaintAnswer({ paint: null })).toBeNull();
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
    expect(await lookupJilTVPaint('jilence', 'jilence')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('the API answers 404 while the gate is off', async () => {
    vi.stubEnv('GXUFY_JILTV_COSMETICS_ENABLED', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await call({ logins: 'jilence' });
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
    vi.restoreAllMocks();
    resetFixedProviderResourcesForTests();
  });

  it('asks JilTV about the logins in one request, for the channel, and draws the paints from the catalog', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.redirect).toBe('error');
      if (url.startsWith(JILTV_LOOKS_URL)) {
        expect(url).toBe(`${JILTV_LOOKS_URL}?logins=jilence,gxufy,nobody&channel=streamer`);
        return looks({ jilence: { p: MOLTEN_GOLD.id, b: 'b1' }, gxufy: { p: ANDROID.id } });
      }
      if (url === JILTV_CATALOG_URL) return json({ ...CATALOG, paints: [MOLTEN_GOLD, ANDROID] }, { headers: { etag: '"v1"' } });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await call({ logins: 'jilence,Gxufy,nobody,jilence', channel: 'Streamer' });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({
      paints: {
        jilence: { id: MOLTEN_GOLD.id, texture: MOLTEN_GOLD.texture.url },
        gxufy: { id: ANDROID.id, tileWidth: 420 },
        nobody: null,
      },
    });
    /* Answered from the cache for a minute, "wears nothing" included. */
    const second = await call({ logins: 'nobody,jilence', channel: 'streamer' });
    expect(second.body).toEqual({ paints: { nobody: null, jilence: (first.body as { paints: Record<string, unknown> }).paints.jilence } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the looks of each channel apart, and asks again after a minute', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(JILTV_LOOKS_URL)) {
        asked.push(url.slice(JILTV_LOOKS_URL.length));
        return looks({});
      }
      return json(CATALOG);
    }));
    await call({ logins: 'jilence', channel: 'one' });
    await call({ logins: 'jilence', channel: 'two' });
    await call({ logins: 'jilence' });
    await call({ logins: 'jilence', channel: 'one' });
    expect(asked).toEqual(['?logins=jilence&channel=one', '?logins=jilence&channel=two', '?logins=jilence']);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await call({ logins: 'jilence', channel: 'one' });
    expect(asked).toHaveLength(4);
  });

  it('answers "nothing" for people wearing nothing without loading the catalog', async () => {
    const fetchMock = vi.fn(async () => looks({}));
    vi.stubGlobal('fetch', fetchMock);
    const result = await call({ logins: 'someone' });
    expect(result).toMatchObject({ statusCode: 200, body: { paints: { someone: null } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects bad logins, channels and methods, and hides upstream failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect((await call({})).statusCode).toBe(400);
    expect((await call({ logins: '' })).statusCode).toBe(400);
    expect((await call({ logins: 'no spaces' })).statusCode).toBe(400);
    expect((await call({ logins: ['a', 'b'] })).statusCode).toBe(400);
    expect((await call({ logins: Array.from({ length: 51 }, (_, i) => `u${i}`).join(',') })).statusCode).toBe(400);
    expect((await call({ logins: 'a', channel: 'bad channel' })).statusCode).toBe(400);
    expect((await call({ logins: 'a', channel: ['x', 'y'] })).statusCode).toBe(400);
    expect((await call({ logins: 'a' }, 'POST')).statusCode).toBe(405);
    const failed = await call({ logins: 'b' });
    expect(failed.statusCode).toBe(502);
    expect(failed.body).toEqual({ error: 'Unable to load JilTV cosmetics.' });
  });

  it('drops paints missing from the catalog, without re-fetching the catalog more than once a minute', async () => {
    let catalogCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith(JILTV_LOOKS_URL)) return looks({ a: { p: 'BRANDNEW' }, b: { p: 'BRANDNEW' } });
      catalogCalls += 1;
      return json(CATALOG);
    }));
    const result = await call({ logins: 'a' });
    expect(result.body).toEqual({ paints: { a: null } });
    expect(catalogCalls).toBe(1);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await call({ logins: 'b' });
    expect(catalogCalls).toBe(2);
  });
});

describe('JilTV cosmetics API when JilTV is busy', () => {
  beforeEach(() => {
    vi.stubEnv('GXUFY_JILTV_COSMETICS_ENABLED', '1');
    __resetJilTVCosmeticsForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetFixedProviderResourcesForTests();
  });

  it('stops asking JilTV for its Retry-After after a 429, and tells browsers to wait', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }));
    vi.stubGlobal('fetch', fetchMock);
    const limited = await call({ logins: 'a' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('30');
    /* Anyone else, during the wait: answered here, JilTV is not asked. */
    clock.mockReturnValue(now + 10_000);
    const waiting = await call({ logins: 'b' });
    expect(waiting.statusCode).toBe(429);
    expect(waiting.headers.get('Retry-After')).toBe('20');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* After it: asked again. */
    clock.mockReturnValue(now + 31_000);
    fetchMock.mockImplementation(async () => looks({}));
    expect((await call({ logins: 'b' })).statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits a minute before asking for a catalog that failed to load, and asks about those chatters again soon', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    let catalogCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith(JILTV_LOOKS_URL)) return looks({ a: { p: MOLTEN_GOLD.id }, b: { p: MOLTEN_GOLD.id }, c: { p: MOLTEN_GOLD.id } });
      catalogCalls += 1;
      return new Response('down', { status: 503 });
    }));
    expect((await call({ logins: 'a' })).body).toEqual({ paints: { a: null } });
    expect((await call({ logins: 'b' })).body).toEqual({ paints: { b: null } });
    expect(catalogCalls).toBe(1);
    clock.mockReturnValue(now + 61_000);
    await call({ logins: 'c' });
    expect(catalogCalls).toBe(2);
    let lookupCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).startsWith(JILTV_LOOKS_URL)) return json(CATALOG);
      lookupCalls += 1;
      return looks({ a: { p: MOLTEN_GOLD.id } });
    }));
    clock.mockReturnValue(now + 122_000);
    expect((await call({ logins: 'a' })).body).toMatchObject({ paints: { a: { id: MOLTEN_GOLD.id } } });
    expect(lookupCalls).toBe(1);
  });
});

describe('JilTV lookups in the browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    __resetJilTVCosmeticsClientForTests();
  });

  const PAINT = { id: 'p1', name: 'P', texture: 'https://cdn.jiltv.app/p.webp', shadows: [] };

  it('asks our proxy, never JilTV directly, with everyone seen within the window in one request', async () => {
    const fetchMock = vi.fn(async () => json({ paints: { alice: PAINT, bob: null, carol: null } }));
    vi.stubGlobal('fetch', fetchMock);
    const answers = await Promise.all([
      lookupJilTVPaint('Alice', 'Streamer', true),
      lookupJilTVPaint('bob', 'streamer', true),
      lookupJilTVPaint('carol', 'streamer', true),
      lookupJilTVPaint('alice', 'streamer', true),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/jiltv/cosmetics?logins=alice,bob,carol&channel=streamer', expect.anything());
    expect(answers.map((paint) => paint?.id ?? null)).toEqual(['p1', null, null, 'p1']);
    /* Remembered, "wears nothing" too. */
    expect(await lookupJilTVPaint('bob', 'streamer', true)).toBeNull();
    expect(await lookupJilTVPaint('alice', 'streamer', true)).toMatchObject({ id: 'p1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks separately per channel, and never for invalid names', async () => {
    const urls: string[] = [];
    const lookups = createJilTVPaintLookups(async (logins, channel) => {
      urls.push(`${channel}:${logins.join(',')}`);
      return new Map(logins.map((login) => [login, null]));
    });
    await Promise.all([
      lookups.lookup('a', 'one'),
      lookups.lookup('a', 'two'),
      lookups.lookup('b', ''),
      lookups.lookup('bad name', 'one'),
      lookups.lookup('c', 'bad channel'),
    ]);
    expect(urls.sort()).toEqual([':b', 'one:a', 'two:a']);
  });

  it('splits a crowd into requests of 50', async () => {
    const sizes: number[] = [];
    const lookups = createJilTVPaintLookups(async (logins) => {
      sizes.push(logins.length);
      return new Map(logins.map((login) => [login, null]));
    });
    await Promise.all(Array.from({ length: 120 }, (_, i) => lookups.lookup(`u${i}`, 'busy')));
    expect(sizes).toEqual([50, 50, 20]);
  });

  it('waits out a 429 without asking, then asks again', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const lookups = createJilTVPaintLookups(async (logins, _channel, onRateLimit) => {
      calls += 1;
      if (calls === 1) {
        onRateLimit('30');
        throw new Error('HTTP 429');
      }
      return new Map(logins.map((login) => [login, null]));
    });
    const first = lookups.lookup('a', 'c');
    await vi.advanceTimersByTimeAsync(JILTV_CLIENT_BATCH_WINDOW_MS);
    expect(await first).toBeNull();
    expect(await lookups.lookup('b', 'c')).toBeNull();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(31_000);
    const later = lookups.lookup('b', 'c');
    await vi.advanceTimersByTimeAsync(JILTV_CLIENT_BATCH_WINDOW_MS);
    expect(await later).toBeNull();
    expect(calls).toBe(2);
  });
});
