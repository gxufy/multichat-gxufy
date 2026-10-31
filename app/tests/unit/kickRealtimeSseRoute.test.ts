import { EventEmitter } from 'node:events';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

const hub = vi.hoisted(() => ({
  subscribe:
    vi.fn(),
  unsubscribe:
    vi.fn(),
}));

vi.mock(
  '@/lib/server/kickRealtimeHub',
  () => ({
    subscribeKickRealtime:
      hub.subscribe,
  }),
);

import handler, {
  kickRealtimeAfterSequence,
  kickRealtimePositiveInteger,
  resetKickRealtimeSseAdmissionForTests,
} from '@/pages/api/kick/realtime';

import {
  SharedSseCapacityError,
} from '@/lib/server/sharedSseAdmission';

class MockRequest
  extends EventEmitter {
  method = 'GET';

  query:
    Record<
      string,
      string | string[]
    >;

  headers:
    NextApiRequest['headers'] = {};

  socket = {
    remoteAddress:
      '127.0.0.1',
  };

  constructor(
    query:
      Record<
        string,
        string | string[]
      >,
  ) {
    super();
    this.query = query;
  }
}

class MockResponse
  extends EventEmitter {
  statusCode = 200;
  body: unknown;

  headers =
    new Map<
      string,
      string
    >();

  chunks: string[] = [];

  writableEnded = false;

  setHeader(
    name: string,
    value:
      | string
      | number
      | readonly string[],
  ) {
    this.headers.set(
      name.toLowerCase(),
      String(value),
    );

    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.body = value;
    this.writableEnded = true;
    return this;
  }

  writeHead(
    code: number,
    headers:
      Record<string, string>,
  ) {
    this.statusCode = code;

    for (
      const [name, value]
      of Object.entries(headers)
    ) {
      this.setHeader(
        name,
        value,
      );
    }

    return this;
  }

  flushHeaders() {}

  write(value: string) {
    this.chunks.push(value);
    return true;
  }

  end() {
    if (
      this.writableEnded
    ) {
      return this;
    }

    this.writableEnded = true;
    this.emit('finish');

    return this;
  }
}

async function invoke(
  query:
    Record<
      string,
      string | string[]
    >,
  headers:
    NextApiRequest['headers'] = {},
) {
  const req =
    new MockRequest(query);

  req.headers = headers;

  const res =
    new MockResponse();

  await handler(
    req as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
  );

  return {
    req,
    res,
  };
}

beforeEach(() => {
  vi.useFakeTimers();

  hub.unsubscribe =
    vi.fn();

  hub.subscribe
    .mockReset()
    .mockImplementation(
      (
        _channelId,
        _chatroomId,
        send,
      ) => {
        send(
          {
            type: 'status',
            status:
              'connecting',
          },
          '{"type":"status","status":"connecting"}',
        );

        send(
          {
            type: 'event',
            sequence: 41,
            channel:
              'chatrooms.700.v2',
            event:
              'App\\Events\\ChatMessageEvent',
            data: {
              id: 'message-41',
            },
            receivedAt: 123,
          },
          '{"type":"event","sequence":41,"channel":"chatrooms.700.v2","event":"App\\\\Events\\\\ChatMessageEvent","data":{"id":"message-41"},"receivedAt":123}',
        );

        return hub.unsubscribe;
      },
    );

  resetKickRealtimeSseAdmissionForTests();
});

afterEach(() => {
  resetKickRealtimeSseAdmissionForTests();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe(
  'Kick realtime SSE route',
  () => {
    it(
      'validates positive integer ids and Last-Event-ID',
      () => {
        expect(
          kickRealtimePositiveInteger(
            '700',
          ),
        ).toBe(700);

        expect(
          kickRealtimePositiveInteger(
            '0',
          ),
        ).toBeNull();

        expect(
          kickRealtimePositiveInteger(
            '7x',
          ),
        ).toBeNull();

        expect(
          kickRealtimeAfterSequence({
            query: {
              after: '5',
            },
            headers: {},
          }),
        ).toBe(5);

        expect(
          kickRealtimeAfterSequence({
            query: {
              after: '5',
            },
            headers: {
              'last-event-id':
                '9',
            },
          }),
        ).toBe(9);
      },
    );

    it(
      'queues synchronous hub output until SSE headers are open and emits sequence ids',
      async () => {
        const {
          req,
          res,
        } = await invoke(
          {
            channelId: '7',
            chatroomId: '700',
          },
          {
            'last-event-id':
              '40',
          },
        );

        expect(
          res.statusCode,
        ).toBe(200);

        expect(
          res.headers.get(
            'content-type',
          ),
        ).toBe(
          'text/event-stream',
        );

        expect(
          hub.subscribe,
        ).toHaveBeenCalledWith(
          7,
          700,
          expect.any(Function),
          40,
        );

        expect(
          res.chunks,
        ).toEqual([
          'retry: 2000\n\n',
          'data: {"type":"status","status":"connecting"}\n\n',
          'id: 41\n',
          'data: {"type":"event","sequence":41,"channel":"chatrooms.700.v2","event":"App\\\\Events\\\\ChatMessageEvent","data":{"id":"message-41"},"receivedAt":123}\n\n',
        ]);

        expect(
          vi.getTimerCount(),
        ).toBe(1);

        req.emit('close');

        expect(
          hub.unsubscribe,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          vi.getTimerCount(),
        ).toBe(0);
      },
    );

    it(
      'rejects malformed ids before subscribing',
      async () => {
        const {
          res,
        } = await invoke({
          channelId: 'nope',
          chatroomId: '700',
        });

        expect(
          res.statusCode,
        ).toBe(400);

        expect(
          hub.subscribe,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'rejects unsupported methods before subscribing',
      async () => {
        const req =
          new MockRequest({
            channelId: '7',
            chatroomId: '700',
          });

        req.method = 'POST';

        const res =
          new MockResponse();

        await handler(
          req as unknown as NextApiRequest,
          res as unknown as NextApiResponse,
        );

        expect(
          res.statusCode,
        ).toBe(405);

        expect(
          res.headers.get(
            'allow',
          ),
        ).toBe('GET');

        expect(
          hub.subscribe,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'returns a retryable 503 when hub capacity is exhausted',
      async () => {
        hub.subscribe
          .mockImplementationOnce(
            () => {
              throw new SharedSseCapacityError(
                'channels',
              );
            },
          );

        const {
          res,
        } = await invoke({
          channelId: '7',
          chatroomId: '700',
        });

        expect(
          res.statusCode,
        ).toBe(503);

        expect(
          res.body,
        ).toEqual({
          error:
            'Kick stream temporarily unavailable.',
        });

        expect(
          res.headers.get(
            'retry-after',
          ),
        ).toBe('30');
      },
    );
  },
);
