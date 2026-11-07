import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCommunityBadgeCache,
  JILCHAT_CLIENT_BURST,
  JILCHAT_CLIENT_MAX_QUEUE,
  JILCHAT_CLIENT_REFILL_MS,
  resolveTwitchCommunityBadges,
  resolveTwitchJilChatBadges,
} from '@/lib/communityBadges';

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
      if (String(input).endsWith('userId=111')) return response({}, 429, '7');
      return response([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    await resolveTwitchJilChatBadges('111');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolveTwitchJilChatBadges('222');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(7_001);
    await resolveTwitchJilChatBadges('333');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves a valid cached badge when a different user triggers cooldown', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
});
