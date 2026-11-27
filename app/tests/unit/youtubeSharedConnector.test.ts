import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createYouTubeConnector } from '@/lib/connectors/youtube';
import type { UnifiedMessage } from '@/lib/types';

class SharedEventSource {
  static OPEN = 1;
  static last: SharedEventSource | null = null;
  static count = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readyState = 1;
  sharedReconnect = false;

  constructor(readonly url: string) {
    SharedEventSource.last = this;
    SharedEventSource.count += 1;
  }

  close() { this.closed = true; }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  /** The connection dropped: it reconnects by itself (through the page's
      shared stream when `shared`). */
  drop(shared = true) { this.readyState = 0; this.sharedReconnect = shared; this.onerror?.(); }
  /** Refused or failed for good (EventSource closes itself). */
  fail() { this.readyState = 2; this.onerror?.(); }
}

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(20_000);
  SharedEventSource.last = null;
  SharedEventSource.count = 0;
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
      onStatus: vi.fn(),
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

  it('shows what is left of a batch at once when the next batch arrives', async () => {
    const messages: UnifiedMessage[] = [];
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    SharedEventSource.last!.emit({
      type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 20_000,
      actions: [action('a1', 'one'), action('a2', 'two'), action('a3', 'three')],
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(messages.map(message => message.id)).toEqual(['a1', 'a2']);

    SharedEventSource.last!.emit({
      type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 21_000,
      actions: [action('b1', 'four'), action('b2', 'five')],
    });
    expect(messages.map(message => message.id)).toEqual(['a1', 'a2', 'a3', 'b1']);
    await vi.advanceTimersByTimeAsync(150);
    expect(messages.map(message => message.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    connector.stop();
  });

  it('waits for a dropped connection to come back by itself, without the backoff', async () => {
    const messages: UnifiedMessage[] = [];
    const statuses: string[] = [];
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onStatus: status => statuses.push(status),
    });
    connector.start();
    const source = SharedEventSource.last!;
    source.emit({ type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 20_000, actions: [action('before', 'before')] });

    source.drop();
    expect(source.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(SharedEventSource.count).toBe(1);

    /* Back on the same source: the resumed stream repeats the last batch. */
    source.readyState = 1;
    source.emit({ type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 20_000, actions: [action('before', 'before')] });
    source.emit({ type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 21_000, actions: [action('after', 'after')] });
    await vi.advanceTimersByTimeAsync(150);
    expect(messages.map(message => message.id)).toEqual(['before', 'after']);
    expect(statuses).toEqual(['connecting', 'connecting']);
    connector.stop();
  });

  it('a dropped connection of its own still waits out the backoff', async () => {
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: vi.fn(),
      onDelete: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    const source = SharedEventSource.last!;
    source.drop(false);
    expect(source.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(SharedEventSource.count).toBe(2);
    connector.stop();
  });

  it('backs off when the stream is refused', async () => {
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: vi.fn(),
      onDelete: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    const source = SharedEventSource.last!;
    source.fail();
    expect(source.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(SharedEventSource.count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(SharedEventSource.count).toBe(2);
    connector.stop();
  });

  it('applies a delete or ban as soon as its batch arrives; only chat items are paced', async () => {
    const messages: UnifiedMessage[] = [];
    const deletes: unknown[] = [];
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: message => messages.push(message),
      onDelete: deletion => deletes.push(deletion),
      onStatus: vi.fn(),
    });
    connector.start();
    const items = Array.from({ length: 8 }, (_, i) => action(`m${i}`, `line ${i}`));
    SharedEventSource.last!.emit({
      type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 20_000,
      actions: [
        ...items.slice(0, 4),
        { markChatItemAsDeletedAction: { targetItemId: 'shown-earlier' } },
        { addLiveChatTickerItemAction: { item: {} } },
        ...items.slice(4),
        { markChatItemsByAuthorAsDeletedAction: { externalChannelId: 'UC-banned' } },
      ],
    });
    expect(deletes).toEqual([{ id: 'shown-earlier' }, { senderId: 'UC-banned' }]);
    expect(messages.map(message => message.id)).toEqual(['m0']);
    /* Eight chat items over 1.2 s: one every 150 ms (the delete, ticker and ban take no turn). */
    await vi.advanceTimersByTimeAsync(150);
    expect(messages.map(message => message.id)).toEqual(['m0', 'm1']);
    await vi.advanceTimersByTimeAsync(900);
    expect(messages).toHaveLength(8);
    connector.stop();
  });

  it('never shows a message deleted, or whose author is banned, in the same batch', async () => {
    const messages: UnifiedMessage[] = [];
    const connector = createYouTubeConnector({
      channel: '@Streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    SharedEventSource.last!.emit({
      type: 'actions', videoId: 'AAAAAAAAAAA', timestamp: 20_000,
      actions: [
        action('keep', 'kept'),
        action('gone', 'deleted'),
        action('spam', 'banned'),
        { markChatItemAsDeletedAction: { targetItemId: 'gone' } },
        { markChatItemsByAuthorAsDeletedAction: { externalChannelId: 'UC-spam' } },
      ],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(messages.map(message => message.id)).toEqual(['keep']);
    connector.stop();
  });

});
