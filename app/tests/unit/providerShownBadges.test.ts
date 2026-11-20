import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { validateCommunityBadgeAssetUrl } from '@/lib/server/communityBadgeAsset';
import { parseJilChatOwnership } from '@/lib/server/vanityCommunityBadges';
import { parseEnhancerUserBadges } from '@/lib/server/enhancerBadges';
import enhancerUserHandler, { __resetEnhancerUserBadgeCacheForTests } from '@/pages/api/twitch/enhancer-user-badges';
import { resetFixedProviderResourcesForTests } from '@/lib/server/fixedProviderProxy';
import { EMPTY_SEVENTV_IDENTITY_RESOURCES, type PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import {
  applyPreviewLiveCosmetics,
  fetchPreviewShownProviderBadges,
} from '@/features/multichat/previewLiveCosmetics';

const GXUFY = '204219574';

/* Real JilChat /v1/badges/user/204219574/all response, 2026-11-14. */
const JILCHAT_ALL = [
  { badge_id: '1c1c8e6a', slug: 'halloween_2026', name: 'JilChat Halloween 2026', image_url: 'https://api.jil.chat/uploads/badges/d30e7dbc.png', visible: false, active: false, free_selectable: false },
  { badge_id: '42f28d64', slug: 'first', name: 'JilChat First', image_url: 'https://api.jil.chat/uploads/badges/24ea140e.png', visible: false, active: false, free_selectable: false },
  { badge_id: 'b020a256', slug: 'translator', name: 'JilChat Translator', image_url: 'https://api.jil.chat/uploads/badges/5b51d929.png', visible: true, active: true, free_selectable: true },
  { badge_id: '00000000', slug: 'milestone_1', name: 'JilChat Month 1', image_url: 'https://api.jil.chat/uploads/milestone-badges/e8e548db.png', visible: false, active: false, free_selectable: false },
];

/* Real Enhancer /v1/user/twitch/204219574 shape, 2026-11-14 (sources trimmed). */
const ENHANCER_USER = {
  platform: 'TWITCH', accountId: 'a910f7be', externalId: GXUFY, login: 'gxufy', displayName: 'Gxufy',
  global: {
    appearance: null,
    badges: [
      { badgeId: '4485e06e-9289-4e83-9425-d43245615643', name: '1 month supporter', description: '', priority: 0,
        sources: { '18x18': 'https://cdn.enhancer.at/badge/ecd54b/18.webp', '72x72': 'https://cdn.enhancer.at/badge/ecd54b/72.webp' } },
      { badgeId: '66b073f1-9fa1-41a6-bd2f-c347ce3bccd1', name: 'Founder', description: '', priority: 0,
        sources: { '72x72': 'https://cdn.enhancer.at/badge/59c70d/72.webp' } },
    ],
  },
  channels: [], page: 1, hasNextPage: false,
};

describe('DankChat badge art host', () => {
  it('accepts api.dank.chat, where DankChat now serves badge images', () => {
    expect(validateCommunityBadgeAssetUrl('https://api.dank.chat/badges/dank.png', 'dankchat')).toBe('https://api.dank.chat/badges/dank.png');
    expect(validateCommunityBadgeAssetUrl('https://flxrs.com/badges/x.png', 'dankchat')).toBe('https://flxrs.com/badges/x.png');
    expect(validateCommunityBadgeAssetUrl('https://evil.example/dank.png', 'dankchat')).toBeNull();
  });
});

describe('JilChat shown badge', () => {
  it('returns only the badge the user chose to display', () => {
    const badges = parseJilChatOwnership(JILCHAT_ALL, GXUFY, new Map());
    expect(badges?.map((badge) => badge.id)).toEqual(['translator']);
  });

  it('returns none when the user displays none, and keeps legacy payloads unchanged', () => {
    const hidden = JILCHAT_ALL.map((badge) => ({ ...badge, visible: false }));
    expect(parseJilChatOwnership(hidden, GXUFY, new Map())).toEqual([]);
    const legacy = JILCHAT_ALL.map(({ visible: _visible, ...badge }) => badge);
    expect(parseJilChatOwnership(legacy, GXUFY, new Map())?.length).toBe(4);
  });
});

describe('Enhancer per-user badges', () => {
  it('parses the user lookup in display order with the largest safe source', () => {
    expect(parseEnhancerUserBadges(ENHANCER_USER, GXUFY)).toEqual([
      { id: '4485e06e-9289-4e83-9425-d43245615643', title: '1 month supporter', url: 'https://cdn.enhancer.at/badge/ecd54b/72.webp' },
      { id: '66b073f1-9fa1-41a6-bd2f-c347ce3bccd1', title: 'Founder', url: 'https://cdn.enhancer.at/badge/59c70d/72.webp' },
    ]);
  });

  it('rejects a response for another user or platform', () => {
    expect(parseEnhancerUserBadges(ENHANCER_USER, '1')).toBeNull();
    expect(parseEnhancerUserBadges({ ...ENHANCER_USER, platform: 'KICK' }, GXUFY)).toBeNull();
  });
});

describe('/api/twitch/enhancer-user-badges', () => {
  function call(userId: string) {
    const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
    const response = {
      setHeader: (key: string, value: string) => { res.headers[key] = value; return response; },
      status: (code: number) => { res.statusCode = code; return response; },
      json: (body: unknown) => { res.body = body; return response; },
    } as unknown as NextApiResponse;
    const req = { method: 'GET', query: { userId }, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as NextApiRequest;
    return enhancerUserHandler(req, response).then(() => res);
  }

  beforeEach(() => {
    __resetEnhancerUserBadgeCacheForTests();
    resetFixedProviderResourcesForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('serves parsed badges and caches them', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENHANCER_USER), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await call(GXUFY);
    const second = await call(GXUFY);
    expect(first.statusCode).toBe(200);
    expect((first.body as Array<{ title: string }>)[0]!.title).toBe('1 month supporter');
    expect(second.body).toEqual(first.body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls as unknown[][])[0]![0])).toBe(`https://api.enhancer.at/v1/user/twitch/${GXUFY}`);
  });

  it('treats an unknown Enhancer user as no badges and rejects bad IDs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })));
    expect((await call('36194025')).body).toEqual([]);
    expect((await call('12;drop')).statusCode).toBe(400);
  });
});

describe('preview shown-provider badges', () => {
  const base = (communityBadges: PreviewIdentityResponse['communityBadges']): PreviewIdentityResponse => ({
    identity: { userId: GXUFY, login: 'gxufy', displayName: 'Gxufy' },
    providers: { '7TV': { status: 'loaded', resources: EMPTY_SEVENTV_IDENTITY_RESOURCES } },
    communityBadges,
  });

  it('fetches Enhancer per user and JilChat through the guard', async () => {
    const fetchImpl = vi.fn(async (input?: RequestInfo | URL) => (String(input).includes(GXUFY)
      ? new Response(JSON.stringify([{ id: '4485e06e', title: '1 month supporter', url: 'https://cdn.enhancer.at/badge/ecd54b/72.webp' }]), { status: 200 })
      : new Response('[]', { status: 200 })));
    const resolveJilChat = vi.fn(async (id: string) => (id === GXUFY
      ? { badges: [{ type: 'community:jilchat:translator', title: 'JilChat Translator', url: 'https://api.jil.chat/uploads/badges/5b51d929.png' }], authoritative: true }
      : { badges: [], authoritative: false }));
    const shown = await fetchPreviewShownProviderBadges([GXUFY, '36194025'], { fetchImpl, resolveJilChat });
    expect(shown.get(GXUFY)?.get('enhancer')).toEqual([{ type: 'community:enhancer:4485e06e', title: '1 month supporter', url: 'https://cdn.enhancer.at/badge/ecd54b/72.webp' }]);
    expect(shown.get(GXUFY)?.get('jilchat')?.[0]?.title).toBe('JilChat Translator');
    /* A 200 [] from Enhancer is an authoritative "none"; a skipped JilChat lookup is ignored. */
    expect(shown.get('36194025')?.get('enhancer')).toEqual([]);
    expect(shown.get('36194025')?.has('jilchat')).toBe(false);
  });

  it('removes a stale catalog JilChat badge when JilChat says the user shows none', async () => {
    const jilence = '438697907';
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 }));
    const resolveJilChat = vi.fn(async () => ({ badges: [], authoritative: true }));
    const shown = await fetchPreviewShownProviderBadges([jilence], { fetchImpl, resolveJilChat });
    expect(shown.get(jilence)?.get('jilchat')).toEqual([]);
    const stale = { type: 'community:jilchat:founder-beta', title: 'JilChat Founder', url: 'https://api.jil.chat/uploads/badges/662a747a.png' };
    const ffz = { type: 'community:ffz:3', url: 'https://cdn.frankerfacez.com/badge/3/4' };
    const catalog = new Map([['jilence', { ...base([stale, ffz]), identity: { userId: jilence, login: 'jilence', displayName: 'jilence' } }]]);
    const next = applyPreviewLiveCosmetics(catalog, { sevenTV: new Map(), communityBadges: new Map(), shownProviderBadges: shown });
    expect(next.get('jilence')!.communityBadges).toEqual([ffz]);
  });

  it('replaces only the providers it knows, keeping every other badge', () => {
    const founder = { type: 'community:enhancer:66b073f1', title: 'Founder', url: 'https://cdn.enhancer.at/badge/59c70d/72.webp' };
    const ffz = { type: 'community:ffz:3', url: 'https://cdn.frankerfacez.com/badge/3/4' };
    const catalog = new Map([['gxufy', base([founder, ffz])]]);
    const supporter = { type: 'community:enhancer:4485e06e', title: '1 month supporter', url: 'https://cdn.enhancer.at/badge/ecd54b/72.webp' };
    const translator = { type: 'community:jilchat:translator', title: 'JilChat Translator', url: 'https://api.jil.chat/uploads/badges/5b51d929.png' };
    const next = applyPreviewLiveCosmetics(catalog, {
      sevenTV: new Map(),
      communityBadges: new Map(),
      shownProviderBadges: new Map([[GXUFY, new Map([['enhancer', [supporter]], ['jilchat', [translator]]])]]),
    });
    expect(next.get('gxufy')!.communityBadges).toEqual([ffz, supporter, translator]);
  });
});

describe('Chatty native badges', () => {
  it('accepts the protocol-relative art Chatty uses for its own badges', async () => {
    const { default: chattyHandler } = await import('@/pages/api/twitch/chatty-badges');
    resetFixedProviderResourcesForTests();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'chatty', version: 'dev', image_url: '//tduva.com/img/chatty_badge_wrench_1.png', image_url_2: '//tduva.com/img/chatty_badge_wrench_2.png', image_url_4: '//tduva.com/img/chatty_badge_wrench_4.png', color: null, meta_title: 'Chatty Developer', usernames: ['tduva'] },
      { id: 'chatty', version: 'evil', image_url_4: '//evil.example/x.png', meta_title: 'Bad', usernames: ['x'] },
    ]), { status: 200 })));
    const res = { statusCode: 0, body: undefined as unknown };
    const response = {
      setHeader: () => response,
      status: (code: number) => { res.statusCode = code; return response; },
      json: (body: unknown) => { res.body = body; return response; },
    } as unknown as NextApiResponse;
    await chattyHandler({ method: 'GET', query: {}, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as NextApiRequest, response);
    vi.unstubAllGlobals();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([
      { id: 'chatty-dev', title: 'Chatty Developer', url: 'https://tduva.com/img/chatty_badge_wrench_4.png', users: [], usernames: ['tduva'] },
    ]);
  });
});

describe('Twitch badge set IDs keep their case', () => {
  it('matches a catalog badge stored lowercased against case-sensitive Twitch art', () => {
    const itz: PreviewIdentityResponse = {
      identity: { userId: '59842770', login: 'itzalexpl', displayName: 'itzAlexPL' },
      providers: { Twitch: { status: 'loaded', resources: { globalBadges: {}, channelBadges: {}, ownedBadges: [{ type: 'twitchconeu2022', version: '1' }] } } },
    };
    const next = applyPreviewLiveCosmetics(new Map([['itzalexpl', itz]]), {
      sevenTV: new Map(),
      communityBadges: new Map(),
      twitchWornBadges: new Map([['59842770', [{ type: 'twitchconEU2022', version: '1', title: 'TwitchCon 2022 - Amsterdam' }]]]),
      twitchBadgeArt: { 'twitchconEU2022/1': 'https://static-cdn.jtvnw.net/badges/v1/e4744003/2' },
    });
    expect(next.get('itzalexpl')!.providers.Twitch!.resources.ownedBadges).toEqual([
      { type: 'twitchconEU2022', version: '1', title: 'TwitchCon 2022 - Amsterdam', url: 'https://static-cdn.jtvnw.net/badges/v1/e4744003/2' },
    ]);
  });
});

describe('last-known-good community badges when a provider fails', () => {
  it('keeps catalog badges for a provider that failed this refresh, and only for it', () => {
    const ffz = { type: 'community:ffz:3', url: 'https://cdn.frankerfacez.com/badge/3/4' };
    const oldBchat = { type: 'community:bchat:old', url: 'https://itsbr0dyy.dev/badges/old.webp' };
    const chatterino = { type: 'community:chatterino:chatterino-supporter', url: 'https://fourtf.com/chatterino/badges/supporter3x.png' };
    const catalog = new Map([['gxufy', {
      identity: { userId: GXUFY, login: 'gxufy', displayName: 'Gxufy' },
      providers: {},
      communityBadges: [ffz, oldBchat, chatterino],
    } as PreviewIdentityResponse]]);
    const next = applyPreviewLiveCosmetics(catalog, {
      sevenTV: new Map(),
      communityBadges: new Map([[GXUFY, [chatterino]]]),
      communityFailedProviders: new Set(['ffz']),
    });
    /* FFZ failed → kept; BChat loaded and no longer lists the badge → dropped. */
    expect(next.get('gxufy')!.communityBadges).toEqual([chatterino, ffz]);
  });

  it('reports which registry providers failed to load', async () => {
    const { __resetCommunityBadgeCache, communityBadgeProviderFailures, resolveTwitchCommunityBadgesWithoutJilChat } = await import('@/lib/communityBadges');
    __resetCommunityBadgeCache();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('frankerfacez.com')) throw new TypeError('timeout');
      return new Response('[]', { status: 200 });
    }));
    await resolveTwitchCommunityBadgesWithoutJilChat({ userId: GXUFY, login: 'gxufy' });
    expect(communityBadgeProviderFailures()).toContain('ffz');
    vi.unstubAllGlobals();
    __resetCommunityBadgeCache();
  });
});
