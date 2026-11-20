import { describe, expect, it, vi } from 'vitest';
import liveStyles from '../fixtures/sevenTVV4LiveStyles.json';
import { SEVENTV_V4_GQL } from '@/lib/cosmetics';
import {
  EMPTY_SEVENTV_IDENTITY_RESOURCES,
  type PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';
import {
  PREVIEW_LIVE_SEVENTV_BATCH_SIZE,
  applyPreviewLiveCosmetics,
  fetchPreviewCommunityBadges,
  fetchPreviewSevenTVStyles,
  fetchPreviewTwitchBadgeArt,
  fetchPreviewTwitchWornBadges,
  loadPreviewLiveCosmetics,
  type PreviewLiveCosmetics,
} from '@/features/multichat/previewLiveCosmetics';

const users = liveStyles.users as Record<string, unknown>;

function gqlResponse(byAlias: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ data: { users: byAlias } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Answers each aliased userByConnection with the captured live style. */
function liveFetch(table: Record<string, unknown> = users) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const query = String(JSON.parse(String(init?.body)).query);
    const byAlias: Record<string, unknown> = {};
    for (const match of query.matchAll(/(u\d+): userByConnection\(platform: TWITCH, platformId: "(\d+)"\)/g)) {
      const id = match[2]!;
      byAlias[match[1]!] = id in table
        ? (table[id] === null ? null : { style: table[id] })
        : null;
    }
    return gqlResponse(byAlias);
  });
}

function response(
  login: string,
  userId: string,
  sevenTV: Partial<typeof EMPTY_SEVENTV_IDENTITY_RESOURCES> = {},
  communityBadges?: PreviewIdentityResponse['communityBadges'],
): PreviewIdentityResponse {
  return {
    identity: { userId, login, displayName: login },
    providers: {
      '7TV': { status: 'loaded', resources: { ...EMPTY_SEVENTV_IDENTITY_RESOURCES, ...sevenTV } },
    },
    ...(communityBadges ? { communityBadges } : {}),
  };
}

const NO_LIVE: PreviewLiveCosmetics = { sevenTV: new Map(), communityBadges: new Map() };

describe('fetchPreviewSevenTVStyles', () => {
  it('reads real radial, linear, and animated-image paints plus badges in one v4 batch', async () => {
    const fetchImpl = liveFetch();
    const styles = await fetchPreviewSevenTVStyles(['204219574', '740648504', '44710465'], { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(SEVENTV_V4_GQL);
    expect(fetchImpl.mock.calls[0]![1]?.method).toBe('POST');

    expect(styles.get('204219574')?.paint).toMatchObject({ id: '01K19W45ZA3XFW7YP83BVQRBYR', func: 'RADIAL_GRADIENT' });
    expect(styles.get('204219574')?.badge).toMatchObject({ id: '01M3Q4RTMNFHTT58VNTFH8152G' });
    expect(styles.get('740648504')?.paint).toMatchObject({ id: '01H1VNXAV80007H191NVCWCJQF', func: 'LINEAR_GRADIENT', angle: 270 });
    expect(styles.get('44710465')?.paint).toMatchObject({ id: '01GEB9RZNG0006MCY6R6BPTMGH', func: 'URL' });
    expect(styles.get('44710465')?.paint?.image_url).toMatch(/^https:\/\/cdn\.7tv\.app\/paint\//);
  });

  it('distinguishes "nothing equipped" (null) from "unparseable" (unknown)', async () => {
    const fetchImpl = liveFetch({
      '1': { activePaint: null, activeBadge: null },
      '2': { activePaint: { id: 'bad', data: { layers: [] } }, activeBadge: null },
      '3': null,
    });
    const styles = await fetchPreviewSevenTVStyles(['1', '2', '3'], { fetchImpl });
    expect(styles.get('1')).toEqual({ paint: null, badge: null });
    expect(styles.get('2')).toEqual({ paint: undefined, badge: null });
    expect(styles.get('3')).toEqual({ paint: null, badge: null });
  });

  it('drops invalid IDs, de-duplicates, and batches at the 7TV complexity ceiling', async () => {
    const fetchImpl = liveFetch({});
    const ids = Array.from({ length: PREVIEW_LIVE_SEVENTV_BATCH_SIZE + 5 }, (_, i) => String(1000 + i));
    await fetchPreviewSevenTVStyles([...ids, ids[0]!, 'not-an-id', '12;evil', ''], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const queries = fetchImpl.mock.calls.map(([, init]) => String(JSON.parse(String(init?.body)).query));
    expect(queries.join(' ')).not.toMatch(/evil|not-an-id/);
    expect(queries[0]!.match(/userByConnection/g)).toHaveLength(PREVIEW_LIVE_SEVENTV_BATCH_SIZE);
    expect(queries[1]!.match(/userByConnection/g)).toHaveLength(5);
  });

  it('returns nothing (and does not throw) when 7TV fails', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(fetchPreviewSevenTVStyles(['1'], { fetchImpl: failing })).resolves.toEqual(new Map());
    const throwing = vi.fn(async () => { throw new TypeError('network'); });
    await expect(fetchPreviewSevenTVStyles(['1'], { fetchImpl: throwing })).resolves.toEqual(new Map());
  });

  it('makes no request once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = liveFetch();
    await fetchPreviewSevenTVStyles(['204219574'], { fetchImpl, signal: controller.signal });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('applyPreviewLiveCosmetics', () => {
  const oldPaint = { id: 'old-paint', func: 'LINEAR_GRADIENT' as const, angle: 0, repeat: false, stops: [], shadows: [] };
  const oldBadge = { id: 'old-badge', image: 'https://cdn.7tv.app/badge/old-badge/3x.webp' };
  const newBadge = { id: 'new-badge', image: 'https://cdn.7tv.app/badge/new-badge/3x.webp' };

  it('replaces equipped cosmetics by immutable user ID without leaking to other identities', () => {
    const catalog = new Map([
      ['alice', response('alice', '1', { paint: oldPaint, badge: oldBadge })],
      ['bob', response('bob', '2', { paint: oldPaint, badge: oldBadge })],
    ]);
    const next = applyPreviewLiveCosmetics(catalog, {
      ...NO_LIVE,
      sevenTV: new Map([['1', { paint: null, badge: newBadge }]]),
    });
    expect(next.get('alice')!.providers['7TV']!.resources).toMatchObject({ paint: null, badge: newBadge });
    expect(next.get('bob')).toBe(catalog.get('bob'));
  });

  it('keeps catalog values for unknown fields and returns the same map when nothing changes', () => {
    const catalog = new Map([['alice', response('alice', '1', { paint: oldPaint, badge: oldBadge })]]);
    expect(applyPreviewLiveCosmetics(catalog, NO_LIVE)).toBe(catalog);
    const next = applyPreviewLiveCosmetics(catalog, {
      ...NO_LIVE,
      sevenTV: new Map([['1', { paint: undefined, badge: newBadge }]]),
    });
    expect(next.get('alice')!.providers['7TV']!.resources.paint).toBe(oldPaint);
    expect(next.get('alice')!.providers['7TV']!.resources.badge).toBe(newBadge);
  });

  it('attaches Twitch badge art to the Twitch badge each identity wears', () => {
    const catalog = new Map([['marc', {
      ...response('marc', '44710465'),
      providers: {
        ...response('marc', '44710465').providers,
        Twitch: { status: 'loaded' as const, resources: { globalBadges: {}, channelBadges: {}, ownedBadges: [{ type: 'turbo', version: '1' }, { type: 'unknown-set', version: '1' }] } },
      },
    }]]);
    const next = applyPreviewLiveCosmetics(catalog, {
      ...NO_LIVE,
      twitchBadgeArt: { 'turbo/1': 'https://static-cdn.jtvnw.net/badges/v1/turbo/2' },
    });
    expect(next.get('marc')!.providers.Twitch!.resources.ownedBadges).toEqual([
      { type: 'turbo', version: '1', url: 'https://static-cdn.jtvnw.net/badges/v1/turbo/2' },
      { type: 'unknown-set', version: '1' },
    ]);
  });

  it('uses live community badges but keeps the catalog JilChat badge the roster refresh does not query', () => {
    const jil = { type: 'community:jilchat:founder-beta', url: 'https://example.com/jil.webp' };
    const stale = { type: 'community:bchat:supporters', url: 'https://example.com/old.webp' };
    const fresh = { type: 'community:gxufy:supporter', url: '/badges/gxufy/supporter-hand.webp' };
    const catalog = new Map([['alice', response('alice', '1', {}, [stale, jil])]]);
    const next = applyPreviewLiveCosmetics(catalog, {
      ...NO_LIVE,
      communityBadges: new Map([['1', [fresh]]]),
    });
    expect(next.get('alice')!.communityBadges).toEqual([fresh, jil]);
  });
});

describe('fetchPreviewCommunityBadges / loadPreviewLiveCosmetics', () => {
  it('records only non-empty results so failures keep catalog badges', async () => {
    const badge = { type: 'community:gxufy:supporter', url: '/badges/gxufy/supporter-hand.webp' };
    const resolve = vi.fn(async ({ userId }: { userId: string }) => {
      if (userId === '1') return [badge];
      if (userId === '2') return [];
      throw new Error('provider down');
    });
    const result = await fetchPreviewCommunityBadges([
      { userId: '1', login: 'a', displayName: 'a' },
      { userId: '2', login: 'b', displayName: 'b' },
      { userId: '3', login: 'c', displayName: 'c' },
      { userId: '1', login: 'a', displayName: 'a' },
    ], resolve);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect([...result.entries()]).toEqual([['1', [badge]]]);
  });

  it('reports a failed source without blocking the other one', async () => {
    const catalog = new Map([['gxufy', response('gxufy', '204219574')]]);
    const { live, failedSources } = await loadPreviewLiveCosmetics(catalog, {
      fetchImpl: liveFetch(),
      resolveCommunity: async () => { throw new Error('down'); },
    });
    /* Community resolver down; no Twitch badge art or IVR in this test: 3 of 4. */
    expect(failedSources).toBe(3);
    expect(live.sevenTV.get('204219574')?.paint?.id).toBe('01K19W45ZA3XFW7YP83BVQRBYR');
  });
});

describe('fetchPreviewTwitchBadgeArt', () => {
  it('accepts only the safe https badge map and degrades to empty', async () => {
    const ok = vi.fn(async (_input?: RequestInfo | URL) => new Response(JSON.stringify({ 'turbo/1': 'https://static-cdn.jtvnw.net/badges/v1/x/2' }), { status: 200 }));
    await expect(fetchPreviewTwitchBadgeArt({ fetchImpl: ok })).resolves.toEqual({ 'turbo/1': 'https://static-cdn.jtvnw.net/badges/v1/x/2' });
    expect(String(ok.mock.calls[0]![0])).toBe('/api/twitch/badges');
    const unsafe = vi.fn(async () => new Response(JSON.stringify({ 'turbo/1': 'javascript:alert(1)' }), { status: 200 }));
    await expect(fetchPreviewTwitchBadgeArt({ fetchImpl: unsafe })).resolves.toEqual({});
    const down = vi.fn(async () => new Response('x', { status: 502 }));
    await expect(fetchPreviewTwitchBadgeArt({ fetchImpl: down })).resolves.toEqual({});
  });
});

describe('live worn Twitch badge (IVR)', () => {
  const twitchResponse = (login: string, userId: string, owned: { type: string; version: string }[]): PreviewIdentityResponse => ({
    ...response(login, userId),
    providers: {
      ...response(login, userId).providers,
      Twitch: { status: 'loaded', resources: { globalBadges: {}, channelBadges: {}, ownedBadges: owned } },
    },
  });

  it('fetches every identity in one batched request by user ID and parses worn badges', async () => {
    const fetchImpl = vi.fn(async (_input?: RequestInfo | URL) => new Response(JSON.stringify([
      { id: '204219574', login: 'gxufy', badges: [{ setID: 'premium', version: '1', title: 'Prime Gaming' }] },
      { id: '36194025', login: 'tduva', badges: [] },
      { id: '999', login: 'stranger', badges: [{ setID: 'staff', version: '1' }] },
      { id: '44710465', login: 'marc', badges: [{ setID: '../evil', version: '1' }, { setID: 'turbo', version: '1' }] },
    ]), { status: 200 }));
    const worn = await fetchPreviewTwitchWornBadges(['204219574', '36194025', '44710465', 'bad'], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.ivr.fi/v2/twitch/user?id=204219574,36194025,44710465');
    expect(worn.get('204219574')).toEqual([{ type: 'premium', version: '1', title: 'Prime Gaming' }]);
    expect(worn.get('36194025')).toEqual([]);
    expect(worn.get('44710465')).toEqual([{ type: 'turbo', version: '1' }]);
    expect(worn.has('999')).toBe(false);
  });

  it('degrades to an empty map when IVR fails', async () => {
    const down = vi.fn(async () => new Response('x', { status: 503 }));
    await expect(fetchPreviewTwitchWornBadges(['1'], { fetchImpl: down })).resolves.toEqual(new Map());
  });

  it('replaces a stale catalog Twitch badge with the one worn now, then attaches art', () => {
    const catalog = new Map([
      ['gxufy', twitchResponse('gxufy', '204219574', [{ type: 'seeks-eye', version: '1' }])],
      ['tduva', twitchResponse('tduva', '36194025', [{ type: 'partner', version: '1' }])],
      ['marc', twitchResponse('marc', '44710465', [{ type: 'turbo', version: '1' }])],
    ]);
    const next = applyPreviewLiveCosmetics(catalog, {
      ...NO_LIVE,
      twitchWornBadges: new Map([
        ['204219574', [{ type: 'premium', version: '1', title: 'Prime Gaming' }]],
        ['36194025', []],
      ]),
      twitchBadgeArt: { 'premium/1': 'https://static-cdn.jtvnw.net/badges/v1/prime/2' },
    });
    expect(next.get('gxufy')!.providers.Twitch!.resources.ownedBadges).toEqual([
      { type: 'premium', version: '1', title: 'Prime Gaming', url: 'https://static-cdn.jtvnw.net/badges/v1/prime/2' },
    ]);
    /* Empty = wears none now; missing = unknown, keep catalog. */
    expect(next.get('tduva')!.providers.Twitch!.resources.ownedBadges).toEqual([]);
    expect(next.get('marc')!.providers.Twitch!.resources.ownedBadges).toEqual([{ type: 'turbo', version: '1' }]);
  });
});
