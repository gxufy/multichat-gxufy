import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSevenTVChannelEmotes,
  getSevenTVGlobalEmotes,
  mapSevenTVEmote,
} from '@/lib/kick';

afterEach(() => vi.unstubAllGlobals());

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('7TV catalog freshness and image identity', () => {
  it('resolves the actual image asset instead of the active assignment ID', () => {
    const mapped = mapSevenTVEmote({
      id: 'assignment-id',
      name: 'WW',
      flags: 0,
      data: {
        id: 'real-asset-id',
        flags: 256,
        host: {
          url: '//cdn.7tv.app/emote/real-asset-id',
          files: [
            { name: '1x.webp', format: 'WEBP', width: 41, height: 32 },
            { name: '4x.webp', format: 'WEBP', width: 164, height: 128 },
          ],
        },
      },
    });
    expect(mapped.image).toBe('https://cdn.7tv.app/emote/real-asset-id/4x.webp');
    expect(mapped.width).toBe(164);
    expect(mapped.height).toBe(128);
    expect(mapped.zeroWidth).toBe(true);
  });

  it('distinguishes a transient global API failure from a genuinely empty set', async () => {
    const mocked = vi.fn().mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ emotes: [] }));
    vi.stubGlobal('fetch', mocked);
    await expect(getSevenTVGlobalEmotes(true))
      .rejects.toThrow('7TV global emote request failed');
    await expect(getSevenTVGlobalEmotes(true)).resolves.toEqual([]);
  });

  it('rejects temporary channel errors in strict mode but preserves startup fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)));
    await expect(getSevenTVChannelEmotes('42', 'twitch', true))
      .rejects.toThrow('7TV channel emote request failed');
    await expect(getSevenTVChannelEmotes('42', 'twitch')).resolves.toEqual({
      emotes: [], setId: null, stvUserId: null,
    });
  });

  it('does not mistake a failed by-ID lookup for a valid empty set', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/users/twitch/42')) {
        return response({ user: { id: 'stv-user' }, emote_set_id: 'set-42', emote_set: null });
      }
      return response({}, 503);
    }));
    await expect(getSevenTVChannelEmotes('42', 'twitch', true))
      .rejects.toThrow('7TV emote set request failed');
  });

  it('accepts a successful genuinely empty by-ID set', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/users/twitch/42')) {
        return response({ user: { id: 'stv-user' }, emote_set_id: 'set-empty', emote_set: null });
      }
      return response({ emotes: [] });
    }));
    const result = await getSevenTVChannelEmotes('42', 'twitch', true);
    expect(result.emotes).toEqual([]);
    expect(result.setId).toBe('set-empty');
  });
});
