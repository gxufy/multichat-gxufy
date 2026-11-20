import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCosmeticsFetcher, type CosmeticsStores } from '@/lib/cosmetics';
import type { SevenTVBadge, SevenTVPaint } from '@/lib/kick';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('7TV cosmetics lookup caching', () => {
  it('negative-caches a successful lookup for a chatter with no cosmetics', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { u0: { style: { paint: null, badge: null } } } }),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const stores = { paints: [], badges: [], entitlements: {} };
    const fetcher = createCosmeticsFetcher(stores, vi.fn());

    fetcher.want('twitch', '123');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetcher.want('twitch', '123');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetcher.stop();
  });

  it('still permits a retry after an actual request failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { u0: { style: { paint: null, badge: null } } } }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const stores = { paints: [], badges: [], entitlements: {} };
    const fetcher = createCosmeticsFetcher(stores, vi.fn());

    fetcher.want('twitch', '456');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetcher.want('twitch', '456');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetcher.stop();
  });

  it('merges a full cosmetics batch with one catalog write per asset type', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          u0: { style: {
            paint: { id: 'paint-a', function: 'LINEAR_GRADIENT', color: 1 },
            badge: { id: 'badge-a', host: { url: '//cdn.7tv.app/badge-a' } },
          } },
          u1: { style: {
            paint: { id: 'paint-b', function: 'RADIAL_GRADIENT', color: 2 },
            badge: { id: 'badge-b', host: { url: '//cdn.7tv.app/badge-b' } },
          } },
          // Repeating an id later in the batch must keep the old remove-then-append
          // ordering and the final value, without rebuilding the whole catalog again.
          u2: { style: {
            paint: { id: 'paint-a', function: 'URL', color: 3, image_url: 'https://cdn.7tv.app/paint-a.webp' },
            badge: { id: 'badge-a', host: { url: '//cdn.7tv.app/badge-a-final' } },
          } },
        },
      }),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    let paints: SevenTVPaint[] = [{
      id: 'paint-existing', func: 'LINEAR_GRADIENT', angle: 0, color: 0,
      repeat: false, shadows: [], stops: [],
    }];
    let badges: SevenTVBadge[] = [{ id: 'badge-existing', image: 'https://cdn.7tv.app/existing/3x' }];
    let paintWrites = 0;
    let badgeWrites = 0;
    const stores: CosmeticsStores = {
      get paints() { return paints; },
      set paints(value) { paintWrites++; paints = value; },
      get badges() { return badges; },
      set badges(value) { badgeWrites++; badges = value; },
      entitlements: {},
    };
    const onApplied = vi.fn();
    const fetcher = createCosmeticsFetcher(stores, onApplied);

    fetcher.want('twitch', '1');
    fetcher.want('twitch', '2');
    fetcher.want('kick', '3');
    await vi.advanceTimersByTimeAsync(500);

    expect(paintWrites).toBe(1);
    expect(badgeWrites).toBe(1);
    expect(paints.map((paint) => paint.id)).toEqual(['paint-existing', 'paint-b', 'paint-a']);
    expect(badges.map((badge) => badge.id)).toEqual(['badge-existing', 'badge-b', 'badge-a']);
    expect(paints.at(-1)?.func).toBe('URL');
    expect(badges.at(-1)?.image).toBe('https://cdn.7tv.app/badge-a-final/3x');
    expect(stores.entitlements).toEqual({
      'twitch:1': { paint: 'paint-a', badge: 'badge-a' },
      'twitch:2': { paint: 'paint-b', badge: 'badge-b' },
      'kick:3': { paint: 'paint-a', badge: 'badge-a' },
    });
    expect(onApplied).toHaveBeenCalledWith(['twitch:1', 'twitch:2', 'kick:3']);
    fetcher.stop();
  });

  it('drops one invalid cosmetic without discarding the chatter\'s valid cosmetic', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          u0: { style: {
            paint: {
              id: 'bad-paint', function: 'URL', image_url: 'https://evil.example/paint.webp',
            },
            badge: { id: 'good-badge', host: { url: '//cdn.7tv.app/badge/good' } },
          } },
        },
      }),
    }) as Response));
    const stores: CosmeticsStores = { paints: [], badges: [], entitlements: {} };
    const onApplied = vi.fn();
    const fetcher = createCosmeticsFetcher(stores, onApplied);

    fetcher.want('twitch', '123');
    await vi.advanceTimersByTimeAsync(500);

    expect(stores.paints).toEqual([]);
    expect(stores.badges).toEqual([{
      id: 'good-badge', image: 'https://cdn.7tv.app/badge/good/3x',
    }]);
    expect(stores.entitlements['twitch:123']).toEqual({ badge: 'good-badge' });
    expect(onApplied).toHaveBeenCalledWith(['twitch:123']);
    fetcher.stop();
  });
});
