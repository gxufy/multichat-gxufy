/*
 * A Twitch chatter's own badge layout from Moltorino v2 (which kinds of badge
 * they hid, and their order) applies to their badges on every overlay, inside
 * what the streamer's badge layout shows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import { partsToHtml } from '@/lib/render/elementTree';
import {
  __resetCommunityBadgeCache,
  moltorinoBadgeLayoutFor,
  parseMoltorinoV2Layouts,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';
import { applyViewerBadgeLayout, twitchBadgeSlot, viewerBadgeLayoutFrom, viewerBadgeSlot } from '@/lib/viewerBadgeLayout';
import type { UnifiedMessage, ViewerBadgeLayout } from '@/lib/types';

const art = (name: string) => `https://example.com/${name}.png`;

const message = (layout?: ViewerBadgeLayout, platform: UnifiedMessage['platform'] = 'twitch'): UnifiedMessage => ({
  platform,
  id: 'viewer-layout',
  senderId: '42',
  username: 'viewer',
  color: '#ffffff',
  badges: [
    { type: 'moderator', url: art('moderator') },
    { type: 'subscriber', url: art('subscriber') },
    { type: 'glhf-pledge', url: art('glhf') },
    { type: 'community:chatterino:dev', url: art('chatterino') },
    { type: 'community:ffz:sub', url: art('ffz') },
    { type: 'community:bttv:pro', url: art('bttv') },
    { type: 'community:moltorino:supporter', url: art('moltorino') },
    { type: 'community:turteg:x', url: art('turteg') },
  ],
  text: 'hello',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
  ...(layout ? { viewerBadgeLayout: layout } : {}),
});

function order(um: UnifiedMessage, badgeLayout?: string): string[] {
  const parsed = buildParsedMessage(
    um,
    { sevenTVEmotesEnabled: true, sevenTVCosmeticsEnabled: true, showCommunityBadges: true, paintShadows: true, ...(badgeLayout ? { badgeLayout } : {}) },
    NO_COSMETICS,
    { enabled: false, colors: new Map<string, string>() },
    1,
  );
  const html = partsToHtml(parsed.identity.badges as never);
  return [...html.matchAll(/example\.com\/([a-z]+)\.png/g)].map((match) => match[1]!);
}

describe('kinds of badge', () => {
  it("split Twitch's own badges into roles, subscriber, predictions and the rest", () => {
    expect(['broadcaster', 'moderator', 'lead_moderator', 'vip', 'staff', 'admin', 'global_mod'].map(twitchBadgeSlot)).toEqual(Array(7).fill('ta'));
    expect(['subscriber', 'founder'].map(twitchBadgeSlot)).toEqual(['ts', 'ts']);
    expect(twitchBadgeSlot('predictions')).toBe('tp');
    expect(['glhf-pledge', 'partner', 'turbo', 'bits'].map(twitchBadgeSlot)).toEqual(Array(4).fill('tv'));
  });

  it('name our community providers by their Moltorino kind; others have none', () => {
    expect(viewerBadgeSlot({ type: 'community:ffz:x' })).toBe('ff');
    expect(viewerBadgeSlot({ type: 'community:ffzap:x' })).toBe('fa');
    expect(viewerBadgeSlot({ type: 'community:custom-homies:x' })).toBe('hc');
    expect(viewerBadgeSlot({ type: 'community:homies:x' })).toBe('hs');
    expect(viewerBadgeSlot({ type: 'community:jilchat:x' })).toBe('jc');
    expect(viewerBadgeSlot({ type: 'community:turteg:x' })).toBeNull();
    expect(viewerBadgeSlot({ type: 'community:gxufy:supporter' })).toBeNull();
  });

  it('read layouts leniently: legacy t:<set> keys become their kind, junk and repeats are dropped', () => {
    expect(viewerBadgeLayoutFrom(['t:moderator', 't:subscriber', '7', 'nope', '7', 42], ['ts', 'T:Founder'])).toEqual({
      order: ['ta', 'ts', '7'],
      hidden: ['ts'],
    });
    expect(viewerBadgeLayoutFrom(undefined, [])).toBeNull();
    expect(viewerBadgeLayoutFrom('m', null)).toBeNull();
  });

  it('sort: badges without a kind first, then the chosen order, unplaced kinds in the default order after', () => {
    const items = [
      { slot: 'ta' as const, value: 'role' },
      { slot: null, value: 'other' },
      { slot: '7' as const, value: '7tv' },
      { slot: 'ff' as const, value: 'ffz' },
      { slot: 'ts' as const, value: 'sub' },
    ];
    expect(applyViewerBadgeLayout(items, { order: ['7', 'ts'], hidden: ['ff'] })).toEqual(['other', '7tv', 'sub', 'role']);
    expect(applyViewerBadgeLayout(items, { order: [], hidden: ['ta'] })).toEqual(['other', '7tv', 'ffz', 'sub']);
  });
});

describe('a chatter with a Moltorino badge layout', () => {
  it('is drawn exactly as before without one', () => {
    expect(order(message())).toEqual(['moderator', 'subscriber', 'glhf', 'chatterino', 'moltorino', 'ffz', 'bttv', 'turteg']);
  });

  it('loses the kinds they hid (only those)', () => {
    expect(order(message({ order: [], hidden: ['ts', 'm', 'bt'] }))).toEqual(['moderator', 'glhf', 'chatterino', 'ffz', 'turteg']);
  });

  it('gets their own order', () => {
    expect(order(message({ order: ['m', 'ff', 'ts', 'ta'], hidden: [] }))).toEqual(
      ['turteg', 'moltorino', 'ffz', 'subscriber', 'moderator', 'glhf', 'chatterino', 'bttv'],
    );
  });

  it("still never shows what the streamer's layout hides", () => {
    expect(order(message({ order: ['ff', 'm'], hidden: [] }), '!ffz')).not.toContain('ffz');
    expect(order(message({ order: ['ff', 'm'], hidden: [] }), '!moltorino,!ffz')).not.toContain('moltorino');
  });

  it('only on Twitch (layouts are keyed by Twitch user id)', () => {
    const kick = message({ order: ['m'], hidden: ['ta'] }, 'kick');
    expect(order(kick)).toEqual(order({ ...kick, viewerBadgeLayout: undefined }));
  });
});

describe('Moltorino v2 layouts from the badge list', () => {
  /* The shape api.moltorino.com/v2/badges answered on 2026-11-22. */
  const body = {
    schemaVersion: 2,
    layout: { schemaVersion: 1, defaultOrder: ['ta', 'ts', 'tv', 'tp', 'c', 'ff', 'fa', 'bt', 'bl', 'jc', 'bh', 'm', '7', 'hc', 'hs'] },
    badges: [{ id: 'supporter', tooltip: 'Moltorino Supporter', priority: 100, images: { '3x': 'https://api.moltorino.com/badges/assets/supporter/3x.webp' } }],
    users: {
      '1001': { badges: ['supporter'], activeBadge: 'supporter', order: ['ta', 'hc', 'tv', 'tp', 'c', 'ff', 'fa', 'bt', 'bl', 'ts', 'jc', 'bh', '7', 'm', 'hs'] },
      '1002': { order: ['ta', '7', 'ts'], hidden: ['ta', 'ts'] },
      '1003': { badges: ['supporter'], activeBadge: 'supporter' },
      'not-an-id': { hidden: ['m'] },
    },
  };

  it('keeps the people who set an order or hid something', () => {
    const layouts = parseMoltorinoV2Layouts(body);
    expect([...layouts.keys()]).toEqual(['1001', '1002']);
    expect(layouts.get('1002')).toEqual({ order: ['ta', '7', 'ts'], hidden: ['ta', 'ts'] });
    expect(layouts.get('1001')!.order.slice(0, 3)).toEqual(['ta', 'hc', 'tv']);
  });

  describe('through the community badge lookup the Twitch connector uses', () => {
    afterEach(() => {
      __resetCommunityBadgeCache();
      vi.unstubAllGlobals();
    });

    it('knows a chatter\'s layout once the lists are loaded', async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://api.moltorino.com/v2/badges') return new Response(JSON.stringify(body), { status: 200 });
        return new Response('{}', { status: 404 });
      }));
      expect(moltorinoBadgeLayoutFor('1002')).toBeNull();
      await resolveTwitchCommunityBadges({ userId: '1002', login: 'someone' });
      expect(moltorinoBadgeLayoutFor('1002')).toEqual({ order: ['ta', '7', 'ts'], hidden: ['ta', 'ts'] });
      expect(moltorinoBadgeLayoutFor('1003')).toBeNull();
    });
  });
});

describe('the generator preview', () => {
  it('gives a roster member their Moltorino layout through the live cosmetics step', async () => {
    const { applyPreviewLiveCosmetics } = await import('@/features/multichat/previewLiveCosmetics');
    const { rosterTemplates } = await import('@/features/multichat/previewRoster');
    const response = {
      identity: { userId: '77', login: 'xslash58', displayName: 'Xslash58' },
      providers: {},
    } as never;
    const layout = { order: ['7', 'ts'], hidden: ['m'] };
    const catalog = new Map([['xslash58', response]]);
    const live = { sevenTV: new Map(), communityBadges: new Map(), viewerBadgeLayouts: new Map([['77', layout]]) };
    const applied = applyPreviewLiveCosmetics(catalog, live);
    expect(applied.get('xslash58')!.viewerBadgeLayout).toEqual(layout);
    const template = rosterTemplates(applied, 0).find((item) => item.senderUsername === 'xslash58')!;
    expect(template.viewerBadgeLayout).toEqual(layout);
    /* Nobody else gets one. */
    expect(rosterTemplates(applied, 0).filter((item) => item.viewerBadgeLayout)).toHaveLength(1);
  });
});
