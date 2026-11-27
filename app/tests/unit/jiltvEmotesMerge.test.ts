import { afterEach, describe, expect, it, vi } from 'vitest';

const jiltv = vi.hoisted(() => ({
  loadJilTVTwitchEmotes: vi.fn(async () => [
    { name: 'shared', image: 'https://cdn.jiltv.app/emotes/J/1/2x.webp', width: 32, height: 32, zeroWidth: false, upscale: false },
    { name: 'overBttv', image: 'https://cdn.jiltv.app/emotes/B/1/2x.webp', width: 32, height: 32, zeroWidth: false, upscale: false },
    { name: 'jiltvOnly', image: 'https://cdn.jiltv.app/emotes/K/1/2x.webp', width: 32, height: 32, zeroWidth: false, upscale: false },
  ]),
}));
vi.mock('@/lib/jiltvEmotes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadJilTVTwitchEmotes: jiltv.loadJilTVTwitchEmotes,
}));
vi.mock('@/lib/kick', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSevenTVGlobalEmotes: vi.fn(async () => []),
    getSevenTVChannelEmotes: vi.fn(async () => ({
      emotes: [{ name: 'shared', image: 'https://cdn.7tv.app/emote/S/2x.webp', width: 32, height: 32, zeroWidth: false, upscale: false }],
    })),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  jiltv.loadJilTVTwitchEmotes.mockClear();
});

/* BTTV's global list as the overlay's proxy answers it. */
async function stubBttv() {
  (await import('@/lib/twitchEmotes')).clearTwitchEmoteResourceCache();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/twitch/emote-resources?channelId=')) {
      return new Response(JSON.stringify({ bttvGlobal: [{ id: '5e76d338d6581c3724c0f0b9', code: 'overBttv' }] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  }));
}

describe('JilTV emotes in the Twitch emote list', () => {
  it('sit after FFZ and BTTV and before 7TV, so 7TV wins a shared name', async () => {
    await stubBttv();
    const { loadTwitchEmotes } = await import('@/lib/twitchEmotes');
    const emotes = await loadTwitchEmotes('438697907', undefined, false, undefined, true);
    const byName = new Map(emotes.map((emote) => [emote.name, emote.image]));
    expect(byName.get('jiltvOnly')).toContain('cdn.jiltv.app');
    expect(byName.get('shared')).toContain('cdn.7tv.app');
    expect(byName.get('overBttv')).toContain('cdn.jiltv.app');
    expect(jiltv.loadJilTVTwitchEmotes).toHaveBeenCalledWith('438697907', undefined, false);
  });

  it('are not asked for unless turned on', async () => {
    await stubBttv();
    const { loadTwitchEmotes } = await import('@/lib/twitchEmotes');
    const emotes = await loadTwitchEmotes('438697907');
    expect(emotes.some((emote) => emote.image.includes('cdn.jiltv.app'))).toBe(false);
    /* The BTTV emote JilTV's overrides above really is in BTTV's list. */
    expect(emotes.find((emote) => emote.name === 'overBttv')?.image).toContain('betterttv');
    expect(jiltv.loadJilTVTwitchEmotes).not.toHaveBeenCalled();
  });
});
