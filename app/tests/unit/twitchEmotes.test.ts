import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sevenTVMocks = vi.hoisted(() => ({
  global: vi.fn(),
  channel: vi.fn(),
}));

vi.mock('@/lib/kick', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/kick')>();
  return {
    ...original,
    getSevenTVGlobalEmotes: sevenTVMocks.global,
    getSevenTVChannelEmotes: sevenTVMocks.channel,
  };
});

import { loadTwitchEmotes } from '@/lib/twitchEmotes';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Twitch FFZ/BTTV emote catalogs', () => {
  beforeEach(() => {
    sevenTVMocks.global.mockReset().mockResolvedValue([]);
    sevenTVMocks.channel.mockReset().mockResolvedValue({ emotes: [], setId: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes FFZ plus BTTV global/channel/shared art and known BTTV zero-width metadata', async () => {
    const zeroWidthId = '5e76d338d6581c3724c0f0b2';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/frankerfacez/emotes/global')) {
        return jsonResponse([{ id: 'fg', code: 'FFZG', width: 32, height: 24, images: { '4x': 'https://cdn.example/ffzg.png' } }]);
      }
      if (url.endsWith('/frankerfacez/users/twitch/42')) {
        return jsonResponse([{ id: 'fr', code: 'FFZR', images: { '2x': 'https://cdn.example/ffzr.png' } }]);
      }
      if (url.endsWith('/cached/emotes/global')) {
        return jsonResponse([{ id: 'bg', code: 'BTTVG', width: 40, height: 30 }]);
      }
      if (url.endsWith('/cached/users/twitch/42')) {
        return jsonResponse({
          channelEmotes: [{ id: zeroWidthId, code: 'BTTVZero', width: 50, height: 40 }],
          sharedEmotes: [{ id: 'bs', code: 'BTTVShared' }],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const emotes = await loadTwitchEmotes('42');
    expect(emotes.map((emote) => emote.name)).toEqual([
      'FFZG',
      'FFZR',
      'BTTVG',
      'BTTVZero',
      'BTTVShared',
    ]);
    expect(emotes.find((emote) => emote.name === 'FFZG')).toMatchObject({
      image: 'https://cdn.example/ffzg.png',
      width: 32,
      height: 24,
      zeroWidth: false,
      upscale: false,
    });
    expect(emotes.find((emote) => emote.name === 'FFZR')).toMatchObject({
      image: 'https://cdn.example/ffzr.png',
      zeroWidth: false,
      upscale: true,
    });
    expect(emotes.find((emote) => emote.name === 'BTTVZero')).toMatchObject({
      image: `https://cdn.betterttv.net/emote/${zeroWidthId}/3x`,
      width: 50,
      height: 40,
      zeroWidth: true,
      upscale: false,
    });
  });

  it('fails malformed or unsafe provider entries closed while preserving valid neighboring entries', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/frankerfacez/emotes/global')) {
        return jsonResponse([
          { id: 'unsafe', code: 'UnsafeFFZ', images: { '4x': 'javascript:alert(1)' } },
          { id: 'good', code: 'SafeFFZ', images: { '1x': 'https://cdn.example/safe.png' } },
          { id: 'missing-code', images: { '4x': 'https://cdn.example/missing.png' } },
        ]);
      }
      if (url.endsWith('/cached/emotes/global')) {
        return jsonResponse([
          { id: '', code: 'MissingId' },
          { id: 'good-bttv', code: 'SafeBTTV' },
          { id: 'missing-code' },
        ]);
      }
      if (url.includes('/users/twitch/42')) return jsonResponse({});
      throw new Error(`unexpected URL ${url}`);
    });

    const emotes = await loadTwitchEmotes('42');
    expect(emotes.map((emote) => emote.name)).toEqual(['SafeFFZ', 'SafeBTTV']);
    expect(emotes.every((emote) => emote.image.startsWith('https://'))).toBe(true);
  });

  it('lets later providers win exact-name collisions without cross-platform state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/frankerfacez/emotes/global')) {
        return jsonResponse([{ id: 'ffz', code: 'COLLIDE', images: { '4x': 'https://cdn.example/ffz.png' } }]);
      }
      if (url.endsWith('/cached/emotes/global')) {
        return jsonResponse([{ id: 'bttv', code: 'COLLIDE' }]);
      }
      if (url.includes('/users/twitch/42')) return jsonResponse({});
      throw new Error(`unexpected URL ${url}`);
    });
    sevenTVMocks.global.mockResolvedValueOnce([{
      name: 'COLLIDE',
      image: 'https://cdn.example/7tv.webp',
      width: 32,
      height: 32,
      zeroWidth: false,
      upscale: false,
    }]);

    const emotes = await loadTwitchEmotes('42');
    expect(emotes).toHaveLength(1);
    expect(emotes[0]?.image).toBe('https://cdn.example/7tv.webp');
    expect(await loadTwitchEmotes('not-a-room-id')).toEqual([]);
  });
});
