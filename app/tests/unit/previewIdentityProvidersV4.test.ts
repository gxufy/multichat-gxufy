import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSevenTVPreviewResources } from '@/lib/previewIdentityProviders';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Preview Identity 7TV v4 cosmetics', () => {
  it('uses the live v4 activePaint/activeBadge schema for preview identities', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://7tv.io/v3/emote-sets/global') {
        return jsonResponse({ emotes: [] });
      }

      if (url === 'https://7tv.io/v3/users/twitch/123') {
        return jsonResponse({
          emote_set: null,
          user: { personal_emotes: [] },
        });
      }

      if (url === 'https://api.7tv.app/v4/gql') {
        const request = JSON.parse(String(init?.body ?? '{}'));

        expect(request.query).toContain(
          'userByConnection(platform: TWITCH, platformId: "123")',
        );
        expect(request.query).toContain('activePaint');
        expect(request.query).toContain('activeBadge');

        return jsonResponse({
          data: {
            users: {
              preview: {
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
                    images: [{
                      url: 'https://cdn.7tv.app/badge/badge-v4/3x.webp',
                      mime: 'image/webp',
                      scale: 3,
                      frameCount: 1,
                    }],
                  },
                },
              },
            },
          },
        });
      }

      throw new Error(`unexpected provider request: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await loadSevenTVPreviewResources('123');

    expect(result.status).toBe('loaded');

    expect(result.resources.paint).toEqual({
      id: 'paint-v4',
      func: 'LINEAR_GRADIENT',
      angle: 90,
      repeat: false,
      stops: [
        { color: 0xff0000ff, at: 0 },
        { color: 0x0000ffff, at: 1 },
      ],
      shadows: [{
        color: 0x00000080,
        x_offset: 1,
        y_offset: 2,
        radius: 3,
      }],
    });

    expect(result.resources.badge).toEqual({
      id: 'badge-v4',
      image: 'https://cdn.7tv.app/badge/badge-v4/3x.webp',
    });

    expect(
      fetchMock.mock.calls.some(([input]) => (
        String(input) === 'https://api.7tv.app/v4/gql'
      )),
    ).toBe(true);
  });
});
