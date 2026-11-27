/* Kick event rows carry the person's Kick user id when the event names one,
 * so their 7TV paint and badge are looked up and drawn like a chatter's. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector, UnifiedMessage } from '@/lib/types';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  close() {}
  emit(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: 'event', sequence: 1, channel: 'chatrooms.700.v2', event, data }) });
  }
}

vi.mock('@/lib/kick', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  getKickChannel: vi.fn(async () => ({
    id: 7,
    user_id: 77,
    slug: 'streamer',
    chatroom: { id: 700 },
    user: { id: 77, username: 'streamer' },
    subscriber_badges: [],
  })),
}));

let connector: Connector | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { messages: [] } }) })));
});

afterEach(() => {
  connector?.stop();
  connector = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() {
  const { createKickConnector } = await import('@/lib/connectors/kick');
  const messages: UnifiedMessage[] = [];
  connector = createKickConnector({ channel: 'streamer', onMessage: (m) => messages.push(m), onDelete: () => {}, onStatus: () => {} });
  connector.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  return messages;
}

describe('Kick event senders', () => {
  it('keeps the sender id of a Kicks gift, a subscription and a gift bomb when Kick sends one', async () => {
    const messages = await start();
    FakeEventSource.last!.emit('App\\Events\\KicksGifted', { sender: { id: 4242, username: 'Gifter' }, gift: { name: 'Rage Quit', amount: 100 } });
    FakeEventSource.last!.emit('App\\Events\\SubscriptionEvent', { username: 'Subber', months: 3, user_id: 5150 });
    FakeEventSource.last!.emit('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'Bomber', gifter_id: '6060', gifted_usernames: ['a', 'b'] });
    expect(messages.map((m) => [m.username, m.senderId, m.category])).toEqual([
      ['Gifter', '4242', 'cheer'],
      ['Subber', '5150', 'subscription'],
      ['Bomber', '6060', 'gift'],
    ]);
  });

  it('leaves the id empty when the event has none (or a malformed one)', async () => {
    const messages = await start();
    FakeEventSource.last!.emit('App\\Events\\SubscriptionEvent', { username: 'Subber', months: 1 });
    FakeEventSource.last!.emit('App\\Events\\GiftedSubscriptionsEvent', { gifter_username: 'Bomber', gifter_id: '12; drop', gifted_usernames: ['a'] });
    FakeEventSource.last!.emit('App\\Events\\KicksGifted', { sender: { username: 'Gifter', id: -3 }, gift: { name: 'x', amount: 1 } });
    expect(messages.map((m) => m.senderId)).toEqual(['', '', '']);
  });
});
