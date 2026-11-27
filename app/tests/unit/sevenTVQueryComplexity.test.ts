import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import liveStyles from '../fixtures/sevenTVV4LiveStyles.json';
import {
  SEVENTV_V4_GQL,
  SEVENTV_V4_MAX_USERS_PER_QUERY,
  SEVENTV_V4_USERS_PER_FLUSH,
  createCosmeticsFetcher,
  type CosmeticsStores,
} from '@/lib/cosmetics';
import { fetchPreviewSevenTVStyles } from '@/features/multichat/previewLiveCosmetics';

/*
 * Mirrors the real 7TV v4 behaviour measured 2026-11-14: complexity is
 * 1 + 40 per userByConnection(style), and anything above 400 is answered with
 * HTTP 200 and { data: null, errors: [{ message: 'Query is too complex.' }] }.
 */
const COMPLEXITY_LIMIT = 400;
const users = liveStyles.users as Record<string, unknown>;

function realisticSevenTV() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    const aliases = [...query.matchAll(/(u\d+): userByConnection\(platform: (?:TWITCH|KICK), platformId: "(\d+)"\)/g)];
    const complexity = 1 + 40 * aliases.length;
    const body = complexity > COMPLEXITY_LIMIT
      ? { data: null, errors: [{ message: 'Query is too complex.' }] }
      : {
          data: {
            users: Object.fromEntries(aliases.map((m) => [m[1], { style: users[m[2]!] ?? users['204219574'] }])),
          },
          extensions: { analyzer: { complexity } },
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

const aliasCount = (init?: RequestInit) =>
  (String(JSON.parse(String(init?.body)).query).match(/userByConnection/g) ?? []).length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('7TV v4 query complexity ceiling', () => {
  it('keeps every query within the measured 7TV limit', () => {
    expect(1 + 40 * SEVENTV_V4_MAX_USERS_PER_QUERY).toBeLessThanOrEqual(COMPLEXITY_LIMIT);
  });

  it('live overlay fetcher loads cosmetics for a busy burst of chatters', async () => {
    const fetchMock = realisticSevenTV();
    vi.stubGlobal('fetch', fetchMock);
    const stores: CosmeticsStores = { paints: [], badges: [], entitlements: {} };
    const applied: string[] = [];
    const fetcher = createCosmeticsFetcher(stores, (keys) => applied.push(...keys));

    const burst = Array.from({ length: SEVENTV_V4_USERS_PER_FLUSH + 5 }, (_, i) => String(5_000_000 + i));
    for (const id of burst) fetcher.want('twitch', id);

    await vi.advanceTimersByTimeAsync(2_000);

    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).toBe(SEVENTV_V4_GQL);
      expect(aliasCount(init)).toBeLessThanOrEqual(SEVENTV_V4_MAX_USERS_PER_QUERY);
    }
    expect(new Set(applied)).toEqual(new Set(burst.map((id) => `twitch:${id}`)));
    expect(stores.entitlements['twitch:5000000']?.paint).toBe('01K19W45ZA3XFW7YP83BVQRBYR');
    fetcher.stop();
  });

  it('preview refresh loads all 22 roster-sized identities', async () => {
    const fetchMock = realisticSevenTV();
    const ids = Array.from({ length: 22 }, (_, i) => String(6_000_000 + i));
    const styles = await fetchPreviewSevenTVStyles(ids, { fetchImpl: fetchMock });
    expect(styles.size).toBe(22);
    for (const [, init] of fetchMock.mock.calls) {
      expect(aliasCount(init)).toBeLessThanOrEqual(SEVENTV_V4_MAX_USERS_PER_QUERY);
    }
  });
});
