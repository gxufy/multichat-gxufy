import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upstream = vi.hoisted(() => ({
  discover: vi.fn(),
  bootstrap: vi.fn(),
  fetchChat: vi.fn(),
  next: vi.fn(),
}));

vi.mock('@/lib/server/youtubeUpstream', () => ({
  YOUTUBE_OFFLINE_RECHECK_MS: 60_000,
  discoverYouTubeLiveVideos: upstream.discover,
  bootstrapYouTubeChat: upstream.bootstrap,
  fetchYouTubeChat: upstream.fetchChat,
  nextYouTubeContinuation: upstream.next,
}));

import {
  resetYouTubeHubForTests,
  subscribeYouTube,
  youtubeHubChannelStats,
} from '@/lib/server/youtubeHub';

beforeEach(() => {
  vi.useFakeTimers();
  resetYouTubeHubForTests();
  upstream.discover.mockReset().mockResolvedValue({
    videoIds: ['AAAAAAAAAAA'],
    featuredVideoId: 'AAAAAAAAAAA',
    liveShortVideoId: null,
  });
  upstream.bootstrap.mockReset().mockResolvedValue({
    videoId: 'AAAAAAAAAAA',
    apiKey: 'key',
    clientVersion: '1',
    continuation: 'c0',
    channelId: 'UC1234567890123456789012',
  });
  upstream.fetchChat.mockReset().mockResolvedValue({
    continuationContents: {
      liveChatContinuation: {
        actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'm1' } } } }],
        continuations: [],
      },
    },
  });
  upstream.next.mockReset().mockReturnValue({ continuation: null, timeoutMs: 0 });
});

afterEach(() => {
  resetYouTubeHubForTests();
  vi.useRealTimers();
});

describe('per-channel YouTube diagnostics', () => {
  it('reports only the requested active channel and accepts case-insensitive lookups', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeYouTube('@Streamer', first);
    const unsubscribeSecond = subscribeYouTube('streamer', second);

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(youtubeHubChannelStats('STREAMER')).toMatchObject({
      channel: 'Streamer',
      active: true,
      subscribers: 2,
      liveChats: 0,
      healthyLiveChats: 0,
      actionBatches: 1,
      actions: 1,
      lastActionBatchSize: 1,
      recentActionBatchSizes: [1],
      polls: 1,
    });
    expect(youtubeHubChannelStats('not-running')).toEqual({
      channel: 'not-running',
      active: false,
    });

    unsubscribeFirst();
    unsubscribeSecond();
  });
});
