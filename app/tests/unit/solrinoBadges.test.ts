import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { badgeHomepage } from '@/lib/badgeHomepages';
import { MULTICHAT_BADGE_PROVIDERS, badgeProviderFromType } from '@/lib/badgeLayout';
import { badgeListName } from '@/lib/badgesPage';
import { partsToHtml } from '@/lib/render/elementTree';
import { badgeParts } from '@/lib/renderCore';
import type { UnifiedMessage } from '@/lib/types';
import {
  SOLRINO_BADGES_URL,
  __resetCommunityBadgeCache,
  moltorinoBadgeLayoutFor,
  parseMoltorinoV2,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

const art = (id: string) => ({
  '1x': `https://solrino.solrino-badge-server.workers.dev/assets/badges/sizes/${id}/1x.webp`,
  '2x': `https://solrino.solrino-badge-server.workers.dev/assets/badges/sizes/${id}/2x.webp`,
  '3x': `https://solrino.solrino-badge-server.workers.dev/assets/badges/sizes/${id}/3x.webp`,
  '4x': `https://solrino.solrino-badge-server.workers.dev/assets/badges/sizes/${id}/4x.webp`,
});

/* The shape of Solrino's list (schema 2, the same as Moltorino's v2). */
const SOLRINO = {
  schemaVersion: 2,
  generation: 'solrino-530',
  bundleVersion: 530,
  layout: { schemaVersion: 1, defaultOrder: ['ta', 'ts', 'm', '7'] },
  badges: [
    { id: 'developer', tooltip: 'Solrino Developer', priority: 10, listed: false, assetVersion: 1, images: art('developer') },
    { id: 'founder', tooltip: 'Solrino Founder', priority: 20, listed: true, assetVersion: 1, images: art('founder') },
    { id: 'star', tooltip: 'Solrino Star', priority: 40, listed: true, assetVersion: 1, images: art('star') },
  ],
  users: {
    111: { badges: ['star', 'founder'], order: ['ta', 'm', 'ts'], hidden: [] },
    222: { badges: ['developer', 'star'], activeBadge: 'star' },
    333: { badges: ['founder'], hidden: ['m'] },
    444: { badges: [], hidden: ['ff'], order: ['ff', 'm'] },
  },
};

describe('Solrino badge list', () => {
  it('reads it like Moltorino v2, as Solrino badges', () => {
    const parsed = parseMoltorinoV2(SOLRINO, 'solrino');
    const owners = (id: string) => parsed.find((badge) => badge.id === id)?.userIds ?? [];
    expect(parsed.every((badge) => badge.provider === 'solrino')).toBe(true);
    /* No equipped badge: the best (lowest) priority. */
    expect(owners('founder')).toEqual(['111']);
    /* The equipped one wins over a better priority. */
    expect(owners('star')).toEqual(['222']);
    expect(owners('developer')).toEqual([]);
    expect(parsed.find((badge) => badge.id === 'founder')).toMatchObject({
      title: 'Solrino Founder',
      url: 'https://solrino.solrino-badge-server.workers.dev/assets/badges/sizes/founder/3x.webp',
    });
  });

  it('hides the Solrino badge for someone who hid its slot', () => {
    const everyone = parseMoltorinoV2(SOLRINO, 'solrino').flatMap((badge) => badge.userIds);
    expect(everyone).not.toContain('333');
    expect(everyone).not.toContain('444');
  });

  it('still reads Moltorino’s own list as Moltorino', () => {
    expect(parseMoltorinoV2(SOLRINO).every((badge) => badge.provider === 'moltorino')).toBe(true);
    expect(parseMoltorinoV2(null, 'solrino')).toEqual([]);
    expect(parseMoltorinoV2({ badges: 'x', users: [] }, 'solrino')).toEqual([]);
  });
});

describe('Solrino badges in chat', () => {
  beforeEach(() => {
    __resetCommunityBadgeCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serve(overrides: Record<string, () => Response> = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (overrides[url]) return overrides[url]();
      if (url === SOLRINO_BADGES_URL) return jsonResponse(SOLRINO);
      if (url === 'https://api.moltorino.com/v2/badges') {
        return jsonResponse({
          badges: [{ id: 'supporter', tooltip: 'Moltorino Supporter', images: { '3x': 'https://cdn.moltorino.example/s.webp' } }],
          users: { 111: { badges: ['supporter'], order: ['7', 'm'] } },
        });
      }
      return jsonResponse({}, false);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('fetches Solrino’s public list and shows the chatter’s badge with its name', async () => {
    const fetchMock = serve();
    const badges = await resolveTwitchCommunityBadges({ userId: '222', login: 'someone' });
    expect(fetchMock).toHaveBeenCalledWith(SOLRINO_BADGES_URL, expect.anything());
    expect(badges).toEqual([{
      type: 'community:solrino:star',
      title: 'Solrino Star',
      url: 'https://solrino.solrino-badge-server.workers.dev/assets/badges/sizes/star/3x.webp',
    }]);
  });

  it('shows a Moltorino and a Solrino badge side by side', async () => {
    serve();
    const badges = await resolveTwitchCommunityBadges({ userId: '111', login: 'both' });
    expect(badges.map((badge) => badge.type)).toEqual(expect.arrayContaining([
      'community:moltorino:supporter',
      'community:solrino:founder',
    ]));
  });

  it('uses only Moltorino’s list for badge layouts', async () => {
    serve();
    await resolveTwitchCommunityBadges({ userId: '111', login: 'both' });
    /* 444's layout exists only in Solrino's list. */
    expect(moltorinoBadgeLayoutFor('444')).toBeNull();
    expect(moltorinoBadgeLayoutFor('111')).not.toBeNull();
  });

  it('keeps every other badge when Solrino’s list is down', async () => {
    serve({ [SOLRINO_BADGES_URL]: () => { throw new TypeError('network'); } });
    const badges = await resolveTwitchCommunityBadges({ userId: '111', login: 'both' });
    expect(badges.map((badge) => badge.type)).toEqual(['community:moltorino:supporter']);
  });
});

describe('Solrino around the site', () => {
  it('names the badge on hover, links Solrino’s site and has its own place in the badge order', () => {
    const message: UnifiedMessage = {
      platform: 'twitch', id: 'm', senderId: '1', username: 'x', color: '#fff', text: 'hi', emotes: [], timestamp: 1, kind: 'chat',
      badges: [{ type: 'community:solrino:founder', title: 'Solrino Founder', url: 'https://solrino.solrino-badge-server.workers.dev/a.webp' }],
    };
    const html = partsToHtml(badgeParts(message, []));
    expect(html).toContain('title="Solrino Founder"');
    expect(badgeHomepage({ type: 'community:solrino:founder' }, 'twitch')).toBe('https://solrino.solrino-badge-server.workers.dev');
    expect(badgeProviderFromType('community:solrino:founder')).toBe('solrino');
    expect(MULTICHAT_BADGE_PROVIDERS.indexOf('solrino')).toBe(MULTICHAT_BADGE_PROVIDERS.indexOf('bluzyrino') + 1);
    expect(badgeListName('solrino-badges.solrino-badge-server.workers.dev/v2/badges')).toBe('Solrino');
  });
});
