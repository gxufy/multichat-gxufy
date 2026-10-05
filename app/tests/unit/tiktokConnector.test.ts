import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTikTokConnector } from '@/lib/connectors/tiktok';
import type { UnifiedMessage, UnifiedPin } from '@/lib/types';

type MessageHandler = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onmessage: MessageHandler | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  fail(): void {
    this.onerror?.();
  }

  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  FakeEventSource.instances.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connectFixture() {
  const messages: UnifiedMessage[] = [];
  const pins: (UnifiedPin | null)[] = [];
  const statuses: string[] = [];
  const deletes: Array<{ id?: string; senderId?: string }> = [];
  const connector = createTikTokConnector({
    channel: '@gxufy',
    onMessage: message => messages.push(message),
    onDelete: deletion => deletes.push(deletion),
    onPin: pin => pins.push(pin),
    onStatus: (status, detail) => statuses.push(detail ? `${status}:${detail}` : status),
  });
  connector.start();
  return { connector, messages, pins, statuses, deletes };
}

describe('TikTok SSE ingestion', () => {
  it('forwards rapid separate SSE messages immediately and in receive order', () => {
    const fixture = connectFixture();
    const source = FakeEventSource.instances[0];

    source.emit({ type: 'chat', id: 'rapid-1', senderId: 'u1', username: 'one', text: 'one', timestamp: 10_001 });
    source.emit({ type: 'chat', id: 'rapid-2', senderId: 'u2', username: 'two', text: 'two', timestamp: 10_002 });
    source.emit({ type: 'chat', id: 'rapid-3', senderId: 'u3', username: 'three', text: 'three', timestamp: 10_003 });

    expect(fixture.messages.map(message => message.id)).toEqual(['rapid-1', 'rapid-2', 'rapid-3']);
    expect(fixture.messages.map(message => message.text)).toEqual(['one', 'two', 'three']);
    fixture.connector.stop();
  });

  it('keeps one overlay-start cutoff across reconnects while recovering unseen new rows', async () => {
    const fixture = connectFixture();
    const first = FakeEventSource.instances[0];
    expect(first.url).toBe('/api/tiktok/chat?user=%40gxufy&since=10000');

    first.emit({ type: 'status', status: 'connected' });
    /* Defense-in-depth: an older server/proxy replay still cannot leak through
       even though the current SSE endpoint filters these rows server-side. */
    first.emit({ type: 'chat', id: 123, senderId: 'u1', username: 'one', text: 'old chat', timestamp: 9_000 });
    first.emit({
      type: 'gift', id: 'gift-old', senderId: 'u2', username: 'two',
      text: 'old gift', giftIcon: 'https://example.test/gift.png', timestamp: 9_500,
    });
    expect(fixture.messages).toEqual([]);

    first.emit({
      type: 'chat', id: '124', senderId: 'u3', senderUsername: 'three-login',
      username: 'Three Display', text: 'new', timestamp: 10_100,
    });
    first.emit({
      type: 'gift', id: 'gift-new', senderId: 'u4', username: 'four',
      text: '😀 wow', giftIcon: 'https://example.test/gift.png', timestamp: 10_200,
    });
    expect(fixture.messages.map(message => message.id)).toEqual(['124', 'gift-new']);
    expect(fixture.messages[0]).toMatchObject({
      senderId: 'u3', senderUsername: 'three-login', username: 'Three Display',
    });
    expect(fixture.messages[1].emotes).toEqual([{
      begin: 6,
      end: 10,
      text: 'gift',
      url: 'https://example.test/gift.png',
    }]);

    first.fail();
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);

    const second = FakeEventSource.instances[1];
    expect(second.url).toBe('/api/tiktok/chat?user=%40gxufy&since=10000');
    second.emit({ type: 'chat', id: 123, senderId: 'u1', username: 'one', text: 'old chat', timestamp: 9_000 });
    second.emit({
      type: 'chat', id: '124', senderId: 'u3', senderUsername: 'three-login',
      username: 'Three Display', text: 'new', timestamp: 10_100,
    });
    second.emit({ type: 'chat', id: '125', senderId: 'u5', username: 'five', text: 'missed while reconnecting', timestamp: 12_000 });

    expect(fixture.messages.map(message => message.id)).toEqual(['124', 'gift-new', '125']);
    expect(fixture.statuses).toEqual(['connecting', 'connected', 'connecting']);
    fixture.connector.stop();
  });

  it('backs off repeated SSE failures and resets after a connected status', async () => {
    const fixture = connectFixture();
    const first = FakeEventSource.instances[0];

    first.fail();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    const second = FakeEventSource.instances[1];
    second.fail();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    const third = FakeEventSource.instances[2];
    third.emit({ type: 'status', status: 'connected' });
    third.fail();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(FakeEventSource.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(4);
    fixture.connector.stop();
  });

  it('keeps pin replay stateful and does not collapse new events without ids', () => {
    const fixture = connectFixture();
    const source = FakeEventSource.instances[0];

    source.emit({ type: 'follow', username: 'one', text: 'one followed', timestamp: 10_001 });
    source.emit({ type: 'follow', username: 'one', text: 'one followed again', timestamp: 10_002 });
    source.emit({ type: 'pin', id: 'pin-1', senderId: 'u1', username: 'one', text: 'pinned', timestamp: 10_003 });
    source.emit({ type: 'pin', id: 'pin-1', senderId: 'u1', username: 'one', text: 'pinned', timestamp: 10_003 });

    expect(fixture.messages).toHaveLength(2);
    expect(fixture.messages.every(message => message.id === '')).toBe(true);
    expect(fixture.pins.map(pin => pin?.message.id)).toEqual(['pin-1', 'pin-1']);
    fixture.connector.stop();
  });
});
