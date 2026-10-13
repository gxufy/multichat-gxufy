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
  YOUTUBE_HUB_LINGER_MS,
  YOUTUBE_HUB_MAX_CHANNELS,
  YOUTUBE_HUB_MAX_SUBSCRIBERS,
  YOUTUBE_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
  youtubeHubAggregateStats,
} from '@/lib/server/youtubeHub';
import { SharedSseCapacityError } from '@/lib/server/sharedSseAdmission';

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

describe('shared YouTube hub', () => {
  it('uses one discovery/bootstrap/poll upstream for multiple subscribers of the same channel', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeYouTube('@Streamer', first);
    const unsubscribeSecond = subscribeYouTube('streamer', second);

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(upstream.discover).toHaveBeenCalledTimes(1);
    expect(upstream.bootstrap).toHaveBeenCalledTimes(1);
    expect(upstream.fetchChat).toHaveBeenCalledTimes(1);
    expect(first.mock.calls.some(([event]) => event.type === 'actions')).toBe(true);
    expect(second.mock.calls.some(([event]) => event.type === 'actions')).toBe(true);
    const stats = youtubeHubAggregateStats();
    expect(stats.subscribers).toBe(2);
    expect(stats.actionBatches).toBe(1);
    expect(stats.lastActionBatchSize).toBe(1);
    expect(stats.maxActionBatchSize).toBe(1);
    expect(stats.recentActionBatchSizes).toEqual([1]);
    expect(stats.lastDeliverySpanMs).toBe(0);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('reports batch size, provider lag, and planned pacing without changing the overlay', async () => {
    vi.setSystemTime(20_000);
    upstream.fetchChat.mockResolvedValue({
      continuationContents: {
        liveChatContinuation: {
          actions: [
            { addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'm1', timestampUsec: '19000000' } } } },
            { addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'm2', timestampUsec: '19000000' } } } },
            { addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'm3', timestampUsec: '19000000' } } } },
          ],
          continuations: [],
        },
      },
    });

    const unsubscribe = subscribeYouTube('streamer', vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const stats = youtubeHubAggregateStats();
    expect(stats.actionBatches).toBe(1);
    expect(stats.actions).toBe(3);
    expect(stats.averageActionBatchSize).toBe(3);
    expect(stats.lastActionBatchSize).toBe(3);
    expect(stats.maxActionBatchSize).toBe(3);
    expect(stats.recentActionBatchSizes).toEqual([3]);
    expect(stats.providerLagSamples).toBe(3);
    expect(stats.averageProviderLagMs).toBe(1000);
    expect(stats.lastProviderLagMs).toBe(1000);
    expect(stats.lastDeliveryGapMs).toBe(150);
    expect(stats.lastDeliverySpanMs).toBe(300);
    unsubscribe();
  });

  it('starts one independent upstream chat for each simultaneous regular live and live Short', async () => {
    upstream.discover.mockResolvedValue({
      videoIds: ['AAAAAAAAAAA', 'BBBBBBBBBBB'],
      featuredVideoId: 'AAAAAAAAAAA',
      liveShortVideoId: 'BBBBBBBBBBB',
    });
    upstream.bootstrap.mockImplementation(async (videoId: string) => ({
      videoId,
      apiKey: `key-${videoId}`,
      clientVersion: '1',
      continuation: `c-${videoId}`,
      channelId: 'UC1234567890123456789012',
    }));

    const unsubscribe = subscribeYouTube('streamer', vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(upstream.discover).toHaveBeenCalledTimes(1);
    expect(upstream.bootstrap).toHaveBeenCalledTimes(2);
    expect(new Set(upstream.bootstrap.mock.calls.map(([videoId]) => videoId)))
      .toEqual(new Set(['AAAAAAAAAAA', 'BBBBBBBBBBB']));
    unsubscribe();
  });
});

describe('YouTube shared-hub resource limits', () => {
  it('bounds channels atomically while keeping an existing channel admissible', async () => {
    const unsubscribes = Array.from({ length: YOUTUBE_HUB_MAX_CHANNELS }, (_, index) => (
      subscribeYouTube(`streamer${index}`, () => {})
    ));
    expect(youtubeHubAggregateStats().activeChannels).toBe(YOUTUBE_HUB_MAX_CHANNELS);
    expect(upstream.discover).toHaveBeenCalledTimes(YOUTUBE_HUB_MAX_CHANNELS);

    const sameChannel = subscribeYouTube('streamer0', () => {});
    expect(youtubeHubAggregateStats().subscribers).toBe(YOUTUBE_HUB_MAX_CHANNELS + 1);
    expect(() => subscribeYouTube('newstreamer', () => {})).toThrow(SharedSseCapacityError);
    expect(upstream.discover).toHaveBeenCalledTimes(YOUTUBE_HUB_MAX_CHANNELS);

    unsubscribes[1]();
    await vi.advanceTimersByTimeAsync(YOUTUBE_HUB_LINGER_MS - 1);
    expect(() => subscribeYouTube('newstreamer', () => {})).toThrow(SharedSseCapacityError);
    await vi.advanceTimersByTimeAsync(1);
    const replacement = subscribeYouTube('newstreamer', () => {});
    expect(youtubeHubAggregateStats().activeChannels).toBe(YOUTUBE_HUB_MAX_CHANNELS);
    replacement();
    sameChannel();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('cannot exceed the channel cap under near-simultaneous admissions', async () => {
    const admissions = await Promise.allSettled(
      Array.from({ length: YOUTUBE_HUB_MAX_CHANNELS + 8 }, async (_, index) => (
        subscribeYouTube(`parallel${index}`, () => {})
      )),
    );
    expect(admissions.filter((result) => result.status === 'fulfilled')).toHaveLength(
      YOUTUBE_HUB_MAX_CHANNELS,
    );
    expect(admissions.filter((result) => result.status === 'rejected')).toHaveLength(8);
    expect(youtubeHubAggregateStats().activeChannels).toBe(YOUTUBE_HUB_MAX_CHANNELS);
    expect(upstream.discover).toHaveBeenCalledTimes(YOUTUBE_HUB_MAX_CHANNELS);
  });

  it('enforces and releases the per-channel subscriber limit idempotently', () => {
    const unsubscribes = Array.from(
      { length: YOUTUBE_HUB_MAX_SUBSCRIBERS_PER_CHANNEL },
      () => subscribeYouTube('popular', () => {}),
    );
    expect(() => subscribeYouTube('popular', () => {})).toThrow(SharedSseCapacityError);
    expect(youtubeHubAggregateStats().subscribers).toBe(
      YOUTUBE_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
    );

    unsubscribes[0]();
    unsubscribes[0]();
    const replacement = subscribeYouTube('popular', () => {});
    expect(youtubeHubAggregateStats().subscribers).toBe(
      YOUTUBE_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
    );
    replacement();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('enforces and releases the provider-wide subscriber limit without new upstream work', () => {
    const unsubscribes: Array<() => void> = [];
    const channelCount = Math.ceil(
      YOUTUBE_HUB_MAX_SUBSCRIBERS / YOUTUBE_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
    );
    for (let channel = 0; channel < channelCount; channel += 1) {
      for (let subscriber = 0; subscriber < YOUTUBE_HUB_MAX_SUBSCRIBERS_PER_CHANNEL; subscriber += 1) {
        if (unsubscribes.length >= YOUTUBE_HUB_MAX_SUBSCRIBERS) break;
        unsubscribes.push(subscribeYouTube(`global${channel}`, () => {}));
      }
    }

    const discoveries = upstream.discover.mock.calls.length;
    expect(youtubeHubAggregateStats().subscribers).toBe(YOUTUBE_HUB_MAX_SUBSCRIBERS);
    expect(() => subscribeYouTube('global-extra', () => {})).toThrow(SharedSseCapacityError);
    expect(upstream.discover).toHaveBeenCalledTimes(discoveries);

    unsubscribes[0]();
    unsubscribes[0]();
    const replacement = subscribeYouTube('global-extra', () => {});
    expect(youtubeHubAggregateStats().subscribers).toBe(YOUTUBE_HUB_MAX_SUBSCRIBERS);
    replacement();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('keeps recovery replay ordered while a zero-subscriber channel lingers', async () => {
    const first = vi.fn();
    const unsubscribeFirst = subscribeYouTube('streamer', first);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    unsubscribeFirst();

    const recovered = vi.fn();
    const unsubscribeRecovered = subscribeYouTube('streamer', recovered);
    const actionEvents = recovered.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === 'actions');
    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0].actions[0].addChatItemAction.item.liveChatTextMessageRenderer.id)
      .toBe('m1');
    expect(upstream.discover).toHaveBeenCalledTimes(1);
    unsubscribeRecovered();
  });
});
