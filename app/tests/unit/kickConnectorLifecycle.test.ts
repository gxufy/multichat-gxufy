import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector } from '@/lib/types';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.({
      data: JSON.stringify(data),
    });
  }

  fail() {
    this.onerror?.();
  }
}

vi.mock('@/lib/kick', async (importOriginal) => ({
  ...((await importOriginal()) as object),

  getKickChannel: vi.fn(async (channel: string) => ({
    id: channel === 'second' ? 8 : 7,
    user_id: channel === 'second' ? 88 : 77,
    slug: channel,
    chatroom: {
      id: channel === 'second' ? 800 : 700,
    },
    user: {
      id: channel === 'second' ? 88 : 77,
      username: channel,
    },
    subscriber_badges: [],
  })),
}));

const connectors: Connector[] = [];

function kickChatEnvelope(
  id: string,
  text = 'hello',
) {
  return {
    type: 'event',
    sequence: 1,
    channel: 'chatrooms.700.v2',
    event: 'App\\Events\\ChatMessageEvent',
    data: {
      id,
      content: text,
      type: 'message',
      created_at: new Date(Date.now()).toISOString(),
      sender: {
        id: 42,
        username: 'Viewer',
        slug: 'viewer',
        identity: {
          color: '#fff',
          badges: [],
          badges_v2: [],
        },
      },
    },
  };
}

async function startConnector(
  channel = 'streamer',
) {
  const {
    createKickConnector,
  } = await import('@/lib/connectors/kick');

  const onMessage = vi.fn();
  const onDelete = vi.fn();
  const onPin = vi.fn();
  const onStatus = vi.fn();

  const connector = createKickConnector({
    channel,
    onMessage,
    onDelete,
    onPin,
    onStatus,
  });

  connectors.push(connector);

  connector.start();

  await vi.advanceTimersByTimeAsync(0);

  const eventSource =
    FakeEventSource.instances.at(-1);

  expect(eventSource).toBeDefined();

  return {
    connector,
    eventSource: eventSource!,
    onMessage,
    onDelete,
    onPin,
    onStatus,
  };
}

beforeEach(() => {
  vi.useFakeTimers();

  vi.setSystemTime(
    new Date(
      '2026-10-15T00:00:00.000Z',
    ),
  );

  FakeEventSource.instances = [];

  vi.stubGlobal(
    'EventSource',
    FakeEventSource,
  );

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          messages: [],
        },
      }),
    } as Response)),
  );
});

afterEach(() => {
  for (
    const connector of
    connectors.splice(0)
  ) {
    connector.stop();
  }

  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe(
  'Kick connector EventSource lifecycle',
  () => {
    it(
      'creates only one realtime transport when start is requested repeatedly',
      async () => {
        const {
          createKickConnector,
        } = await import(
          '@/lib/connectors/kick'
        );

        const connector =
          createKickConnector({
            channel: 'streamer',
            onMessage: vi.fn(),
            onDelete: vi.fn(),
            onPin: vi.fn(),
            onStatus: vi.fn(),
          });

        connectors.push(connector);

        connector.start();
        connector.start();

        await vi.advanceTimersByTimeAsync(
          0,
        );

        expect(
          FakeEventSource.instances,
        ).toHaveLength(1);
      },
    );

    it(
      'uses the resolved channel and chatroom ids in the realtime SSE URL',
      async () => {
        const {
          eventSource,
        } =
          await startConnector();

        expect(
          eventSource.url,
        ).toBe(
          '/api/kick/realtime?channelId=7&chatroomId=700',
        );
      },
    );

    it(
      'forwards realtime status and chat events',
      async () => {
        const {
          eventSource,
          onMessage,
          onStatus,
        } =
          await startConnector();

        eventSource.emit({
          type: 'status',
          status: 'connected',
          detail:
            'Kick chat connected',
        });

        eventSource.emit(
          kickChatEnvelope(
            'kick-live-1',
          ),
        );

        await vi.advanceTimersByTimeAsync(
          0,
        );

        expect(
          onStatus,
        ).toHaveBeenLastCalledWith(
          'connected',
          'Kick chat connected',
        );

        expect(
          onMessage,
        ).toHaveBeenCalledTimes(1);

        expect(
          onMessage.mock.calls[0][0],
        ).toMatchObject({
          platform: 'kick',
          id: 'kick-live-1',
          senderId: '42',
          senderUsername: 'viewer',
          username: 'Viewer',
          text: 'hello',
        });
      },
    );

    it(
      'leaves reconnect ownership to native EventSource after an SSE error',
      async () => {
        const {
          eventSource,
          onStatus,
        } =
          await startConnector();

        eventSource.fail();

        await vi.advanceTimersByTimeAsync(
          30_000,
        );

        expect(
          eventSource.closed,
        ).toBe(false);

        expect(
          FakeEventSource.instances,
        ).toHaveLength(1);

        expect(
          onStatus,
        ).toHaveBeenLastCalledWith(
          'connecting',
          'Kick chat reconnecting',
        );
      },
    );

    it(
      'deduplicates a replayed realtime message id',
      async () => {
        const {
          eventSource,
          onMessage,
        } =
          await startConnector();

        const event =
          kickChatEnvelope(
            'kick-duplicate',
          );

        eventSource.emit(event);
        eventSource.emit(event);

        await vi.advanceTimersByTimeAsync(
          0,
        );

        expect(
          onMessage,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      'stop closes the EventSource, ignores stale events, and is idempotent',
      async () => {
        const {
          connector,
          eventSource,
          onMessage,
        } =
          await startConnector();

        connector.stop();
        connector.stop();

        eventSource.emit(
          kickChatEnvelope(
            'kick-after-stop',
          ),
        );

        await vi.advanceTimersByTimeAsync(
          30_000,
        );

        expect(
          eventSource.closed,
        ).toBe(true);

        expect(
          onMessage,
        ).not.toHaveBeenCalled();

        expect(
          FakeEventSource.instances,
        ).toHaveLength(1);
      },
    );

    it(
      'keeps stale events isolated from a replacement connector instance',
      async () => {
        const first =
          await startConnector(
            'first',
          );

        first.connector.stop();

        const second =
          await startConnector(
            'second',
          );

        first.eventSource.emit(
          kickChatEnvelope(
            'stale-first',
          ),
        );

        second.eventSource.emit({
          ...kickChatEnvelope(
            'live-second',
          ),
          channel:
            'chatrooms.800.v2',
        });

        await vi.advanceTimersByTimeAsync(
          0,
        );

        expect(
          first.onMessage,
        ).not.toHaveBeenCalled();

        expect(
          second.onMessage,
        ).toHaveBeenCalledTimes(1);

        expect(
          FakeEventSource.instances,
        ).toHaveLength(2);
      },
    );
  },
);
