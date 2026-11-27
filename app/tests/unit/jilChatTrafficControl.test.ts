import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCommunityBadgeCache,
  JILCHAT_CLIENT_BURST,
  JILCHAT_DIRECTORY_CLIENT_RETRY_MS,
  JILCHAT_DIRECTORY_CLIENT_TTL_MS,
  JILCHAT_CLIENT_MAX_QUEUE,
  JILCHAT_CLIENT_REFILL_MS,
  resolveTwitchCommunityBadges,
  resolveTwitchJilChatBadges,
} from '@/lib/communityBadges';

/* These tests cover the per-chatter fallback behind the guard: the whole
   JilChat list (no userId) is unavailable in them unless a test serves it. */
const isList = (input: RequestInfo | URL) => String(input) === '/api/twitch/jilchat-badges';
const perUserCalls = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.filter(([input]) => !isList(input as RequestInfo)).length;

function response(body: unknown, status = 200, retryAfter?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
    },
  });
}

beforeEach(() => {
  __resetCommunityBadgeCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-07T13:00:00.000Z'));
});

afterEach(() => {
  __resetCommunityBadgeCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('JilChat client admission under live-chat traffic', () => {
  it('bounds queued unique users and paces requests despite a large chat burst', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith('/api/twitch/jilchat-badges?userId=')) {
        throw new Error('Unexpected request');
      }
      calls.push(url);
      return response([]);
    }));

    const unique = JILCHAT_CLIENT_BURST + JILCHAT_CLIENT_MAX_QUEUE + 20;
    const work = Promise.all(
      Array.from({ length: unique }, (_, i) => resolveTwitchJilChatBadges(String(10000 + i))),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.length).toBeLessThanOrEqual(JILCHAT_CLIENT_BURST);

    await vi.advanceTimersByTimeAsync((unique + 2) * JILCHAT_CLIENT_REFILL_MS);
    await work;
    expect(calls.length).toBeLessThan(unique);
    expect(calls.length).toBeLessThanOrEqual(JILCHAT_CLIENT_BURST + JILCHAT_CLIENT_MAX_QUEUE);
  });

  it('honors Retry-After across different users, then resumes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (isList(input)) return response({}, 503);
      if (String(input).endsWith('userId=111')) return response({}, 429, '7');
      return response([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    await resolveTwitchJilChatBadges('111');
    expect(perUserCalls(fetchMock)).toBe(1);

    await resolveTwitchJilChatBadges('222');
    expect(perUserCalls(fetchMock)).toBe(1);

    await vi.advanceTimersByTimeAsync(7_001);
    await resolveTwitchJilChatBadges('333');
    expect(perUserCalls(fetchMock)).toBe(2);
  });

  it('preserves a valid cached badge when a different user triggers cooldown', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (isList(input)) return response({}, 503);
      if (String(input).endsWith('userId=111')) {
        return response([{
          id: 'verified',
          title: 'JilChat Verified',
          url: 'https://api.jil.chat/uploads/verified.png',
        }]);
      }
      return response({}, 429, '10');
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveTwitchJilChatBadges('111');
    expect(first).toEqual([expect.objectContaining({
      type: 'community:jilchat:verified',
    })]);
    await resolveTwitchJilChatBadges('222');
    expect(await resolveTwitchJilChatBadges('111')).toEqual(first);
    expect(perUserCalls(fetchMock)).toBe(2);
  });

  it('does not stall live-chat delivery when an optional JilChat fetch is slow', async () => {
    let finish: ((r: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/twitch/jilchat-badges?')) {
        return new Promise<Response>((resolve) => { finish = resolve; });
      }
      return response({}, 404);
    }));

    const pending = resolveTwitchCommunityBadges({
      userId: '999', login: 'viewer999', displayName: 'Viewer999',
    });
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual(expect.any(Array));
    finish?.(response([]));
    await vi.advanceTimersByTimeAsync(1);
  });

  it('answers every chatter from the one JilChat list: no request per chatter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (isList(input)) {
        return response({
          listsUsers: true,
          badges: [
            { id: 'translator', title: 'JilChat Translator', url: 'https://api.jil.chat/files/translator.png', userIds: ['111', '222'] },
            { id: 'milestone_1', title: 'JilChat Month 1', url: 'https://api.jil.chat/files/m1.png', userIds: ['333'] },
          ],
        });
      }
      throw new Error('no per-chatter request expected');
    });
    vi.stubGlobal('fetch', fetchMock);

    const users = Array.from({ length: 200 }, (_, i) => String(1000 + i));
    const results = await Promise.all(['111', '222', '333', ...users].map((id) => resolveTwitchJilChatBadges(id)));
    expect(results[0]).toEqual([expect.objectContaining({ type: 'community:jilchat:translator', title: 'JilChat Translator' })]);
    expect(results[1]).toEqual([expect.objectContaining({ type: 'community:jilchat:translator' })]);
    expect(results[2]).toEqual([expect.objectContaining({ type: 'community:jilchat:milestone-1' })]);
    expect(results.slice(3).every((badges) => badges.length === 0)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the list every few minutes and keeps the last good one when a refresh fails', async () => {
    let serve: 'first' | 'fail' | 'second' = 'first';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!isList(input)) throw new Error('no per-chatter request expected');
      if (serve === 'fail') return response({}, 502);
      const userIds = serve === 'first' ? ['111'] : ['222'];
      return response({ listsUsers: true, badges: [{ id: 'first', title: 'JilChat First', url: 'https://api.jil.chat/files/first.png', userIds }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await resolveTwitchJilChatBadges('111')).toHaveLength(1);
    serve = 'fail';
    await vi.advanceTimersByTimeAsync(JILCHAT_DIRECTORY_CLIENT_TTL_MS + 1);
    expect(await resolveTwitchJilChatBadges('111')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await resolveTwitchJilChatBadges('111')).toHaveLength(1);

    serve = 'second';
    await vi.advanceTimersByTimeAsync(JILCHAT_DIRECTORY_CLIENT_RETRY_MS + 1);
    await resolveTwitchJilChatBadges('111');
    await vi.advanceTimersByTimeAsync(1);
    expect(await resolveTwitchJilChatBadges('111')).toEqual([]);
    expect(await resolveTwitchJilChatBadges('222')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a list that stops naming users falls back to the guarded per-chatter lookups', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (isList(input)) return response({ listsUsers: false, badges: [] });
      return response([{ id: 'first', title: 'JilChat First', url: 'https://api.jil.chat/files/first.png' }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveTwitchJilChatBadges('111')).toEqual([expect.objectContaining({ type: 'community:jilchat:first' })]);
    expect(perUserCalls(fetchMock)).toBe(1);
  });
});
