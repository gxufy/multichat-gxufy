import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createYouTubeConnector } from '@/lib/connectors/youtube';
import type { UnifiedMessage } from '@/lib/types';

class SharedEventSource {
  static OPEN = 1;
  static last: SharedEventSource | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    SharedEventSource.last = this;
  }

  close() { this.closed = true; }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(20_000);
  SharedEventSource.last = null;
  vi.stubGlobal('EventSource', SharedEventSource);
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('shared YouTube connector should not direct-poll');
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('YouTube browser shared-hub connector', () => {
  it('consumes status and raw InnerTube action batches from one SSE subscription', () => {
    const messages: UnifiedMessage[] = [];
    const statuses: string[] = [];
    const channelInfo: Array<{ channelId: string; videoId: string }> = [];
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onPin: vi.fn(),
      onStatus: status => statuses.push(status),
      onChannelInfo: info => channelInfo.push(info),
    });

    connector.start();
    expect(SharedEventSource.last?.url).toContain('/api/youtube/stream?');
    expect(SharedEventSource.last?.url).toContain('channel=Streamer');
    expect(SharedEventSource.last?.url).toContain('since=20000');

    SharedEventSource.last!.emit({
      type: 'status',
      status: 'connected',
      videoId: 'AAAAAAAAAAA',
      channelId: 'UC1234567890123456789012',
    });
    SharedEventSource.last!.emit({
      type: 'actions',
      videoId: 'AAAAAAAAAAA',
      timestamp: 20_000,
      actions: [{
        addChatItemAction: {
          item: {
            liveChatTextMessageRenderer: {
              id: 'shared-message',
              authorName: { simpleText: '@Viewer' },
              authorExternalChannelId: 'UC-viewer',
              timestampUsec: '20000000',
              message: { runs: [{ text: 'hello from shared hub' }] },
            },
          },
        },
      }],
    });

    expect(statuses).toEqual(['connecting', 'connected']);
    expect(channelInfo).toEqual([{
      channelId: 'UC1234567890123456789012',
      videoId: 'AAAAAAAAAAA',
    }]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      platform: 'youtube',
      id: 'shared-message',
      username: '@Viewer',
      text: 'hello from shared hub',
    });
    expect(fetch).not.toHaveBeenCalled();
    connector.stop();
    expect(SharedEventSource.last?.closed).toBe(true);
  });

  it('paces a YouTube action batch instead of emitting every message in one render burst', async () => {
    const messages: UnifiedMessage[] = [];
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onPin: vi.fn(),
      onStatus: vi.fn(),
    });
    const action = (id: string, text: string) => ({
      addChatItemAction: {
        item: {
          liveChatTextMessageRenderer: {
            id,
            authorName: { simpleText: '@Viewer' },
            authorExternalChannelId: `UC-${id}`,
            timestampUsec: '20000000',
            message: { runs: [{ text }] },
          },
        },
      },
    });

    connector.start();
    SharedEventSource.last!.emit({
      type: 'actions',
      videoId: 'AAAAAAAAAAA',
      timestamp: 20_000,
      actions: [action('one', 'first'), action('two', 'second'), action('three', 'third')],
    });

    expect(messages.map(message => message.id)).toEqual(['one']);
    await vi.advanceTimersByTimeAsync(149);
    expect(messages.map(message => message.id)).toEqual(['one']);
    await vi.advanceTimersByTimeAsync(1);
    expect(messages.map(message => message.id)).toEqual(['one', 'two']);
    await vi.advanceTimersByTimeAsync(150);
    expect(messages.map(message => message.id)).toEqual(['one', 'two', 'three']);
    connector.stop();
  });

});
