import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCommunityBadgeCache,
  parseEnhancerUserLookup,
  resolveTwitchCommunityBadges,
  resolveTwitchCommunityBadgesWithoutJilChat,
} from '@/lib/communityBadges';
import { createPerUserLookupGuard, retryAfterMs } from '@/lib/perUserLookupGuard';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const AGGREGATE = [
  { id: 'patron', title: 'Patron', url: 'https://cdn.enhancer.at/badge/patron/72.webp', users: ['123'] },
];
const PERSONAL = [
  { id: 'sub-1m', title: '1 month supporter', url: 'https://cdn.enhancer.at/badge/sub-1m/72.webp' },
  { id: 'patron', title: 'Patron', url: 'https://cdn.enhancer.at/badge/patron/72.webp' },
];

const enhancerTypes = (badges: { type: string }[]) =>
  badges.filter((badge) => badge.type.startsWith('community:enhancer:')).map((badge) => badge.type);

beforeEach(() => {
  __resetCommunityBadgeCache();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('overlay Enhancer: per-user equipped badge', () => {
  it('parses only Enhancer CDN badges and keeps the one shown first', () => {
    expect(parseEnhancerUserLookup(PERSONAL, '123').map((badge) => badge.id)).toEqual(['sub-1m']);
    expect(parseEnhancerUserLookup([{ id: 'x', url: 'https://evil.example/x.png' }], '123')).toEqual([]);
    expect(parseEnhancerUserLookup({}, '123')).toEqual([]);
  });

  it('live chat shows the per-user badge instead of the aggregate list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/twitch/enhancer-badges') return json(AGGREGATE);
      if (url === '/api/twitch/enhancer-user-badges?userId=123') return json(PERSONAL);
      return json({}, 404);
    }));
    const identity = { userId: '123', login: 'target' };
    await resolveTwitchCommunityBadges(identity);
    /* First message may beat the 250 ms live wait; once answered it's cached. */
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enhancerTypes(await resolveTwitchCommunityBadges(identity))).toEqual(['community:enhancer:sub-1m']);
  });

  it('an authoritative "no badge" answer removes the aggregate badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/twitch/enhancer-badges') return json(AGGREGATE);
      if (url.startsWith('/api/twitch/enhancer-user-badges')) return json([]);
      return json({}, 404);
    }));
    const identity = { userId: '123', login: 'target' };
    await resolveTwitchCommunityBadges(identity);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enhancerTypes(await resolveTwitchCommunityBadges(identity))).toEqual([]);
  });

  it('falls back to the aggregate list when the per-user lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/twitch/enhancer-badges') return json(AGGREGATE);
      if (url.startsWith('/api/twitch/enhancer-user-badges')) return json({ error: 'x' }, 502);
      return json({}, 404);
    }));
    const identity = { userId: '123', login: 'target' };
    await resolveTwitchCommunityBadges(identity);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enhancerTypes(await resolveTwitchCommunityBadges(identity))).toEqual(['community:enhancer:patron']);
  });

  it('Preview path never makes the per-user Enhancer call', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/twitch/enhancer-badges' ? json(AGGREGATE) : json({}, 404));
    vi.stubGlobal('fetch', fetchMock);
    await resolveTwitchCommunityBadgesWithoutJilChat({ userId: '123', login: 'target' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/twitch/enhancer-user-badges'))).toBe(false);
  });
});

describe('overlay: last-known-good provider badges', () => {
  it('keeps a provider\'s badges when a later refresh fails (e.g. slow FFZ)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let chatterinoUp = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://api.chatterino.com/badges') {
        if (!chatterinoUp) throw new Error('timeout');
        return json({ badges: [{ tooltip: 'Chatterino Supporter', image3: 'https://cdn.example/c.png', users: ['123'] }] });
      }
      return json({}, 404);
    }));
    const identity = { userId: '123', login: 'target' };
    const chatterino = (badges: { type: string }[]) => badges.some((badge) => badge.type.startsWith('community:chatterino:'));
    expect(chatterino(await resolveTwitchCommunityBadgesWithoutJilChat(identity))).toBe(true);

    chatterinoUp = false;
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(chatterino(await resolveTwitchCommunityBadgesWithoutJilChat(identity))).toBe(true);
  });

  it('a provider that never loaded still shows nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const badges = await resolveTwitchCommunityBadgesWithoutJilChat({ userId: '123', login: 'target' });
    expect(badges.filter((badge) => badge.type.startsWith('community:chatterino:'))).toEqual([]);
  });
});

describe('per-user lookup guard', () => {
  const options = {
    burst: 2, maxConcurrent: 1, maxQueue: 2, refillMs: 1_000, liveWaitMs: 250,
    cacheTtlMs: 60_000, failureTtlMs: 30_000, throttledTtlMs: 10_000, maxKeys: 3,
  };

  it('caches answers and spends no budget on repeat lookups', async () => {
    const request = vi.fn(async (userId: string) => `badge:${userId}`);
    const guard = createPerUserLookupGuard({ ...options, request });
    expect(await guard.lookup('1', true)).toEqual({ value: 'badge:1' });
    expect(await guard.lookup('1', true)).toEqual({ value: 'badge:1' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('skips users once the queue is full instead of piling up requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const request = vi.fn(async (userId: string) => { await gate; return userId; });
    const guard = createPerUserLookupGuard({ ...options, request });
    const pending = ['1', '2', '3'].map((id) => guard.lookup(id, true));
    expect(await guard.lookup('4')).toBeNull();
    release();
    await Promise.all(pending);
    expect(request.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('pauses everything on 429 and resolves queued users as skipped', async () => {
    const request = vi.fn(async (_userId: string, onRateLimit: (retryAfter: string | null) => void) => {
      onRateLimit('30');
      throw new Error('429');
    });
    const guard = createPerUserLookupGuard({ ...options, request });
    expect(await guard.lookup('1', true)).toBeNull();
    expect(await guard.lookup('2', true)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('answers the live path within the wait budget even when a lookup is slow', async () => {
    vi.useFakeTimers();
    const guard = createPerUserLookupGuard({ ...options, request: () => new Promise<string>(() => {}) });
    const live = guard.lookup('1');
    await vi.advanceTimersByTimeAsync(300);
    expect(await live).toBeNull();
  });

  it('bounds Retry-After to 1–120 seconds', () => {
    expect(retryAfterMs('0')).toBe(1_000);
    expect(retryAfterMs('9999')).toBe(120_000);
    expect(retryAfterMs(null)).toBe(60_000);
  });
});
