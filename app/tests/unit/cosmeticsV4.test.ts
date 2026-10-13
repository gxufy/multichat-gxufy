import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCosmeticsFetcher, type CosmeticsStores } from '@/lib/cosmetics';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('7TV v4 live cosmetics lookup', () => {
  it('uses the current userByConnection schema and maps an active paint, shadows, and badge', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => ({
      ok: true,
      json: async () => ({
        data: {
          users: {
            u0: {
              style: {
                activePaint: {
                  id: 'paint-v4',
                  data: {
                    layers: [{
                      opacity: 1,
                      ty: {
                        __typename: 'PaintLayerTypeLinearGradient',
                        angle: 90,
                        repeating: false,
                        stops: [
                          { at: 0, color: { hex: '#ff0000ff' } },
                          { at: 1, color: { hex: '#0000ffff' } },
                        ],
                      },
                    }],
                    shadows: [{
                      color: { hex: '#00000080' },
                      offsetX: 1,
                      offsetY: 2,
                      blur: 3,
                    }],
                  },
                },
                activeBadge: {
                  id: 'badge-v4',
                  images: [
                    {
                      url: 'https://cdn.7tv.app/badge/badge-v4/3x.webp',
                      mime: 'image/webp',
                      scale: 3,
                      frameCount: 1,
                    },
                  ],
                },
              },
            },
          },
        },
      }),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const stores: CosmeticsStores = { paints: [], badges: [], entitlements: {} };
    const onApplied = vi.fn();
    const fetcher = createCosmeticsFetcher(stores, onApplied);

    fetcher.want('twitch', '123');
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.7tv.app/v4/gql');

    const request = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(request.query).toContain('users');
    expect(request.query).toContain('userByConnection(platform: TWITCH, platformId: "123")');
    expect(request.query).toContain('activePaint');
    expect(request.query).toContain('activeBadge');

    expect(stores.paints).toEqual([{
      id: 'paint-v4',
      func: 'LINEAR_GRADIENT',
      angle: 90,
      repeat: false,
      stops: [
        { color: 0xff0000ff, at: 0 },
        { color: 0x0000ffff, at: 1 },
      ],
      shadows: [{ color: 0x00000080, x_offset: 1, y_offset: 2, radius: 3 }],
    }]);
    expect(stores.badges).toEqual([{
      id: 'badge-v4',
      image: 'https://cdn.7tv.app/badge/badge-v4/3x.webp',
    }]);
    expect(stores.entitlements['twitch:123']).toEqual({
      paint: 'paint-v4',
      badge: 'badge-v4',
    });
    expect(onApplied).toHaveBeenCalledWith(['twitch:123']);

    fetcher.stop();
  });
});
