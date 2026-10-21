import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTwitchPreviewRoster } from '@/components/classic/useTwitchPreviewRoster';
import { __resetPreviewIdentityClient } from '@/features/multichat/previewIdentityClient';
import {
  POPULAR_SEVENTV_EMOTE_NAMES,
  PREVIEW_MESSAGES,
  PREVIEW_FEATURED_SEVENTV_EMOTES,
  PREVIEW_FEATURED_SEVENTV_SET_ID,
  PREVIEW_SEASONAL_SEVENTV_EMOTES,
  PREVIEW_SEASONAL_SEVENTV_SET_ID,
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
  communityBadges: [
    {
      type: 'community:chatterino:owner',
      url: `https://cdn.example/${login}-community-owner.png`,
    },
    {
      type: 'community:moltorino:friend',
      title: 'Moltorino Friend',
      url: `https://cdn.example/${login}-community-friend.png`,
      fallbackUrl: `https://cdn.example/${login}-community-friend-fallback.png`,
      backgroundColor: '#123456',
    },
    {
      type: 'community:bttv:bttv-owner',
      url: `https://cdn.example/${login}-bttv-owner.png`,
    },
    {
      type: 'community:ffz:ffz-owner',
      url: `https://cdn.example/${login}-ffz-owner.png`,
    },
  ],
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
      'Djrr13',
      'tuk7',
      'giovahni',
      'feelssunnyman',
      'br_winters',
      'zo0x_',
      'jilence',
      'sirstendec',
      'marc',
      'themizeguy',
      'dansalvato',
      'tduva',
      'igorovh',
      'night',
      'itzAlexPL',
    ]);
    expect(PREVIEW_ROSTER.map((entry) => entry.login)).toEqual([
      'gxufy',
      'blu01_',
      'uniidev',
      'xslash58',
      'moltobenne_',
      'said',
      'slaiqe',
      'djrr13',
      'tuk7',
      'giovahni',
      'feelssunnyman',
      'br_winters',
      'zo0x_',
      'jilence',
      'sirstendec',
      'marc',
      'themizeguy',
      'dansalvato',
      'tduva',
      'igorovh',
      'night',
      'itzalexpl',
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

  it('uses the maintained Halloween 7TV preview catalog', () => {
    expect(PREVIEW_SEASONAL_SEVENTV_SET_ID)
      .toBe('01M4E9Y7XNVPB9DTS6TF4VVDXY');

    expect(
      PREVIEW_SEASONAL_SEVENTV_EMOTES.map((emote) => emote.name),
    ).toEqual([
      'OMEGALUL',
      'catJAM',
      'HUH',
      'KEKW',
      'PUMPKIN',
      'boo',
      'peepoScared',
      'skeletonPls',
      'doot',
      'GIGADEAD',
      'candyy',
      'peepoChainsaw',
    ]);

    expect(
      PREVIEW_SEASONAL_SEVENTV_EMOTES.every(
        (emote) =>
          emote.image.startsWith('https://cdn.7tv.app/emote/')
          && emote.image.endsWith('/4x.webp')
          && !emote.zeroWidth,
      ),
    ).toBe(true);
  });
  it('pins the requested six preview emotes to the exact 7TV set and provider ids', () => {
    expect(
      PREVIEW_FEATURED_SEVENTV_SET_ID,
    ).toBe(
      '01M4E9Y7XNVPB9DTS6TF4VVDXY',
    );

    expect(
      PREVIEW_FEATURED_SEVENTV_EMOTES.map(
        (emote) =>
          emote.name,
      ),
    ).toEqual([
      'LOL',
      'gg',
      'ome32',
      'sob',
      'ome44',
      'RT',
    ]);

    expect(
      PREVIEW_FEATURED_SEVENTV_EMOTES.map(
        (emote) =>
          emote.image,
      ),
    ).toEqual([
      'https://cdn.7tv.app/emote/01K5HWC3JPGCSTBS3Q01BX3DAW/4x.webp',
      'https://cdn.7tv.app/emote/01K6VBHM2R6FCW7ZP3G63Z70JG/4x.webp',
      'https://cdn.7tv.app/emote/01K63XSSSTWMF1HQ15D8VJ8550/4x.webp',
      'https://cdn.7tv.app/emote/01M3Z94FR0HAQMJP73RVNX0X8G/4x.webp',
      'https://cdn.7tv.app/emote/01K67DE7YJ0YCQGGQSMGH1Z0PQ/4x.webp',
      'https://cdn.7tv.app/emote/01K77M7Z1VE1VXDMMY3414JGQ5/4x.webp',
    ]);

    expect(
      PREVIEW_FEATURED_SEVENTV_EMOTES.every(
        (emote) =>
          !emote.zeroWidth,
      ),
    ).toBe(true);
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

    expect(result.current.feedTemplates).toHaveLength(PREVIEW_ROSTER.length);
    expect(
      new Set(
        result.current.feedTemplates.map(
          (template) => template.senderUsername!.toLowerCase(),
        ),
      ).size,
    ).toBe(PREVIEW_ROSTER.length);
    expect(result.current.templates.map((template) => template.text))
      .toEqual(
        PREVIEW_ROSTER.map((entry, index) =>
          withResolvedSevenTVEmotes(
            PREVIEW_MESSAGES[index % PREVIEW_MESSAGES.length]!,
            undefined,
            index,
            0,
            'emoteCount' in entry ? entry.emoteCount : 0,
          ),
        ),
      );
    expect(result.current.templates.map((template) => template.displayPlatform))
      .toEqual(PREVIEW_PLATFORM_SEQUENCE.slice(0, PREVIEW_ROSTER.length));
    expect(result.current.templates.every((template) => template.platform === 'twitch')).toBe(true);
    const logos = result.current.templates.map((template) => template.displayPlatform);
    expect(logos.every((logo, index) => index === 0 || logo !== logos[index - 1])).toBe(true);
    unmount();
  });

  it('prefers the fixed featured 7TV catalog before identity-resolved fallbacks', () => {
    const response = responseFor('gxufy');
    expect(withResolvedSevenTVEmotes('', response, 0, 0, 1))
      .toBe('LOL');
    expect(withResolvedSevenTVEmotes('hello', response, 0, 0, 2))
      .toBe('hello LOL gg');
    expect(withResolvedSevenTVEmotes('hello', undefined, 0, 0, 1))
      .toBe('hello LOL');

    const templates = rosterTemplates(new Map([['gxufy', response]]), 0);
    expect(templates[0]!.text)
      .toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(templates[0]!.text).not.toContain('ZeroOverlay');
    expect(templates[1]!.text).toBe(PREVIEW_MESSAGES[1]);
  });

  it('never borrows another preview identity 7TV artwork', () => {
    const gxufy = withoutSevenTV('gxufy');
    const djrr13 = responseFor('djrr13');
    const responses = new Map<string, PreviewIdentityResponse>([
      ['gxufy', gxufy],
      ['djrr13', djrr13],
    ]);

    expect(resolvedSevenTVResponse(gxufy, responses)).toBeUndefined();

    const templates = rosterTemplates(responses, 0);
    expect(templates[0]!.text)
      .toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(templates[0]!.text).not.toContain('ZeroOverlay');
    expect(templates[0]!.text).not.toContain('PersonalReal');
  });

  it('includes owned native Twitch badges and removes exact duplicate preview art', () => {
    const base = responseFor('gxufy');
    const duplicateUrl = base.communityBadges?.[0]?.url;

    expect(duplicateUrl).toBeTruthy();

    const response: PreviewIdentityResponse = {
      ...base,
      communityBadges: [
        ...(base.communityBadges ?? []),
        {
          type: 'community:chatty:mirrored-owner',
          title: 'Mirrored Owner',
          url: duplicateUrl!,
        },
      ],
      providers: {
        ...base.providers,
        Twitch: {
          ...base.providers.Twitch!,
          resources: {
            ...base.providers.Twitch!.resources,
            ownedBadges: [
              {
                type: 'partner',
                version: '1',
                title: 'Verified',
              },
            ],
          },
        },
      },
    };

    const badges = curatedBadges(
      PREVIEW_ROSTER[0]!,
      response,
      0,
    );

    expect(badges[0]).toEqual({
      type: 'partner',
      version: '1',
      title: 'Verified',
    });

    expect(
      badges.filter((badge) => badge.url === duplicateUrl),
    ).toHaveLength(1);
  });
  it('uses full resolved community badges and ignores flattened Twitch badge-map copies', () => {
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

    expect(badges[1]).toMatchObject({
      type: 'community:moltorino:friend',
      title: 'Moltorino Friend',
      url: 'https://cdn.example/gxufy-community-friend.png',
      fallbackUrl: 'https://cdn.example/gxufy-community-friend-fallback.png',
      backgroundColor: '#123456',
    });

    expect(new Set(badges.map((badge) => badge.url)).size).toBe(badges.length);
  });

  it('keeps every roster member resolved badges attached only to that identity', () => {
    const responses = new Map(
      PREVIEW_ROSTER.map((entry) => [entry.login, responseFor(entry.login)] as const),
    );
    const templates = rosterTemplates(responses, 0);

    for (const [index, entry] of PREVIEW_ROSTER.entries()) {
      const expected = responseFor(entry.login).communityBadges ?? [];

      expect(templates[index]!.senderUsername).toBe(entry.login);
      expect(templates[index]!.badges).toEqual(expected);
      expect(templates[index]!.badges.every((badge) => (
        !badge.url || badge.url.includes(`/${entry.login}-`)
      ))).toBe(true);
    }
  });
  it('uses the exact bChat Twitch visible-name rule for preview identities', () => {
    const providerCase = responseFor('gxufy');

    const tuk7Base = responseFor('tuk7');
    const tuk7: PreviewIdentityResponse = {
      ...tuk7Base,
      identity: {
        ...tuk7Base.identity,
        displayName: 'TUK7',
      },
    };

    const responses = new Map<string, PreviewIdentityResponse>([
      ['gxufy', providerCase],
      ['tuk7', tuk7],
    ]);

    const templates = rosterTemplates(responses, 0);
    const tuk7Index = PREVIEW_ROSTER.findIndex((entry) => entry.login === 'tuk7');

    // Different ignoring case => login (display-name)
    expect(templates[0]!.username).toBe('gxufy (ProviderCase)');

    // Same ignoring case => Twitch display-name only
    expect(tuk7Index).toBeGreaterThanOrEqual(0);
    expect(templates[tuk7Index]!.username).toBe('TUK7');
    expect(templates[tuk7Index]!.senderUsername).toBe('tuk7');
  });

  it('bounds identity loading concurrency at two and continues after an independent failure', async () => {
    let active = 0;
    let peak = 0;

    const resolvers = new Map<string, {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
    }>();

    let jilChatCalls = 0;

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(
        String(input),
        'http://local',
      );

      if (url.pathname === '/api/twitch/jilchat-badges') {
        jilChatCalls += 1;
        return Promise.resolve(
          jsonResponse([]),
        );
      }

      const login =
        url.searchParams.get('login')!;

      active += 1;
      peak = Math.max(
        peak,
        active,
      );

      return new Promise<Response>((resolve, reject) =>
        resolvers.set(login, {
          resolve: (value) => {
            active -= 1;
            resolve(value);
          },
          reject: (error) => {
            active -= 1;
            reject(error);
          },
        }),
      );
    }));

    const { result } =
      renderHook(() =>
        useTwitchPreviewRoster(),
      );

    expect(
      PREVIEW_ROSTER_CONCURRENCY,
    ).toBe(2);

    /*
     * Two identities should begin immediately.
     */
    await waitFor(() => {
      expect(
        resolvers.has('gxufy'),
      ).toBe(true);

      expect(
        resolvers.has('blu01_'),
      ).toBe(true);
    });

    expect(
      resolvers.has('uniidev'),
    ).toBe(false);

    expect(peak).toBe(
      PREVIEW_ROSTER_CONCURRENCY,
    );

    /*
     * Finishing gxufy should immediately free one slot for uniiDev while
     * blu01_ remains in flight.
     */
    await act(async () =>
      resolvers
        .get('gxufy')!
        .resolve(
          jsonResponse(
            responseFor('gxufy'),
          ),
        ),
    );

    await waitFor(() =>
      expect(
        result.current.responses.has(
          'gxufy',
        ),
      ).toBe(true),
    );

    await waitFor(() =>
      expect(
        resolvers.has('uniidev'),
      ).toBe(true),
    );

    expect(
      resolvers.has('xslash58'),
    ).toBe(false);

    /*
     * A failure also releases its slot and the next identity continues.
     */
    await act(async () =>
      resolvers
        .get('blu01_')!
        .reject(
          new Error('offline'),
        ),
    );

    await waitFor(() =>
      expect(
        resolvers.has('xslash58'),
      ).toBe(true),
    );

    expect(
      result.current.templates[0]!.username,
    ).toBe(
      'gxufy (ProviderCase)',
    );

    expect(
      result.current.templates[0]!.text,
    ).toBe(
      `${PREVIEW_MESSAGES[0]} LOL`,
    );

    expect(peak).toBe(
      PREVIEW_ROSTER_CONCURRENCY,
    );

    /*
     * Deferred community work still waits until base identity hydration ends.
     */
    expect(jilChatCalls).toBe(0);
  });

  it('reuses cached identities while cycling the MultiChat preview feed', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://local');

      if (url.pathname === '/api/twitch/jilchat-badges') {
        return Promise.resolve(jsonResponse([]));
      }

      const login = url.searchParams.get('login')!;
      return Promise.resolve(jsonResponse(responseFor(login)));
    });

    const previewIdentityCallCount = () => (
      fetchMock.mock.calls.filter(([input]) => (
        new URL(String(input), 'http://local').pathname
        === '/api/twitch/preview-identity'
      )).length
    );

    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTwitchPreviewRoster());
    await waitFor(() => expect(result.current.responses.size).toBe(PREVIEW_ROSTER.length));
    expect(previewIdentityCallCount()).toBe(PREVIEW_ROSTER.length);

    const before = result.current.templates.map((template) => `${template.text}|${template.displayPlatform}`);
    act(() => result.current.loadMore());
    expect(result.current.page).toBe(1);
    expect(result.current.templates.map((template) => `${template.text}|${template.displayPlatform}`))
      .not.toEqual(before);

    act(() => result.current.reset());
    expect(result.current.page).toBe(0);
    expect(result.current.templates[0]!.text)
      .toBe(`${PREVIEW_MESSAGES[0]} LOL`);
    expect(result.current.templates[1]!.text).toBe(PREVIEW_MESSAGES[1]);
    expect(previewIdentityCallCount()).toBe(PREVIEW_ROSTER.length);
  });
});
