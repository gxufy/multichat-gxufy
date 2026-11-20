import { describe, expect, it } from 'vitest';
import {
  PREVIEW_OWNER_LINES,
  PREVIEW_OWNER_MESSAGES,
  previewRosterLine,
  PREVIEW_MESSAGES,
  PREVIEW_FEATURED_SEVENTV_EMOTES,
  PREVIEW_FEATURED_SEVENTV_SET_ID,
  PREVIEW_SEASONAL_SEVENTV_EMOTES,
  PREVIEW_SEASONAL_SEVENTV_SET_ID,
  PREVIEW_PLATFORM_SEQUENCE,
  PREVIEW_ROSTER,
  PREVIEW_FIXED_SEVENTV_EMOTES,
  curatedBadges,
  rosterTemplates,
  withChristmasEmotes,
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

describe('curated Preview Identity roster', () => {
  it('keeps the curated roster, requested names, and MultiChat preview copy', () => {
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
      'good morning chat',
      'minecraft had an update',
      'that last round was insane',
      'close game, well played',
      'what game are we playing next',
      'just got here, what did I miss',
      'this song goes hard',
      'wait what just happened',
      'first snow of the year here',
      'it is freezing outside today',
      'anyone gifting subs tonight',
      'that is so real',
      'merry early christmas chat',
      'i cannot stop laughing at that',
      'who else is here from the clip',
      'lost my last game by one point',
      'brb grabbing some hot cocoa',
      'chat is moving so fast today',
      'hydrate chat',
      'clip it clip it',
      'welcome in, raiders',
    ]);
    expect(PREVIEW_OWNER_MESSAGES).toEqual([
      'FlossChat keeps every platform in one clean feed',
      'one OBS source for Kick Twitch YouTube and TikTok',
      'Kick Twitch YouTube TikTok all in one chat',
      'custom fonts with the same chat layout',
    ]);
    expect(PREVIEW_MESSAGES.join(' ')).not.toMatch(/Thank you for the follow|MAMA I MADE IT|titty\?/i);
  });

  it('uses the Christmas emotes from the 7TV Winter 2026 set', () => {
    expect(PREVIEW_SEASONAL_SEVENTV_SET_ID).toBe('01M6SD32WBWQTJ0KR394S97W2B');
    expect(PREVIEW_SEASONAL_SEVENTV_EMOTES.map((emote) => emote.name)).toEqual([
      'OMEGALUL', 'catJam', 'HUH', 'peepoSnow', 'Coldge', 'ANYGIFTERS',
    ]);
    expect(PREVIEW_SEASONAL_SEVENTV_EMOTES.map((emote) => emote.image)).toEqual([
      'https://cdn.7tv.app/emote/01FM7C29GR000B3TR3VAP7TG9C/4x.webp',
      'https://cdn.7tv.app/emote/01F6ME9FRG0005TFYTWP1H8R42/4x.webp',
      'https://cdn.7tv.app/emote/01FNVD0RN00001BCZZ99DVHCDB/4x.webp',
      'https://cdn.7tv.app/emote/01GE7AA84G00077M44K0MYHDAM/2x.webp',
      'https://cdn.7tv.app/emote/01HE4DR2Q00008YG0BRYZWVQAE/4x.webp',
      'https://cdn.7tv.app/emote/01F8B1AVE80009ZNKS3FYBE16M/4x.webp',
    ]);
    expect(PREVIEW_SEASONAL_SEVENTV_EMOTES.every((emote) => !emote.zeroWidth)).toBe(true);
  });

  it('pins the six featured preview emotes to their Christmas versions in the Winter 2026 set', () => {
    expect(PREVIEW_FEATURED_SEVENTV_SET_ID).toBe('01M6SD32WBWQTJ0KR394S97W2B');
    expect(PREVIEW_FEATURED_SEVENTV_EMOTES.map((emote) => emote.name)).toEqual([
      'LOL', 'gg', 'ome32', 'sob', 'ome44', 'RT',
    ]);
    expect(PREVIEW_FEATURED_SEVENTV_EMOTES.map((emote) => emote.image)).toEqual([
      'https://cdn.7tv.app/emote/01JBZXQGFKS1C06WD5NV35XHRE/4x.webp',
      'https://cdn.7tv.app/emote/01HGB1G0580005M8CT8N9Z3PPR/4x.webp',
      'https://cdn.7tv.app/emote/01JCRHQ9KSQQQJQRNRZCHNXT2M/4x.webp',
      'https://cdn.7tv.app/emote/01GDCCD6CG000C0VZXRM1MVA0M/4x.webp',
      'https://cdn.7tv.app/emote/01JDB6HAV4Y3K1CREKHQRCW4ZT/4x.webp',
      'https://cdn.7tv.app/emote/01J3KKQEYG0004BE3DN7Y1GQPZ/4x.webp',
    ]);
    expect(PREVIEW_FEATURED_SEVENTV_EMOTES.every((emote) => !emote.zeroWidth)).toBe(true);
  });

  it('adds each line\'s own Christmas 7TV emotes, and only ones the preview has artwork for', () => {
    expect(withChristmasEmotes({ text: 'wait what just happened', emotes: ['HUH', 'OMEGALUL'] }))
      .toBe('wait what just happened HUH OMEGALUL');
    expect(withChristmasEmotes({ text: 'minecraft had an update', emotes: [] })).toBe('minecraft had an update');
    expect(withChristmasEmotes({ text: 'hello', emotes: ['NotAChristmasEmote', 'LOL'] })).toBe('hello LOL');

    const djrr13 = responseFor('djrr13');
    const templates = rosterTemplates(new Map([['gxufy', withoutSevenTV('gxufy')], ['djrr13', djrr13]]), 0);
    expect(templates[0]!.text).toBe(`${PREVIEW_OWNER_LINES[0].text} peepoSnow`);
    const unii = PREVIEW_ROSTER.findIndex((entry) => entry.login === 'uniidev');
    expect(templates[unii]!.text).toBe('minecraft had an update');
    /* Never another identity's artwork, never a zero-width overlay. */
    for (const template of templates) {
      expect(template.text).not.toContain('ZeroOverlay');
      expect(template.text).not.toContain('PersonalReal');
    }
  });

  it('gives every community member a different line, with emotes from the Christmas set only', () => {
    expect(new Set(PREVIEW_MESSAGES).size).toBe(PREVIEW_MESSAGES.length);
    const christmas = new Set<string>(PREVIEW_FIXED_SEVENTV_EMOTES.map((emote) => emote.name));
    const lines = [...PREVIEW_OWNER_LINES, ...PREVIEW_ROSTER.map((entry, index) => previewRosterLine(entry, index, 0))];
    for (const line of lines) {
      for (const name of line.emotes) expect(christmas.has(name), `${line.text}: ${name}`).toBe(true);
      /* No word in the text is itself an emote name, so the text reads as written. */
      for (const word of line.text.split(/\s+/)) expect(christmas.has(word.replace(/[,.!?]$/, '')), `${line.text}: ${word}`).toBe(false);
    }
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
  it('uses the Twitch visible-name rule for preview identities', () => {
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

});

describe('real community members never appear to endorse the overlay', () => {
  const PROMO = /flosschat|overlay|preview|obs|badge|emote|7tv|platform|kick|twitch|youtube|tiktok|font|clean|smooth|tough|\bw\b|fire|keeping this/i;

  it('gives every person except the owner only ordinary stream-chat lines, on every page', () => {
    for (const line of PREVIEW_MESSAGES) expect(line, line).not.toMatch(PROMO);
    PREVIEW_ROSTER.forEach((entry, index) => {
      if (entry.login === 'gxufy') return;
      expect(PREVIEW_MESSAGES as readonly string[]).toContain(entry.fallbackText);
      for (let page = 0; page < 40; page += 1) {
        expect(previewRosterLine(entry, index, page).text, `${entry.login} page ${page}`)
          .toBe(entry.fallbackText);
      }
    });
  });

  it('keeps the FlossChat lines on the owner\'s own account only', () => {
    const owner = PREVIEW_ROSTER.find((entry) => entry.login === 'gxufy')!;
    for (let page = 0; page < 10; page += 1) {
      expect(PREVIEW_OWNER_MESSAGES as readonly string[]).toContain(previewRosterLine(owner, 0, page).text);
    }
    const unii = PREVIEW_ROSTER.findIndex((entry) => entry.login === 'uniidev');
    for (let page = 0; page < 40; page += 1) {
      expect(previewRosterLine(PREVIEW_ROSTER[unii]!, unii, page).text).toBe('minecraft had an update');
    }
  });
});
