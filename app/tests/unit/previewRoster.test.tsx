import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTwitchPreviewRoster } from '@/components/classic/useTwitchPreviewRoster';
import { __resetPreviewIdentityClient } from '@/features/multichat/previewIdentityClient';
import {
  POPULAR_SEVENTV_EMOTE_NAMES,
  PREVIEW_MESSAGES,
  PREVIEW_PLATFORM_SEQUENCE,
  PREVIEW_ROSTER,
  PREVIEW_ROSTER_CONCURRENCY,
  curatedBadges,
  resolvedSevenTVResponse,
  rosterTemplates,
  withResolvedSevenTVEmotes,
} from '@/features/multichat/previewRoster';
import type { PreviewIdentityResponse, PreviewIdentityEmote } from '@/features/multichat/previewIdentity';

const seven = (
  login: string,
  name: string,
  scope: PreviewIdentityEmote['scope'],
  zeroWidth = false,
): PreviewIdentityEmote => ({
  id: `${login}-${scope}-${name}`,
  name,
  provider: '7TV',
  scope,
  image: `https://cdn.example/${login}-${scope}-${name}.webp`,
  height: 32,
  width: 32,
  zeroWidth,
  upscale: false,
});

const responseFor = (login: string): PreviewIdentityResponse => ({
  identity: {
    userId: String(100 + PREVIEW_ROSTER.findIndex((entry) => entry.login === login)),
    login,
    displayName: 'ProviderCase',
  },
  providers: {
    Twitch: {
      status: 'loaded',
      resources: {
        globalBadges: {
          'moderator/1': `https://cdn.example/${login}-global-mod.png`,
          'subscriber/1': `https://cdn.example/${login}-sub.png`,
          'community:chatterino:owner/1': `https://cdn.example/${login}-community-owner.png`,
          'community:moltorino:friend/1': `https://cdn.example/${login}-community-friend.png`,
        },
        channelBadges: { 'moderator/1': `https://cdn.example/${login}-channel-mod.png` },
      },
    },
    FFZ: {
      status: 'loaded',
      resources: {
        globalEmotes: [],
        roomEmotes: [],
        badgeOverrides: { 'moderator/1': `https://cdn.example/${login}-ffz-mod.png` },
        ownedBadges: [{ id: 'ffz-owner', image: `https://cdn.example/${login}-ffz-owner.png` }],
      },
    },
    BTTV: {
      status: 'loaded',
      resources: {
        globalEmotes: [],
        channelEmotes: [],
        sharedEmotes: [],
        ownedBadges: [{ id: 'bttv-owner', image: `https://cdn.example/${login}-bttv-owner.png` }],
      },
    },
    '7TV': {
      status: 'loaded',
      resources: {
        globalEmotes: [
          seven(login, 'LOL', 'global'),
          seven(login, 'GlobalReal', 'global'),
          seven(login, 'ZeroOverlay', 'global', true),
        ],
        channelEmotes: [seven(login, 'HUH', 'channel')],
        personalEmotes: [seven(login, 'PersonalReal', 'personal')],
        paint: null,
        badge: null,
      },
    },
  },
});

const withoutSevenTV = (login: string): PreviewIdentityResponse => {
  const response = responseFor(login);
  return {
    ...response,
    providers: {
      ...response.providers,
      '7TV': {
        status: 'failed',
        resources: {
          globalEmotes: [],
          channelEmotes: [],
          personalEmotes: [],
          paint: null,
          badge: null,
        },
      },
    },
  };
};

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
} as Response);

beforeEach(() => __resetPreviewIdentityClient());
afterEach(() => vi.unstubAllGlobals());

describe('curated Preview Identity roster', () => {
  it('restores the original roster, adds the requested names, and uses original MultiChat copy', () => {
    expect(PREVIEW_ROSTER.map((entry) => entry.displayName)).toEqual([
      'gxufy',
      'blu01_',
      'uniiDev',
      'Xslash58',
      'moltobenne_',
      'Said',
      'slaiqe',
      'wtwfrxsty',
      'giovahni',
      'hvdras',
      'feelssunnyman',
      'magicnxtup',
    ]);
    expect(PREVIEW_ROSTER.map((entry) => entry.login)).toEqual([
      'gxufy',
      'blu01_',
      'uniidev',
      'xslash58',
      'moltobenne_',
      'said',
      'slaiqe',
      'wtwfrxsty',
      'giovahni',
      'hvdras',
      'feelssunnyman',
      'magicnxtup',
    ]);
    expect(PREVIEW_MESSAGES).toEqual([
      'MultiChat keeps every platform in one clean feed',
      'one OBS source for Kick Twitch YouTube and TikTok is so clean',
      'the badges and 7TV emotes look crazy on this overlay',
      'wait the emotes actually work across the preview too',
      'this is way cleaner than stacking four different chat boxes',
      'the platform icons make it easy to see where everyone came from',
      'custom fonts with the same chat layout is a W',
      'MultiChat is looking smooth',
      'okay multichat-gxufy is actually tough',
      'Kick Twitch YouTube TikTok all together is fire',
      "yeah i'm keeping this overlay",
      'the preview feels alive when 7TV starts popping off',
      'this multichat setup is a W',
    ]);
    expect(PREVIEW_MESSAGES.join(' ')).not.toMatch(/Thank you for the follow|MAMA I MADE IT|titty\?/i);
  });

  it('keeps a recognizable popular 7TV preference list', () => {
    expect(POPULAR_SEVENTV_EMOTE_NAMES.slice(0, 7)).toEqual([
      'lol', 'ww', 'clap', 'huh', 'o7', 'edm', 'pog',
    ]);
    expect(POPULAR_SEVENTV_EMOTE_NAMES).toContain('kekw');
    expect(POPULAR_SEVENTV_EMOTE_NAMES).toContain('omegalul');
  });

  it('shows deterministic text and varied source logos before network resources settle', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const { result, unmount } = renderHook(() => useTwitchPreviewRoster());
    expect(result.current.templates.map((template) => template.username))
      .toEqual(PREVIEW_ROSTER.map((entry) => entry.displayName));
    expect(result.current.templates.map((template) => template.text))
      .toEqual(PREVIEW_MESSAGES.slice(0, PREVIEW_ROSTER.length));
    expect(result.current.templates.map((template) => template.displayPlatform))
      .toEqual(PREVIEW_PLATFORM_SEQUENCE.slice(0, PREVIEW_ROSTER.length));
    expect(result.current.templates.every((template) => template.platform === 'twitch')).toBe(true);
    const logos = result.current.templates.map((template) => template.displayPlatform);
    expect(logos.every((logo, index) => index === 0 || logo !== logos[index - 1])).toBe(true);
    unmount();
  });

  it('prefers popular resolved non-zero-width 7TV emotes and never guesses missing names', () => {
    const response = responseFor('gxufy');
    expect(withResolvedSevenTVEmotes('', response, 0, 0, 1)).toBe('LOL');
    expect(withResolvedSevenTVEmotes('hello', response, 0, 0, 2)).toBe('hello LOL HUH');
    expect(withResolvedSevenTVEmotes('hello', undefined, 0, 0, 1)).toBe('hello');

    const templates = rosterTemplates(new Map([['gxufy', response]]), 0);
    expect(templates[0]!.text).toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(templates[0]!.text).not.toContain('ZeroOverlay');
    expect(templates[1]!.text).toBe(PREVIEW_MESSAGES[1]);
  });

  it('borrows another loaded preview identity when the row owner has no usable 7TV artwork', () => {
    const gxufy = withoutSevenTV('gxufy');
    const hvdras = responseFor('hvdras');
    const responses = new Map<string, PreviewIdentityResponse>([
      ['gxufy', gxufy],
      ['hvdras', hvdras],
    ]);

    expect(resolvedSevenTVResponse(gxufy, responses)).toBe(hvdras);
    const templates = rosterTemplates(responses, 0);
    expect(templates[0]!.text).toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(templates[0]!.text).not.toContain('ZeroOverlay');
  });

  it('uses resolved community badges and never invents native Twitch entitlements', () => {
    const response = responseFor('gxufy');
    const badges = curatedBadges(PREVIEW_ROSTER[0]!, response, 0);
    expect(badges.map((badge) => badge.type)).toEqual([
      'community:chatterino:owner',
      'community:moltorino:friend',
      'community:bttv:bttv-owner',
      'community:ffz:ffz-owner',
    ]);
    expect(badges.some((badge) => badge.type === 'moderator')).toBe(false);
    expect(badges.some((badge) => badge.type === 'subscriber')).toBe(false);
    expect(new Set(badges.map((badge) => badge.url)).size).toBe(badges.length);
  });

  it('bounds identity loading concurrency and continues after an independent failure', async () => {
    let active = 0;
    let peak = 0;
    const resolvers = new Map<string, {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
    }>();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const login = new URL(String(input), 'http://local').searchParams.get('login')!;
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<Response>((resolve, reject) => resolvers.set(login, {
        resolve: (value) => { active -= 1; resolve(value); },
        reject: (error) => { active -= 1; reject(error); },
      }));
    }));

    const { result } = renderHook(() => useTwitchPreviewRoster());
    await waitFor(() => expect(resolvers.size).toBe(PREVIEW_ROSTER_CONCURRENCY));
    expect(peak).toBe(PREVIEW_ROSTER_CONCURRENCY);

    await act(async () => resolvers.get('blu01_')!.reject(new Error('offline')));
    await waitFor(() => expect(resolvers.has('xslash58')).toBe(true));
    await act(async () => resolvers.get('gxufy')!.resolve(jsonResponse(responseFor('gxufy'))));
    await waitFor(() => expect(result.current.responses.has('gxufy')).toBe(true));
    expect(result.current.templates[0]!.username).toBe('gxufy');
    expect(result.current.templates[0]!.text).toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(peak).toBe(PREVIEW_ROSTER_CONCURRENCY);
  });

  it('reuses cached identities while cycling the MultiChat preview feed', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const login = new URL(String(input), 'http://local').searchParams.get('login')!;
      return Promise.resolve(jsonResponse(responseFor(login)));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTwitchPreviewRoster());
    await waitFor(() => expect(result.current.responses.size).toBe(PREVIEW_ROSTER.length));
    expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_ROSTER.length);

    const before = result.current.templates.map((template) => `${template.text}|${template.displayPlatform}`);
    act(() => result.current.loadMore());
    expect(result.current.page).toBe(1);
    expect(result.current.templates.map((template) => `${template.text}|${template.displayPlatform}`))
      .not.toEqual(before);

    act(() => result.current.reset());
    expect(result.current.page).toBe(0);
    expect(result.current.templates[0]!.text).toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(result.current.templates[1]!.text).toBe(PREVIEW_MESSAGES[1]);
    expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_ROSTER.length);
  });
});
