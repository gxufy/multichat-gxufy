import { describe, expect, it } from 'vitest';
import {
  featuredLiveVideoIdFromHtml,
  liveViewContinuation,
  liveShortVideoIdFromHtml,
  mergeYouTubeLiveVideoIds,
  nextYouTubeContinuation,
  youtubeBootstrapContinuation,
  YOUTUBE_POLL_CEILING_MS,
  YOUTUBE_POLL_FLOOR_MS,
} from '@/lib/server/youtubeUpstream';
import {
  shouldSendYouTubeSseEvent,
  youtubeSseSince,
} from '@/pages/api/youtube/stream';

describe('YouTube live broadcast discovery', () => {
  it('keeps the old canonical watch-link discovery path', () => {
    expect(featuredLiveVideoIdFromHtml(
      '<link rel="canonical" href="https://www.youtube.com/watch?v=AAAAAAAAAAA">',
    )).toBe('AAAAAAAAAAA');
  });

  it('accepts the new currentVideoEndpoint only when its bounded object is live', () => {
    expect(featuredLiveVideoIdFromHtml([
      '"currentVideoEndpoint":{',
      '"url":"/watch?v=BBBBBBBBBBB&feature=share",',
      '"watchEndpointSupportedOnesieConfig":{"html5PlaybackOnesieConfig":{"commonConfig":{}}},',
      '"isLive":true}',
    ].join(''))).toBe('BBBBBBBBBBB');

    expect(featuredLiveVideoIdFromHtml([
      '"currentVideoEndpoint":{',
      '"url":"/watch?v=CCCCCCCCCCC",',
      '"isLive":false}',
    ].join(''))).toBeNull();
  });

  it('finds the live Short without mistaking ordinary Shorts for live broadcasts', () => {
    const html = [
      '"shortsLockupViewModel":{"entityId":"shorts-shelf-item-AAAAAAAAAAA","overlayMetadata":{"primaryText":"old short"}}',
      '"shortsLockupViewModel":{"entityId":"shorts-shelf-item-BBBBBBBBBBB","overlayMetadata":{"primaryText":"LIVE"},"badgeStyle":"THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"}',
      '"shortsLockupViewModel":{"entityId":"shorts-shelf-item-CCCCCCCCCCC","overlayMetadata":{"primaryText":"another short"}}',
    ].join('');
    expect(liveShortVideoIdFromHtml(html)).toBe('BBBBBBBBBBB');
  });

  it('keeps the featured broadcast first and de-duplicates a Short that resolves to the same video', () => {
    expect(mergeYouTubeLiveVideoIds('AAAAAAAAAAA', 'BBBBBBBBBBB'))
      .toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    expect(mergeYouTubeLiveVideoIds('AAAAAAAAAAA', 'AAAAAAAAAAA'))
      .toEqual(['AAAAAAAAAAA']);
    expect(mergeYouTubeLiveVideoIds(null, 'BBBBBBBBBBB'))
      .toEqual(['BBBBBBBBBBB']);
  });
});

describe('YouTube initial live-chat continuation', () => {
  const item = (title: string, continuation: string) => ({
    title,
    continuation: { reloadContinuationData: { continuation } },
  });

  it('prefers the normal Live chat continuation over Top chat', () => {
    const initialData = {
      contents: { liveChatRenderer: { header: { liveChatHeaderRenderer: {
        viewSelector: { sortFilterSubMenuRenderer: { subMenuItems: [
          item('Top chat', 'paid-heavy-top'),
          item('Live chat', 'all-messages'),
        ] } },
      } } } },
    };

    expect(liveViewContinuation(initialData)).toBe('all-messages');
    expect(youtubeBootstrapContinuation(
      '"continuation":"legacy-first"',
      initialData,
    )).toBe('all-messages');
  });

  it('uses the last structured reload continuation when labels are localized', () => {
    const initialData = {
      contents: { liveChatRenderer: { header: { liveChatHeaderRenderer: {
        viewSelector: { sortFilterSubMenuRenderer: { subMenuItems: [
          item('Destacados', 'localized-top'),
          item('Todos', 'localized-all'),
        ] } },
      } } } },
    };
    expect(liveViewContinuation(initialData)).toBe('localized-all');
  });

  it('retains the legacy bare continuation fallback', () => {
    expect(youtubeBootstrapContinuation(
      'before "continuation":"legacy-continuation" after',
      null,
    )).toBe('legacy-continuation');
  });
});

describe('YouTube continuation cadence', () => {
  const continuation = (timeoutMs: number) => ({
    continuations: [{ timedContinuationData: { continuation: 'next', timeoutMs } }],
  });

  it('caps long YouTube hints so busy chat is polled in smaller batches', () => {
    expect(YOUTUBE_POLL_CEILING_MS).toBe(1_000);
    expect(nextYouTubeContinuation(continuation(10_000))).toEqual({
      continuation: 'next', timeoutMs: YOUTUBE_POLL_CEILING_MS,
    });
    expect(nextYouTubeContinuation(continuation(100))).toEqual({
      continuation: 'next', timeoutMs: YOUTUBE_POLL_FLOOR_MS,
    });
    expect(nextYouTubeContinuation(continuation(1_500))).toEqual({
      continuation: 'next', timeoutMs: YOUTUBE_POLL_CEILING_MS,
    });
  });
});

describe('YouTube shared SSE session cutoff', () => {
  it('parses a valid browser-source start timestamp', () => {
    expect(youtubeSseSince('10000')).toBe(10_000);
    expect(youtubeSseSince(['12000', '13000'])).toBe(12_000);
    expect(youtubeSseSince('bad')).toBeNull();
    expect(youtubeSseSince('0')).toBeNull();
  });

  it('drops buffered action batches from before this browser source while preserving status/control data', () => {
    const since = 10_000;
    expect(shouldSendYouTubeSseEvent({ type: 'actions', timestamp: 9_999 }, since)).toBe(false);
    expect(shouldSendYouTubeSseEvent({ type: 'actions', timestamp: 10_000 }, since)).toBe(true);
    expect(shouldSendYouTubeSseEvent({ type: 'status' }, since)).toBe(true);
  });
});
