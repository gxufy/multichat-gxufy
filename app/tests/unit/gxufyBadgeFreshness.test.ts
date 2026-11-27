/* A purchase or a wear/take-off on /badges reaches live overlays within one
 * GXUFY_VERSION_POLL_MS, not after the 5-minute list cache. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GXUFY_VERSION_POLL_MS,
  __resetCommunityBadgeCache,
  resolveTwitchCommunityBadges,
} from '@/lib/communityBadges';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OWNER = { userId: '204219574', login: 'gxufy', displayName: 'Gxufy' };
const hasFlossChat = (badges: Awaited<ReturnType<typeof resolveTwitchCommunityBadges>>) => (
  badges.some((badge) => badge.type.includes('gxufy'))
);

let version = 'v1';
let live = true;
let versionCalls = 0;
let wearing = true;
const listUrls: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  __resetCommunityBadgeCache();
  version = 'v1';
  live = true;
  versionCalls = 0;
  wearing = true;
  listUrls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/twitch/gxufy-badges-version') {
      versionCalls += 1;
      return json({ v: version, live });
    }
    if (url.startsWith('/api/twitch/gxufy-badges')) {
      listUrls.push(url);
      return json([{ id: 'supporter', title: 'FlossChat', url: '/badges/gxufy/supporter-hand.webp', userIds: wearing ? [OWNER.userId] : [] }]);
    }
    return json({}, 404);
  }));
});

afterEach(() => {
  __resetCommunityBadgeCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FlossChat badge freshness in live overlays', () => {
  it('picks up a taken-off badge on the next version check, with a cache-busting URL', async () => {
    expect(hasFlossChat(await resolveTwitchCommunityBadges(OWNER))).toBe(true);

    wearing = false;
    version = 'v2';
    await vi.advanceTimersByTimeAsync(GXUFY_VERSION_POLL_MS);
    await vi.waitFor(() => expect(listUrls.at(-1)).toBe('/api/twitch/gxufy-badges?v=v2'));
    expect(hasFlossChat(await resolveTwitchCommunityBadges(OWNER))).toBe(false);
  });

  it('does not reload the list while the version is unchanged', async () => {
    await resolveTwitchCommunityBadges(OWNER);
    const before = listUrls.length;
    await vi.advanceTimersByTimeAsync(GXUFY_VERSION_POLL_MS * 3);
    await resolveTwitchCommunityBadges(OWNER);
    expect(listUrls.length).toBe(before);
  });

  it('ignores a malformed version answer', async () => {
    await resolveTwitchCommunityBadges(OWNER);
    version = '<script>' as string;
    const before = listUrls.length;
    await vi.advanceTimersByTimeAsync(GXUFY_VERSION_POLL_MS);
    expect(listUrls.length).toBe(before);
  });

  it('stops checking when the server has no supporter store (support switched off)', async () => {
    live = false;
    await resolveTwitchCommunityBadges(OWNER);
    await vi.waitFor(() => expect(versionCalls).toBe(1));
    await vi.advanceTimersByTimeAsync(GXUFY_VERSION_POLL_MS * 4);
    await resolveTwitchCommunityBadges(OWNER);
    expect(versionCalls).toBe(1);
  });
});
