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
          /* Event ids are the time in microseconds. */
          sequence:
            Date.parse('2026-10-15T00:00:00.000Z') * 1_000,
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
      'shares one upstream socket between subscribers and replays from just before the last id the browser saw',
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

        await vi.advanceTimersByTimeAsync(5_000);

        for (const id of ['two', 'three']) {
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
                      id,
                    }),
                },
              },
            },
          });
        }

        expect(
          first.filter(
            (event) =>
              event.type === 'event',
          ),
        ).toHaveLength(3);

        expect(
          second.filter(
            (event) =>
              event.type === 'event',
          ),
        ).toHaveLength(3);

        unsubscribeSecond();

        const replayed: any[] = [];
        const lastSeen = second.filter(
          (event) => event.type === 'event',
        )[1].sequence;

        /* The browser saw up to "two": it gets "three", and again what came
           within the replay margin before it ("two"), not "one" (5 s
           earlier). */
        const unsubscribeReplay =
          subscribeKickRealtime(
            7,
            700,
            (data) => {
              replayed.push(data);
            },
            lastSeen,
          );

        expect(
          replayed
            .filter(
              (event) =>
                event.type === 'event',
            )
            .map((event) => [
              event.sequence - lastSeen,
              event.data.id,
            ]),
        ).toEqual([
          [0, 'two'],
          [1, 'three'],
        ]);

        expect(
          FakeWebSocket.instances,
        ).toHaveLength(1);

        unsubscribeReplay();
        unsubscribeFirst();
      },
    );

    it(
      'resumes on another hub (the other server copy after a deploy) from an id the first gave out',
      async () => {
        /* One hub as the old copy, then a fresh one as the new copy. */
        const hubMessage = (socket: FakeWebSocket, id: string) =>
          socket.message({
            push: {
              channel: 'chatrooms.700.v2',
              pub: {
                data: {
                  event: 'App\\Events\\ChatMessageEvent',
                  data: JSON.stringify({ id }),
                },
              },
            },
          });
        const ready = async () => {
          await flush();
          const socket = FakeWebSocket.instances.at(-1)!;
          socket.open();
          socket.message({ id: 1, connect: { ttl: 2700, ping: 25, pong: true } });
          socket.message({ id: 2, subscribe: {} });
          return socket;
        };

        const seen: any[] = [];
        const leaveOld = subscribeKickRealtime(7, 700, (data) => seen.push(data));
        const oldSocket = await ready();
        hubMessage(oldSocket, 'before');
        const lastSeen = seen.filter((event) => event.type === 'event').at(-1).sequence;
        leaveOld();
        resetKickRealtimeHubForTests();

        /* The new copy opened the chat before the overlay arrived, and heard
           "gap" while the overlay was moving. */
        await vi.advanceTimersByTimeAsync(1_000);
        const holdOpen = subscribeKickRealtime(7, 700, () => {});
        const newSocket = await ready();
        hubMessage(newSocket, 'gap');

        const resumed: any[] = [];
        const unsubscribe = subscribeKickRealtime(7, 700, (data) => resumed.push(data), lastSeen);
        expect(
          resumed.filter((event) => event.type === 'event').map((event) => event.data.id),
        ).toEqual(['gap']);
        expect(
          resumed.find((event) => event.type === 'event').sequence,
        ).toBeGreaterThan(lastSeen);

        unsubscribe();
        holdOpen();
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
