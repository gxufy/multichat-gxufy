import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  last: null as any,
  instances: [] as any[],
  connect: vi.fn(),
}));

vi.mock('tiktok-live-connector', () => {
  class FakeTikTokConnection {
    handlers = new Map<string, Array<(data: any) => void>>();
    connectCalls = 0;
    webClient = {
      clientHeaders: {
        Cookie: 'tt-target-idc=useast1a; sessionid=preserved',
        Accept: '*/*',
      },
      cookieJar: { store: {
        'tt-target-idc': 'useast1a',
        sessionid: 'preserved',
      } },
    };
    constructor() {
      fake.last = this;
      fake.instances.push(this);
    }
    on(event: string, handler: (data: any) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    connect() {
      this.connectCalls += 1;
      return fake.connect();
    }
    disconnectCalls = 0;
    disconnect() { this.disconnectCalls += 1; }
    emit(event: string, data: any) {
      for (const handler of this.handlers.get(event) ?? []) handler(data);
    }
  }
  return {
    TikTokLiveConnection: FakeTikTokConnection,
    ControlEvent: { CONNECTED: 'CONNECTED', DISCONNECTED: 'DISCONNECTED' },
    WebcastEvent: {
      STREAM_END: 'STREAM_END', CHAT: 'CHAT', IM_DELETE: 'IM_DELETE', GIFT: 'GIFT',
      SUB_NOTIFY: 'SUB_NOTIFY', FOLLOW: 'FOLLOW', SHARE: 'SHARE', ROOM_PIN: 'ROOM_PIN',
    },
  };
});

import {
  TIKTOK_HUB_LINGER_MS,
  TIKTOK_HUB_MAX_CHANNELS,
  TIKTOK_HUB_MAX_SUBSCRIBERS,
  TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
  TIKTOK_PUBLIC_CONNECTION_ERROR_DETAIL,
  TIKTOK_RECENT_MAX,
  TIKTOK_TARGET_IDC_COOKIE,
  normalizeTikTokMessageTimestamp,
  removeTikTokTargetIdcCookie,
  resetTikTokHubForTests,
  subscribe,
  tikTokNativeMessageId,
  tiktokHubAggregateStats,
  tikTokBufferedEventMatchesDelete,
} from '@/lib/tiktokHub';
import { SharedSseCapacityError } from '@/lib/server/sharedSseAdmission';

beforeEach(() => {
  vi.useFakeTimers();
  fake.last = null;
  fake.instances = [];
  fake.connect.mockReset().mockResolvedValue({});
  resetTikTokHubForTests();
});

afterEach(() => {
  resetTikTokHubForTests();
  vi.useRealTimers();
});

describe('TikTok shared-hub recovery', () => {
  it('removes only the SDK default datacenter cookie before the first connection request', async () => {
    let headersAtConnect: Record<string, string> | undefined;
    let cookiesAtConnect: Record<string, string> | undefined;
    fake.connect.mockImplementationOnce(function (this: unknown) {
      headersAtConnect = { ...fake.last.webClient.clientHeaders };
      cookiesAtConnect = { ...fake.last.webClient.cookieJar.store };
      return Promise.resolve({});
    });

    const unsubscribe = subscribe('streamer', () => {});
    await Promise.resolve();

    expect(headersAtConnect).toEqual({ Cookie: 'sessionid=preserved', Accept: '*/*' });
    expect(cookiesAtConnect).toEqual({ sessionid: 'preserved' });
    expect(headersAtConnect?.Cookie).not.toContain(TIKTOK_TARGET_IDC_COOKIE);
    unsubscribe();
  });

  it('removes a standalone target-idc header without affecting unrelated state', () => {
    const webClient = {
      clientHeaders: { cookie: 'tt-target-idc=useast1a', Accept: 'application/json' },
      cookieJar: { store: { 'tt-target-idc': 'useast1a', other: 'kept' } },
    };
    removeTikTokTargetIdcCookie(webClient);
    expect(webClient.clientHeaders).toEqual({ Accept: 'application/json' });
    expect(webClient.cookieJar.store).toEqual({ other: 'kept' });
  });

  it('uses provider-native IDs for chat and system events with safe fallbacks only when absent', async () => {
    expect(tikTokNativeMessageId({ common: { msgId: 'native-common' }, msgId: 'legacy' }))
      .toBe('native-common');
    expect(tikTokNativeMessageId({ msgId: 123 })).toBe('123');
    expect(tikTokNativeMessageId({ common: { msgId: '  ' } })).toBeNull();

    const events: any[] = [];
    const unsubscribe = subscribe('streamer', (data) => events.push(data));
    await Promise.resolve();
    const user = { userId: 'u1', uniqueId: 'viewer', nickname: 'Viewer' };

    fake.last.emit('CHAT', { common: { msgId: 'chat-native' }, user, content: 'hello' });
    fake.last.emit('GIFT', { common: { msgId: 'gift-native' }, user, giftType: 0 });
    fake.last.emit('SUB_NOTIFY', { common: { msgId: 'sub-native' }, user });
    fake.last.emit('FOLLOW', { common: { msgId: 'follow-native' }, user });
    fake.last.emit('SHARE', { common: { msgId: 'share-native' }, user });
    fake.last.emit('ROOM_PIN', {
      common: { msgId: 'outer-pin-native' },
      pinnedMessage: { common: { msgId: 'pin-native' }, user, content: 'pinned' },
    });
    fake.last.emit('FOLLOW', { user });

    expect(events.filter((event) => event.id).map((event) => event.id)).toEqual([
      'chat-native', 'gift-native', 'sub-native', 'follow-native', 'share-native', 'pin-native',
      expect.stringMatching(/^follow-/),
    ]);
    unsubscribe();
  });

  it.each([
    {
      label: 'Error message and stack',
      makeFailure: () => {
        const failure = new Error('signed host https://internal.example/private?token=secret');
        failure.stack = 'Error: secret\n at https://internal.example/private?token=secret';
        return failure;
      },
      secrets: ['internal.example', '/private', 'token=secret', 'Error: secret'],
    },
    {
      label: 'thrown string',
      makeFailure: () => 'https://signed.example/path?signature=private',
      secrets: ['signed.example', '/path', 'signature=private'],
    },
    {
      label: 'arbitrary thrown object',
      makeFailure: () => ({
        message: 'provider response body: confidential',
        stack: 'stack with https://upstream.example/?key=private',
        url: 'https://upstream.example/?key=private',
      }),
      secrets: ['provider response body', 'upstream.example', 'key=private'],
    },
    {
      label: 'hostile error-name getter',
      makeFailure: () => Object.defineProperty({}, 'name', {
        get() { throw new Error('getter secret https://hidden.example/?key=private'); },
      }),
      secrets: ['getter secret', 'hidden.example', 'key=private'],
    },
  ])('redacts $label while preserving the five-second reconnect', async ({ makeFailure, secrets }) => {
    const events: Array<{ data: any; serialized: string }> = [];
    fake.connect.mockRejectedValueOnce(makeFailure()).mockResolvedValueOnce({});

    const unsubscribe = subscribe('streamer', (data, serialized) => {
      events.push({ data, serialized });
    });
    await Promise.resolve();
    await Promise.resolve();

    const publicError = events.find(({ data }) => data.status === 'error');
    expect(publicError?.data).toEqual({
      type: 'status',
      status: 'error',
      detail: TIKTOK_PUBLIC_CONNECTION_ERROR_DETAIL,
    });
    expect(publicError?.serialized).toBe(JSON.stringify(publicError?.data));
    for (const secret of secrets) expect(publicError?.serialized).not.toContain(secret);
    expect(tiktokHubAggregateStats().upstreamErrors).toBe(1);

    expect(fake.last.connectCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fake.last.connectCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.last.connectCalls).toBe(2);
    unsubscribe();
  });

  it('keeps the successful connected status unchanged', async () => {
    const events: any[] = [];
    const unsubscribe = subscribe('streamer', (data) => events.push(data));
    await Promise.resolve();

    fake.last.emit('CONNECTED', {});
    expect(events.at(-1)).toEqual({ type: 'status', status: 'connected' });
    unsubscribe();
  });

  it('normalizes plausible provider milliseconds or seconds and rejects unsafe timestamps', () => {
    const receivedAt = 1_700_000_000_000;
    const providerMs = receivedAt - 2_000;
    const providerSeconds = Math.floor(providerMs / 1_000);

    expect(normalizeTikTokMessageTimestamp(String(providerMs), receivedAt)).toBe(providerMs);
    expect(normalizeTikTokMessageTimestamp(providerSeconds, receivedAt)).toBe(providerSeconds * 1_000);
    for (const invalid of [undefined, '', 'not-a-time', '1e12', -1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
      expect(normalizeTikTokMessageTimestamp(invalid, receivedAt)).toBe(receivedAt);
    }
    expect(normalizeTikTokMessageTimestamp(receivedAt + 10 * 60_000, receivedAt)).toBe(receivedAt);
  });

  it('uses common.createTime for chat and falls back to receive time when invalid', async () => {
    const receivedAt = 1_700_000_000_000;
    vi.setSystemTime(receivedAt);
    const events: any[] = [];
    const unsubscribe = subscribe('streamer', (data) => events.push(data));
    await Promise.resolve();

    fake.last.emit('CHAT', {
      common: { msgId: 'provider-time', createTime: String(receivedAt - 1_500) },
      user: { userId: 'u1', uniqueId: 'one', nickname: 'One' },
      content: 'provider timestamp',
    });
    fake.last.emit('CHAT', {
      common: { msgId: 'fallback-time', createTime: 'malformed' },
      user: { userId: 'u2', uniqueId: 'two', nickname: 'Two' },
      content: 'receive timestamp',
    });

    expect(events.find(event => event.id === 'provider-time')?.timestamp).toBe(receivedAt - 1_500);
    expect(events.find(event => event.id === 'fallback-time')?.timestamp).toBe(receivedAt);
    unsubscribe();
  });

  it('forwards live chat without accumulation and replays the bounded recovery order once per id', async () => {
    const first: any[] = [];
    const unsubscribeFirst = subscribe('streamer', (data) => first.push(data));
    await Promise.resolve();

    for (const id of ['live-1', 'live-2', 'live-3']) {
      fake.last.emit('CHAT', {
        common: { msgId: id },
        user: { userId: `user-${id}`, nickname: id },
        content: id,
      });
      expect(first.filter(event => event.type === 'chat').map(event => event.id))
        .toEqual(['live-1', 'live-2', 'live-3'].slice(0, Number(id.slice(-1))));
    }

    unsubscribeFirst();
    for (const id of ['missed-1', 'missed-2', 'missed-2']) {
      fake.last.emit('CHAT', {
        common: { msgId: id },
        user: { userId: `user-${id}`, nickname: id },
        content: id,
      });
    }

    const recovered: any[] = [];
    const unsubscribeRecovered = subscribe('streamer', (data) => recovered.push(data));
    expect(recovered.filter(event => event.type === 'chat').map(event => event.id)).toEqual([
      'live-1', 'live-2', 'live-3', 'missed-1', 'missed-2',
    ]);
    unsubscribeRecovered();
  });

  it('keeps immutable id, uniqueId, and display nickname as separate fields', async () => {
    const events: any[] = [];
    const unsubscribe = subscribe('realstreamer', (data) => events.push(data));
    await Promise.resolve();

    fake.last.emit('CHAT', {
      common: { msgId: 'identity-message' },
      user: {
        userId: 'some-other-user-id',
        uniqueId: 'totallydifferentuser',
        nickname: 'realstreamer',
      },
      content: 'hello',
    });

    expect(events.find((event) => event.id === 'identity-message')).toMatchObject({
      senderId: 'some-other-user-id',
      senderUsername: 'totallydifferentuser',
      username: 'realstreamer',
    });

    fake.last.emit('CHAT', {
      common: { msgId: 'identity-without-id' },
      user: { uniqueId: 'knownuniqueid', nickname: 'Visible Nickname' },
      content: 'hello again',
    });
    expect(events.find((event) => event.id === 'identity-without-id')).toMatchObject({
      senderId: '',
      senderUsername: 'knownuniqueid',
      username: 'Visible Nickname',
    });
    unsubscribe();
  });

  it('shares one upstream connection and disconnects only after the final subscriber lingers', async () => {
    const unsubscribeFirst = subscribe('streamer', () => {});
    const firstConnection = fake.last;

    const unsubscribeSecond = subscribe('streamer', () => {});

    // Same normalized channel: the second SSE subscriber reuses the upstream.
    expect(fake.last).toBe(firstConnection);

    unsubscribeFirst();
    expect(firstConnection.disconnectCalls).toBe(0);

    unsubscribeSecond();

    // Last subscriber is gone, but the 30-second linger keeps it reusable.
    expect(firstConnection.disconnectCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(firstConnection.disconnectCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(firstConnection.disconnectCalls).toBe(1);
  });
  it('keeps 100 recovery events and matches moderation deletes by message or author', () => {
    expect(TIKTOK_RECENT_MAX).toBe(100);
    expect(tikTokBufferedEventMatchesDelete({ id: 'm1', senderId: 'u1' }, { id: 'm1' })).toBe(true);
    expect(tikTokBufferedEventMatchesDelete({ id: 'm1', senderId: 'u1' }, { senderId: 'u1' })).toBe(true);
    expect(tikTokBufferedEventMatchesDelete({ id: 'm1', senderId: 'u1' }, { id: 'other' })).toBe(false);
  });

  it('replays a delete tombstone, not the deleted row, when moderation happens during SSE downtime', async () => {
    const first: any[] = [];
    const unsubscribeFirst = subscribe('streamer', (data) => first.push(data));
    await Promise.resolve();

    fake.last.emit('CHAT', {
      common: { msgId: 'message-1' },
      user: { userId: 'user-1', nickname: 'viewer' },
      content: 'delete me',
    });
    expect(first.some((event) => event.type === 'chat' && event.id === 'message-1')).toBe(true);

    unsubscribeFirst();
    fake.last.emit('IM_DELETE', { deleteMsgIdsList: ['message-1'] });

    const recovered: any[] = [];
    const unsubscribeRecovered = subscribe('streamer', (data) => recovered.push(data));
    expect(recovered.some((event) => event.type === 'chat' && event.id === 'message-1')).toBe(false);
    expect(recovered.some((event) => event.type === 'delete' && event.id === 'message-1')).toBe(true);
    unsubscribeRecovered();
  });

  it('prunes an author while retaining the author-delete tombstone for reconnecting overlays', async () => {
    const unsubscribeFirst = subscribe('streamer', () => {});
    await Promise.resolve();
    for (const id of ['m1', 'm2']) {
      fake.last.emit('CHAT', {
        common: { msgId: id },
        user: { userId: 'user-1', nickname: 'viewer' },
        content: id,
      });
    }
    fake.last.emit('CHAT', {
      common: { msgId: 'keep' },
      user: { userId: 'user-2', nickname: 'other' },
      content: 'keep',
    });
    unsubscribeFirst();
    fake.last.emit('IM_DELETE', { deleteUserIdsList: ['user-1'] });

    const recovered: any[] = [];
    const unsubscribeRecovered = subscribe('streamer', (data) => recovered.push(data));
    expect(recovered.filter((event) => event.type === 'chat').map((event) => event.id)).toEqual(['keep']);
    expect(recovered.some((event) => event.type === 'delete' && event.senderId === 'user-1')).toBe(true);
    unsubscribeRecovered();
  });
});

describe('TikTok shared-hub resource limits', () => {
  it('bounds channels atomically while keeping an existing channel admissible', async () => {
    const unsubscribes = Array.from({ length: TIKTOK_HUB_MAX_CHANNELS }, (_, index) => (
      subscribe(`streamer${index}`, () => {})
    ));
    expect(tiktokHubAggregateStats().activeChannels).toBe(TIKTOK_HUB_MAX_CHANNELS);
    expect(fake.instances).toHaveLength(TIKTOK_HUB_MAX_CHANNELS);

    const sameChannel = subscribe('streamer0', () => {});
    expect(tiktokHubAggregateStats().subscribers).toBe(TIKTOK_HUB_MAX_CHANNELS + 1);
    expect(() => subscribe('newstreamer', () => {})).toThrow(SharedSseCapacityError);
    expect(fake.instances).toHaveLength(TIKTOK_HUB_MAX_CHANNELS);

    unsubscribes[1]();
    await vi.advanceTimersByTimeAsync(TIKTOK_HUB_LINGER_MS);
    const replacement = subscribe('newstreamer', () => {});
    expect(tiktokHubAggregateStats().activeChannels).toBe(TIKTOK_HUB_MAX_CHANNELS);
    replacement();
    sameChannel();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('cannot exceed the channel cap under near-simultaneous admissions', async () => {
    const admissions = await Promise.allSettled(
      Array.from({ length: TIKTOK_HUB_MAX_CHANNELS + 8 }, async (_, index) => (
        subscribe(`parallel${index}`, () => {})
      )),
    );
    expect(admissions.filter((result) => result.status === 'fulfilled')).toHaveLength(
      TIKTOK_HUB_MAX_CHANNELS,
    );
    expect(admissions.filter((result) => result.status === 'rejected')).toHaveLength(8);
    expect(tiktokHubAggregateStats().activeChannels).toBe(TIKTOK_HUB_MAX_CHANNELS);
    expect(fake.instances).toHaveLength(TIKTOK_HUB_MAX_CHANNELS);
  });

  it('enforces and releases the per-channel subscriber limit idempotently', () => {
    const unsubscribes = Array.from(
      { length: TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL },
      () => subscribe('popular', () => {}),
    );
    expect(() => subscribe('popular', () => {})).toThrow(SharedSseCapacityError);
    expect(tiktokHubAggregateStats().subscribers).toBe(
      TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
    );

    unsubscribes[0]();
    unsubscribes[0]();
    const replacement = subscribe('popular', () => {});
    expect(tiktokHubAggregateStats().subscribers).toBe(
      TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
    );
    replacement();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('enforces and releases the provider-wide subscriber limit without new upstream work', () => {
    const unsubscribes: Array<() => void> = [];
    const channelCount = Math.ceil(
      TIKTOK_HUB_MAX_SUBSCRIBERS / TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL,
    );
    for (let channel = 0; channel < channelCount; channel += 1) {
      for (let subscriber = 0; subscriber < TIKTOK_HUB_MAX_SUBSCRIBERS_PER_CHANNEL; subscriber += 1) {
        if (unsubscribes.length >= TIKTOK_HUB_MAX_SUBSCRIBERS) break;
        unsubscribes.push(subscribe(`global${channel}`, () => {}));
      }
    }

    const upstreamCount = fake.instances.length;
    expect(tiktokHubAggregateStats().subscribers).toBe(TIKTOK_HUB_MAX_SUBSCRIBERS);
    expect(() => subscribe('globalextra', () => {})).toThrow(SharedSseCapacityError);
    expect(fake.instances).toHaveLength(upstreamCount);

    unsubscribes[0]();
    unsubscribes[0]();
    const replacement = subscribe('globalextra', () => {});
    expect(tiktokHubAggregateStats().subscribers).toBe(TIKTOK_HUB_MAX_SUBSCRIBERS);
    replacement();
    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it('owns one reconnect timer and prevents reconnect work after destruction', async () => {
    const unsubscribe = subscribe('streamer', () => {});
    await Promise.resolve();
    await Promise.resolve();
    const connection = fake.last;
    expect(connection.connectCalls).toBe(1);

    connection.emit('DISCONNECTED', {});
    connection.emit('DISCONNECTED', {});
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(connection.connectCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.connectCalls).toBe(2);

    connection.emit('DISCONNECTED', {});
    expect(vi.getTimerCount()).toBe(1);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(1); // linger only; reconnect was cancelled
    resetTikTokHubForTests();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connection.connectCalls).toBe(2);
  });
});
