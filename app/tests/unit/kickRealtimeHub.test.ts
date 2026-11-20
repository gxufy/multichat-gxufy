import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  kickRealtimeHubStats,
  resetKickRealtimeHubForTests,
  setKickRealtimeWebSocketCtorForTests,
  subscribeKickRealtime,
} from '@/lib/server/kickRealtimeHub';

type Listener = (...args: any[]) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];

  private handlers =
    new Map<string, Listener[]>();

  constructor(
    readonly url: string,
    readonly options?: {
      origin?: string;
      handshakeTimeout?: number;
    },
  ) {
    FakeWebSocket.instances.push(this);
  }

  on(
    event: string,
    listener: Listener,
  ) {
    const current =
      this.handlers.get(event) ?? [];

    current.push(listener);
    this.handlers.set(
      event,
      current,
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(
    code = 1000,
    reason = '',
  ) {
    if (this.readyState === 3) return;

    this.readyState = 3;

    this.emit(
      'close',
      code,
      {
        toString: () => reason,
      },
    );
  }

  terminate() {
    this.close(
      1006,
      'terminated',
    );
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  message(value: unknown) {
    const serialized =
      typeof value === 'string'
        ? value
        : JSON.stringify(value);

    this.emit(
      'message',
      serialized,
    );
  }

  private emit(
    event: string,
    ...args: any[]
  ) {
    for (
      const listener of
      this.handlers.get(event) ?? []
    ) {
      listener(...args);
    }
  }
}

function response(
  value: unknown,
): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

function makeFetchMock() {
  let tokenNumber = 0;

  return vi.fn(
    async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url =
        String(input);

      if (
        url.includes(
          '/realtime/auth/connection',
        )
      ) {
        tokenNumber += 1;

        return response({
          data: {
            token:
              `token-${tokenNumber}`,
          },
        });
      }

      if (
        url.includes(
          '/realtime/channels/7/chat/connection',
        )
      ) {
        return response({
          data: {
            connections: [
              {
                provider:
                  'centrifugo',
                credentials: {
                  url:
                    'wss://realtime.us-east-1.platform.kick.com/connection/websocket',
                },
              },
            ],
            mode: 'websocket',
          },
          message: 'success',
        });
      }

      if (
        url.endsWith(
          '/api/v1/realtime/connection',
        )
      ) {
        return response({
          data: {
            connections: [
              {
                provider:
                  'centrifugo',
                credentials: {
                  url:
                    'wss://realtime.us-west-2.platform.kick.com/connection/websocket',
                },
              },
            ],
            mode: 'websocket',
          },
          message: 'success',
        });
      }

      throw new Error(
        `Unexpected fetch: ${url} ${init?.method ?? ''}`,
      );
    },
  );
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

function parseSent(
  socket: FakeWebSocket,
) {
  return socket.sent.map(
    (value) =>
      JSON.parse(value),
  );
}

beforeEach(() => {
  vi.useFakeTimers();

  vi.setSystemTime(
    new Date(
      '2026-10-15T00:00:00.000Z',
    ),
  );

  FakeWebSocket.instances = [];

  resetKickRealtimeHubForTests();

  setKickRealtimeWebSocketCtorForTests(
    FakeWebSocket as any,
  );

  vi.stubGlobal(
    'fetch',
    makeFetchMock(),
  );
});

afterEach(() => {
  resetKickRealtimeHubForTests();

  setKickRealtimeWebSocketCtorForTests(
    null,
  );

  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe(
  'Kick Centrifugo realtime hub',
  () => {
    it(
      'negotiates, authenticates, subscribes to every Kick feed, and decodes publications',
      async () => {
        const received: any[] = [];

        const unsubscribe =
          subscribeKickRealtime(
            7,
            700,
            (
              data,
              _serialized,
            ) => {
              received.push(data);
            },
          );

        await flush();

        expect(
          FakeWebSocket.instances,
        ).toHaveLength(1);

        const socket =
          FakeWebSocket.instances[0];

        expect(socket.url).toBe(
          'wss://realtime.us-east-1.platform.kick.com/connection/websocket',
        );

        expect(
          socket.options?.origin,
        ).toBe(
          'https://kick.com',
        );

        socket.open();

        expect(
          parseSent(socket)[0],
        ).toEqual({
          id: 1,
          connect: {
            token: 'token-1',
            name: 'js',
          },
        });

        socket.message({
          id: 1,
          connect: {
            client: 'client-1',
            version:
              '6.9.7 PRO',
            expires: true,
            ttl: 120,
            ping: 25,
            pong: true,
          },
        });

        const subscriptions =
          parseSent(socket)
            .filter(
              (frame) =>
                frame.subscribe,
            )
            .map(
              (frame) =>
                frame.subscribe.channel,
            );

        expect(
          subscriptions,
        ).toEqual([
          'chatrooms.700.v2',
          'chatroom_700',
          'channel_7',
          'chatrooms.700',
          'channel.7',
        ]);

        socket.message({
          id: 2,
          subscribe: {},
        });

        expect(
          received.at(-1),
        ).toMatchObject({
          type: 'status',
          status: 'connected',
        });

        socket.message({
          push: {
            channel:
              'chatrooms.700.v2',
            pub: {
              data: {
                event:
                  'App\\Events\\ChatMessageEvent',
                data:
                  JSON.stringify({
                    id: 'message-1',
                    content:
                      '[emote:37226:KEKW]',
                    sender: {
                      id: 42,
                      username:
                        'Viewer',
                      slug:
                        'viewer',
                    },
                  }),
              },
            },
          },
        });

        expect(
          received.at(-1),
        ).toMatchObject({
          type: 'event',
          sequence: 1,
          channel:
            'chatrooms.700.v2',
          event:
            'App\\Events\\ChatMessageEvent',
          data: {
            id: 'message-1',
            content:
              '[emote:37226:KEKW]',
            sender: {
              id: 42,
              username:
                'Viewer',
              slug:
                'viewer',
            },
          },
        });

        const beforeHeartbeat =
          socket.sent.length;

        socket.message({});

        expect(
          socket.sent.length,
        ).toBe(
          beforeHeartbeat + 1,
        );

        expect(
          socket.sent.at(-1),
        ).toBe('{}');

        /*
         * ttl=120 schedules refresh halfway through the token life.
         */
        await vi.advanceTimersByTimeAsync(
          60_000,
        );

        await flush();

        const refresh =
          parseSent(socket).find(
            (frame) =>
              frame.refresh,
          );

        expect(
          refresh,
        ).toMatchObject({
          refresh: {
            token: 'token-2',
          },
        });

        unsubscribe();

        expect(
          kickRealtimeHubStats(),
        ).toMatchObject({
          activeChannels: 1,
          subscribers: 0,
          lingeringChannels: 1,
          bufferedEvents: 1,
        });
      },
    );

    it(
      'shares one upstream socket between subscribers and replays only missed sequence ids',
      async () => {
        const first: any[] = [];
        const second: any[] = [];

        const unsubscribeFirst =
          subscribeKickRealtime(
            7,
            700,
            (data) => {
              first.push(data);
            },
          );

        const unsubscribeSecond =
          subscribeKickRealtime(
            7,
            700,
            (data) => {
              second.push(data);
            },
          );

        await flush();

        expect(
          FakeWebSocket.instances,
        ).toHaveLength(1);

        const socket =
          FakeWebSocket.instances[0];

        socket.open();

        socket.message({
          id: 1,
          connect: {
            ttl: 2700,
            ping: 25,
            pong: true,
          },
        });

        socket.message({
          id: 2,
          subscribe: {},
        });

        socket.message({
          push: {
            channel:
              'chatrooms.700.v2',
            pub: {
              data: {
                event:
                  'App\\Events\\ChatMessageEvent',
                data:
                  JSON.stringify({
                    id: 'one',
                  }),
              },
            },
          },
        });

        socket.message({
          push: {
            channel:
              'chatrooms.700.v2',
            pub: {
              data: {
                event:
                  'App\\Events\\ChatMessageEvent',
                data:
                  JSON.stringify({
                    id: 'two',
                  }),
              },
            },
          },
        });

        expect(
          first.filter(
            (event) =>
              event.type === 'event',
          ),
        ).toHaveLength(2);

        expect(
          second.filter(
            (event) =>
              event.type === 'event',
          ),
        ).toHaveLength(2);

        unsubscribeSecond();

        const replayed: any[] = [];

        const unsubscribeReplay =
          subscribeKickRealtime(
            7,
            700,
            (data) => {
              replayed.push(data);
            },
            1,
          );

        expect(
          replayed.filter(
            (event) =>
              event.type === 'event',
          ),
        ).toEqual([
          expect.objectContaining({
            sequence: 2,
            data:
              expect.objectContaining({
                id: 'two',
              }),
          }),
        ]);

        expect(
          FakeWebSocket.instances,
        ).toHaveLength(1);

        unsubscribeReplay();
        unsubscribeFirst();
      },
    );

    it(
      'reconnects after an upstream websocket close',
      async () => {
        const unsubscribe =
          subscribeKickRealtime(
            7,
            700,
            () => {},
          );

        await flush();

        const first =
          FakeWebSocket.instances[0];

        first.open();

        first.message({
          id: 1,
          connect: {
            ttl: 2700,
            ping: 25,
            pong: true,
          },
        });

        first.message({
          id: 2,
          subscribe: {},
        });

        first.close(
          1006,
          'network lost',
        );

        expect(
          FakeWebSocket.instances,
        ).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(
          1_000,
        );

        await flush();

        expect(
          FakeWebSocket.instances,
        ).toHaveLength(2);

        unsubscribe();
      },
    );
  },
);
