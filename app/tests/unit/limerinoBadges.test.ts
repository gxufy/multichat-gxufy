import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  multichatBadgeSlotSizePx,
  parseLimerinoBadgeRecords,
  selectLimerinoBadgeImage,
  type LimerinoBadgeRecord,
} from '@/lib/limerinoBadges';
import {
  LIMERINO_CATALOG_URL,
  LIMERINO_HOLDERS_URL,
  LIMERINO_REFRESH_MS,
  combineLimerinoBadges,
  limerinoBadgeCacheStatsForTests,
  loadLimerinoBadges,
  parseLimerinoCatalog,
  parseLimerinoHolders,
  resetLimerinoBadgeCacheForTests,
} from '@/lib/server/limerinoBadges';
import handler from '@/pages/api/twitch/limerino-badges';

const files = [18, 36, 54, 72].flatMap((width) => [
  {
    name: `${width / 18}x.webp`, static_name: `${width / 18}x.png`,
    width, height: width, frame_count: 8, format: 'WEBP', future: true,
  },
  {
    name: `${width / 18}x.png`, width, height: width,
    frame_count: 1, format: 'PNG',
  },
]);

const catalogBody = {
  future: true,
  badges: [
    {
      id: 'first', kind: 'BADGE', future: 'allowed',
      data: {
        tooltip: 'First Limerino', future: true,
        host: { url: '//api.limerino.com/v1/badges/art/first/4', files },
      },
    },
    {
      id: 'ignored', kind: 'FUTURE_KIND',
      data: { tooltip: 'Ignored', host: { url: '//api.limerino.com/v1/badges/art/ignored/1', files } },
    },
    {
      id: 'second', kind: 'BADGE',
      data: {
        tooltip: 'Second Limerino',
        host: { url: '//api.limerino.com/v1/badges/art/second/2', files },
      },
    },
  ],
};

const holdersBody = {
  users: {
    '90071992547409931234': ['first', 'second'],
    '42': ['second'],
    not_a_twitch_id: ['first'],
  },
};

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function installSuccessfulFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === LIMERINO_CATALOG_URL) return jsonResponse(catalogBody, { ETag: '"catalog-v1"' });
    if (url === LIMERINO_HOLDERS_URL) return jsonResponse(holdersBody, { ETag: '"holders-v1"' });
    throw new Error(`unexpected URL: ${url}`);
  });
}

async function invoke(method = 'GET') {
  let statusCode = 200;
  let body: unknown;
  const headers = new Map<string, string | number | readonly string[]>();
  const req = { method, query: {}, headers: {} } as unknown as NextApiRequest;
  const res = {
    setHeader(name: string, value: string | number | readonly string[]) { headers.set(name, value); },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return { statusCode, body, headers };
}

afterEach(() => {
  resetLimerinoBadgeCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Limerino normalization and image selection', () => {
  it('parses BADGE catalog entries, ignores unknown kinds, and tolerates extra fields', () => {
    const catalog = parseLimerinoCatalog(catalogBody);
    expect(catalog?.map((badge) => badge.id)).toEqual(['first', 'second']);
    expect(catalog?.[0]).toMatchObject({
      title: 'First Limerino',
      host: 'https://api.limerino.com/v1/badges/art/first/4',
    });
  });

  it('keeps Twitch IDs as strings and preserves multiple badges in catalog order', () => {
    const catalog = parseLimerinoCatalog(catalogBody)!;
    const holders = parseLimerinoHolders(holdersBody)!;
    expect([...holders.keys()]).toEqual(['42', '90071992547409931234']);
    expect(holders.get('90071992547409931234')).toEqual(['first', 'second']);
    const combined = combineLimerinoBadges(catalog, holders);
    expect(combined.map((badge) => [badge.id, badge.users])).toEqual([
      ['first', ['90071992547409931234']],
      ['second', ['42', '90071992547409931234']],
    ]);
  });

  it('validates the same-origin normalized payload and omits absent users', () => {
    const parsed = parseLimerinoBadgeRecords(combineLimerinoBadges(
      parseLimerinoCatalog(catalogBody)!,
      parseLimerinoHolders(holdersBody)!,
    ));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.users).not.toContain('42');
    expect(parseLimerinoBadgeRecords([{ ...parsed[0], host: 'https://attacker.example/art' }]))
      .toEqual([]);
  });

  it.each([
    [18, 1, 18],
    [18, 2, 36],
    [18, 3, 54],
    [18, 4, 72],
    [40, 2, 72],
  ])('selects the smallest sufficient image for %ipx at %ix', (slot, scale, width) => {
    const badge = combineLimerinoBadges(
      parseLimerinoCatalog(catalogBody)!,
      parseLimerinoHolders(holdersBody)!,
    )[0]!;
    const selected = selectLimerinoBadgeImage(badge, {
      slotSizePx: slot, displayScale: scale, reducedMotion: false,
    });
    expect(selected).toMatchObject({ width, animated: true });
    expect(selected?.url).toBe(`https://api.limerino.com/v1/badges/art/first/4/${width / 18}x.webp`);
    expect(selected?.fallbackUrl).toBe(`https://api.limerino.com/v1/badges/art/first/4/${width / 18}x.png`);
  });

  it('supports GIF, PNG-only art, and documented animated static_name', () => {
    const base: LimerinoBadgeRecord = {
      id: 'formats', title: 'Formats', host: 'https://api.limerino.com/v1/badges/art/formats/1', users: ['1'],
      files: [
        { name: '1x.gif', staticName: 'still.png', width: 18, height: 18, frameCount: 3, format: 'GIF' },
        { name: '1x.png', width: 18, height: 18, frameCount: 1, format: 'PNG' },
      ],
    };
    expect(selectLimerinoBadgeImage(base, {
      slotSizePx: 18, displayScale: 1, reducedMotion: false,
    })?.url).toMatch(/1x\.gif$/);
    expect(selectLimerinoBadgeImage(base, {
      slotSizePx: 18, displayScale: 1, reducedMotion: true,
    })).toMatchObject({
      url: 'https://api.limerino.com/v1/badges/art/formats/1/still.png',
      animated: false,
    });

    const pngOnly = { ...base, files: [base.files[1]!] };
    expect(selectLimerinoBadgeImage(pngOnly, {
      slotSizePx: 18, displayScale: 1, reducedMotion: false,
    })).toMatchObject({
      url: 'https://api.limerino.com/v1/badges/art/formats/1/1x.png',
      animated: false,
    });
  });

  it('derives the image target from the configured/scaled GXUFY badge slot', () => {
    expect(multichatBadgeSlotSizePx('small', '')).toBe(16);
    expect(multichatBadgeSlotSizePx('medium', '')).toBe(28);
    expect(multichatBadgeSlotSizePx('large', '')).toBe(40);
    expect(multichatBadgeSlotSizePx('medium', 17)).toBe(14);
  });
});

describe('Limerino catalog + holders cache', () => {
  it('reuses both ETags and retains the cached data on 304', async () => {
    vi.stubGlobal('fetch', installSuccessfulFetch());
    const first = await loadLimerinoBadges(1_000);
    expect(first).toHaveLength(2);

    const revalidate = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const etag = new Headers(init?.headers).get('if-none-match');
      expect(['"catalog-v1"', '"holders-v1"']).toContain(etag);
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal('fetch', revalidate);
    const second = await loadLimerinoBadges(1_000 + LIMERINO_REFRESH_MS + 1);
    expect(second).toEqual(first);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, { 'Retry-After': '120' }],
    [500, {}],
    [503, {}],
  ])('keeps stale successful data after HTTP %i', async (status, headers) => {
    vi.stubGlobal('fetch', installSuccessfulFetch());
    const first = await loadLimerinoBadges(10_000);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status, headers })));
    const stale = await loadLimerinoBadges(10_000 + LIMERINO_REFRESH_MS + 1);
    expect(stale).toEqual(first);
    expect(limerinoBadgeCacheStatsForTests()).toMatchObject({ cached: true, failures: 1 });
  });

  it('keeps normal polling dramatically below provider limits and coalesces refreshes', async () => {
    const fetchMock = installSuccessfulFetch();
    vi.stubGlobal('fetch', fetchMock);
    const [one, two] = await Promise.all([
      loadLimerinoBadges(20_000),
      loadLimerinoBadges(20_000),
    ]);
    expect(one).toEqual(two);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await loadLimerinoBadges(20_000 + LIMERINO_REFRESH_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Limerino same-origin API', () => {
  it('returns normalized badges without exposing upstream-only descriptions', async () => {
    vi.stubGlobal('fetch', installSuccessfulFetch());
    const result = await invoke();
    expect(result.statusCode).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'first', title: 'First Limerino' }),
    ]));
    expect(JSON.stringify(result.body)).not.toContain('how_to_get');
  });

  it('rejects unsupported methods and returns a generic upstream error', async () => {
    expect((await invoke('POST')).statusCode).toBe(405);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('secret upstream detail'); }));
    expect(await invoke()).toMatchObject({
      statusCode: 502,
      body: { error: 'Unable to load Limerino badges.' },
    });
  });
});
