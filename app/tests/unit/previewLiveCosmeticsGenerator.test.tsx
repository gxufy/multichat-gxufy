import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import liveStyles from '../fixtures/sevenTVV4LiveStyles.json';
import { SEVENTV_V4_GQL, SEVENTV_V4_MAX_USERS_PER_QUERY } from '@/lib/cosmetics';
import { PREVIEW_LIVE_COSMETICS_DELAY_MS } from '@/features/multichat/previewLiveCosmetics';
import { PREVIEW_CATALOG_RESPONSES } from '@/features/multichat/previewCatalog';
import { PREVIEW_ROSTER } from '@/features/multichat/previewRoster';
import { __resetPreviewIdentityClient } from '@/features/multichat/previewIdentityClient';
import { __resetCommunityBadgeCache } from '@/lib/communityBadges';

vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const users = liveStyles.users as Record<string, unknown>;
const preview = () => document.querySelector<HTMLIFrameElement>('iframe[title="FlossChat sample preview"]')!.contentDocument!.body;

function sevenTVAnswer(init?: RequestInit): Response {
  const query = String(JSON.parse(String(init?.body)).query);
  /* Real 7TV: more than 9 users in one query is "Query is too complex." */
  if ((query.match(/userByConnection/g) ?? []).length > 9) {
    return new Response(JSON.stringify({ data: null, errors: [{ message: 'Query is too complex.' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const byAlias: Record<string, unknown> = {};
  for (const match of query.matchAll(/(u\d+): userByConnection\(platform: TWITCH, platformId: "(\d+)"\)/g)) {
    byAlias[match[1]!] = match[2]! in users ? { style: users[match[2]!] } : { style: { activePaint: null, activeBadge: null } };
  }
  return new Response(JSON.stringify({ data: { users: byAlias } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  __resetPreviewIdentityClient();
  __resetCommunityBadgeCache();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === SEVENTV_V4_GQL) return sevenTVAnswer(init);
    if (String(input) === '/api/twitch/badges') {
      return new Response(JSON.stringify({
        'turbo/1': 'https://static-cdn.jtvnw.net/badges/v1/turbo-test/2',
        'premium/1': 'https://static-cdn.jtvnw.net/badges/v1/prime-test/2',
        'seeks-eye/1': 'https://static-cdn.jtvnw.net/badges/v1/seeks-eye-test/2',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(input) === '/api/twitch/enhancer-user-badges?userId=204219574') {
      return new Response(JSON.stringify([
        { id: '4485e06e-9289-4e83-9425-d43245615643', title: '1 month supporter', url: 'https://cdn.enhancer.at/badge/ecd54b-test/72.webp' },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(input).startsWith('https://api.ivr.fi/v2/twitch/user?id=')) {
      /* Real answer captured 2026-11-14: gxufy now wears Prime Gaming. */
      return new Response(JSON.stringify([
        { id: '204219574', login: 'gxufy', badges: [{ setID: 'premium', version: '1', title: 'Prime Gaming' }] },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sevenTVCalls = () => fetchMock.mock.calls.filter(([input]) => String(input) === SEVENTV_V4_GQL);

async function flushLive() {
  await act(async () => {
    vi.advanceTimersByTime(PREVIEW_LIVE_COSMETICS_DELAY_MS + 10);
  });
  for (let i = 0; i < 20; i += 1) {
    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(50); });
  }
}

describe('Preview Data live cosmetics', () => {
  it('first paints from the catalog with no cosmetics requests', () => {
    render(<ClassicGenerator />);
    expect(sevenTVCalls()).toHaveLength(0);
    expect(preview().querySelectorAll('#chat_container .ck-body')).toHaveLength(PREVIEW_ROSTER.length);
  });

  it('refreshes every roster identity in 7TV-sized batches without preview-identity calls', async () => {
    render(<ClassicGenerator />);
    await flushLive();

    expect(sevenTVCalls()).toHaveLength(Math.ceil(PREVIEW_CATALOG_RESPONSES.size / SEVENTV_V4_MAX_USERS_PER_QUERY));
    const queries = sevenTVCalls().map(([, init]) => String(JSON.parse(String(init?.body)).query));
    for (const query of queries) {
      expect(query.match(/userByConnection/g)!.length).toBeLessThanOrEqual(SEVENTV_V4_MAX_USERS_PER_QUERY);
    }
    for (const response of PREVIEW_CATALOG_RESPONSES.values()) {
      expect(queries.join(' ')).toContain(`platformId: "${response.identity.userId}"`);
    }
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.startsWith('/api/twitch/preview-identity'))).toBe(false);
    /* JilChat is looked up per roster identity, never more than once each. */
    expect(urls.filter((url) => url.includes('jilchat')).length).toBeLessThanOrEqual(PREVIEW_CATALOG_RESPONSES.size);
  });

  it('replaces a stale catalog paint and removes an unequipped 7TV badge', async () => {
    /* Real drift captured 2026-11-14: tuk7 switched paints; slaiqe unequipped their 7TV badge. */
    const tuk7 = PREVIEW_CATALOG_RESPONSES.get('tuk7')!.providers['7TV']!.resources;
    expect(tuk7.paint?.id).toBe('01JFQV4G27ND0S36CW9GKQ1B61');
    const slaiqeBadge = PREVIEW_CATALOG_RESPONSES.get('slaiqe')!.providers['7TV']!.resources.badge!.id;
    expect(slaiqeBadge).toBe('01KV1CC9N5R1RG1TGHK0T42WZN');
    users['853292686'] = { activePaint: null, activeBadge: null };

    render(<ClassicGenerator />);
    const tuk7Name = () => Array.from(preview().querySelectorAll('.ck-name-paint'))
      .filter((el) => /tuk7/i.test(el.textContent ?? ''))
      .map((el) => el.outerHTML).join('');
    const hasSlaiqeBadge = () => preview().innerHTML.includes(slaiqeBadge);

    expect(tuk7Name()).not.toMatch(/2,\s*201,\s*248/);
    expect(hasSlaiqeBadge()).toBe(true);

    await flushLive();

    /* Live linear gradient #02C9F8 -> #1C64F2 is now what renders. */
    expect(tuk7Name()).toMatch(/2,\s*201,\s*248/);
    expect(hasSlaiqeBadge()).toBe(false);
    expect(document.querySelector('.preview-roster-status')?.textContent).toMatch(/cosmetics/i);
    delete users['853292686'];
  });

  it("renders each identity's real Twitch badge once badge art is available", async () => {
    const marcTwitch = PREVIEW_CATALOG_RESPONSES.get('marc')!.providers.Twitch!.resources.ownedBadges;
    expect(marcTwitch).toEqual([expect.objectContaining({ type: 'turbo', version: '1' })]);
    render(<ClassicGenerator />);
    expect(preview().innerHTML).not.toContain('turbo-test');
    await flushLive();
    expect(preview().innerHTML).toContain('https://static-cdn.jtvnw.net/badges/v1/turbo-test/2');
  });

  it('shows the Twitch badge an identity wears now, not the snapshot one', async () => {
    const gxufyTwitch = PREVIEW_CATALOG_RESPONSES.get('gxufy')!.providers.Twitch!.resources.ownedBadges;
    expect(gxufyTwitch).toEqual([expect.objectContaining({ type: 'seeks-eye' })]);
    render(<ClassicGenerator />);
    await flushLive();
    const html = preview().innerHTML;
    expect(html).toContain('https://static-cdn.jtvnw.net/badges/v1/prime-test/2');
    expect(html).not.toContain('seeks-eye-test');
  });

  it('adds the Enhancer badge a user shows once per-user lookups arrive', async () => {
    render(<ClassicGenerator />);
    await flushLive();
    expect(preview().innerHTML).toContain('https://cdn.enhancer.at/badge/ecd54b-test/72.webp');
  });
});
