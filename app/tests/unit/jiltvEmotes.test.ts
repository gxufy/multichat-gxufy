import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetJilTVEmotesForTests,
  isJilTVEmoteImage,
  loadJilTVTwitchEmotes,
  parseJilTVEmotes,
} from '@/lib/jiltvEmotes';
import { MultichatQuerySchema, buildMultichatQuery, MULTICHAT_GENERATOR_DEFAULTS, MULTICHAT_GENERATOR_DEFAULT_CHANNELS } from '@/lib/multichatConfig';

const CDN = 'https://cdn.jiltv.app/emotes';
const GLOBAL_URL = 'https://api.jiltv.app/v1/sets/global';
const CHANNEL_URL = 'https://api.jiltv.app/v1/channels/twitch/438697907/bootstrap';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __resetJilTVEmotesForTests();
});

describe('JilTV emotes setting', () => {
  it('is off unless the link turns it on', () => {
    expect(MultichatQuerySchema.parse({ twitch: 'a' }).jiltvEmotesEnabled).toBe(false);
    expect(MultichatQuerySchema.parse({ twitch: 'a', jiltvEmotesEnabled: 'yes' }).jiltvEmotesEnabled).toBe(false);
    expect(MultichatQuerySchema.parse({ twitch: 'a', jiltvEmotesEnabled: 'true' }).jiltvEmotesEnabled).toBe(true);
    expect(MULTICHAT_GENERATOR_DEFAULTS.jiltvEmotesEnabled).toBe(false);
  });

  it('only shows up in a generated link when it is turned on', () => {
    const channels = { ...MULTICHAT_GENERATOR_DEFAULT_CHANNELS, twitch: 'a' };
    expect(buildMultichatQuery(channels, MULTICHAT_GENERATOR_DEFAULTS)).not.toContain('jiltv');
    const on = new URLSearchParams(buildMultichatQuery(channels, { ...MULTICHAT_GENERATOR_DEFAULTS, jiltvEmotesEnabled: true }));
    expect(on.get('jiltvEmotesEnabled')).toBe('true');
    expect(MultichatQuerySchema.parse(Object.fromEntries(on)).jiltvEmotesEnabled).toBe(true);
  });
});

describe('JilTV compact emotes', () => {
  it('builds CDN image URLs and keeps size and zero-width; drops NSFW and junk', () => {
    const emotes = parseJilTVEmotes([
      { id: '01M5FZDWT9E00AAWG5ESCNFAFM', name: 'thisCrazy', v: 1, w: 64, h: 32, f: 1 },
      { id: '01M6RFYYA2EY0AWW2Q1AR7GYGJ', name: 'overlayHat', v: 3, w: 32, h: 32, f: 2 },
      { id: '01M6RFYYA2EY0AWW2Q1AR7GYNS', name: 'nsfw', v: 1, w: 32, h: 32, f: 4 },
      { id: '01M6RFYYA2EY0AWW2Q1AR7GYN5', name: 'nsfwAnimated', v: 1, w: 32, h: 32, f: 5 },
      { id: '../../x', name: 'bad', v: 1, w: 32, h: 32 },
      { id: '01M6RFYYA2EY0AWW2Q1AR7GYXX', name: 'has space', v: 1, w: 32, h: 32 },
      { id: '01M6RFYYA2EY0AWW2Q1AR7GYYY', name: 'tooBig', v: 1, w: 5000, h: 32 },
      { id: '01M6RFYYA2EY0AWW2Q1AR7GYZZ', name: 'badVersion', v: -1, w: 32, h: 32 },
      'not an emote',
    ], CDN);
    expect(emotes).toEqual([
      { name: 'thisCrazy', image: `${CDN}/01M5FZDWT9E00AAWG5ESCNFAFM/1/2x.webp`, width: 64, height: 32, zeroWidth: false, upscale: false },
      { name: 'overlayHat', image: `${CDN}/01M6RFYYA2EY0AWW2Q1AR7GYGJ/3/2x.webp`, width: 32, height: 32, zeroWidth: true, upscale: false },
    ]);
    expect(emotes.every((emote) => isJilTVEmoteImage(emote.image))).toBe(true);
  });

  it('only trusts cdn.jiltv.app over https', () => {
    const list = [{ id: '01M5FZDWT9E00AAWG5ESCNFAFM', name: 'a', v: 1, w: 32, h: 32 }];
    expect(parseJilTVEmotes(list, 'https://evil.example/emotes')).toEqual([]);
    expect(parseJilTVEmotes(list, 'http://cdn.jiltv.app/emotes')).toEqual([]);
    expect(parseJilTVEmotes(list, 'https://cdn.jiltv.app.evil.example/emotes')).toEqual([]);
    expect(parseJilTVEmotes(list, 'https://cdn.jiltv.app:8443/emotes')).toEqual([]);
    expect(parseJilTVEmotes(list, 'https://cdn.jiltv.app/emotes/')).toHaveLength(1);
  });
});

describe('a Twitch channel\'s JilTV emotes', () => {
  it('merges global and channel sets (channel wins) and keeps them a while', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      const url = String(input);
      if (url === GLOBAL_URL) {
        return json({ sets: [{ emotes: [
          { id: '01M5FZDWT9E00AAWG5ESCNFAFG', name: 'same', v: 1, w: 32, h: 32 },
          { id: '01M5FZDWT9E00AAWG5ESCNFAGG', name: 'globalOnly', v: 1, w: 32, h: 32 },
        ] }], cdn: CDN });
      }
      if (url === CHANNEL_URL) {
        return json({ set: { emotes: [{ id: '01M5FZDWT9E00AAWG5ESCNFACH', name: 'same', v: 2, w: 32, h: 32 }] }, cdn: CDN });
      }
      return json({ error: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const emotes = await loadJilTVTwitchEmotes('438697907');
    expect(new Map(emotes.map((emote) => [emote.name, emote.image]))).toEqual(new Map([
      ['same', `${CDN}/01M5FZDWT9E00AAWG5ESCNFACH/2/2x.webp`],
      ['globalOnly', `${CDN}/01M5FZDWT9E00AAWG5ESCNFAGG/1/2x.webp`],
    ]));
    await loadJilTVTwitchEmotes('438697907');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    /* A refresh asks again. */
    await loadJilTVTwitchEmotes('438697907', undefined, true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    /* A channel JilTV doesn't know still gets JilTV's global emotes. */
    expect((await loadJilTVTwitchEmotes('1')).map((emote) => emote.name)).toEqual(['same', 'globalOnly']);
    /* Not a Twitch id: nothing is asked. */
    const before = fetchMock.mock.calls.length;
    expect(await loadJilTVTwitchEmotes('not-a-number')).toEqual([]);
    expect(await loadJilTVTwitchEmotes('../1')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(before);
  });

  it('asks again after JilTV could not be reached, and never throws', async () => {
    let up = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!up) throw new TypeError('network down');
      return String(input) === CHANNEL_URL
        ? json({ set: { emotes: [{ id: '01M5FZDWT9E00AAWG5ESCNFACH', name: 'back', v: 1, w: 32, h: 32 }] }, cdn: CDN })
        : json({ sets: [], cdn: CDN });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadJilTVTwitchEmotes('438697907')).toEqual([]);
    up = true;
    expect((await loadJilTVTwitchEmotes('438697907')).map((emote) => emote.name)).toEqual(['back']);
  });

  it('keeps the last good list when a later request fails', async () => {
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (fail) return json({}, 503);
      return String(input) === CHANNEL_URL
        ? json({ set: { emotes: [{ id: '01M5FZDWT9E00AAWG5ESCNFACH', name: 'kept', v: 1, w: 32, h: 32 }] }, cdn: CDN })
        : json({ sets: [], cdn: CDN });
    }));
    await loadJilTVTwitchEmotes('438697907');
    fail = true;
    expect((await loadJilTVTwitchEmotes('438697907', undefined, true)).map((emote) => emote.name)).toEqual(['kept']);
  });
});
