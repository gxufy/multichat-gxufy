import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createTwitchConnector,
} from '@/lib/connectors/twitch';

import type {
  UnifiedMessage,
} from '@/lib/types';

class FakeSocket {
  static last:
    FakeSocket | null =
    null;

  onopen:
    (() => void) | null =
    null;

  onmessage:
    ((
      event: {
        data: string;
      },
    ) => void) | null =
    null;

  onclose:
    (() => void) | null =
    null;

  onerror:
    (() => void) | null =
    null;

  sent:
    string[] = [];

  constructor(
    readonly url:
      string,
  ) {
    FakeSocket.last =
      this;
  }

  send(
    value: string,
  ) {
    this.sent.push(value);
  }

  close() {}
}

beforeEach(() => {
  FakeSocket.last =
    null;

  vi.stubGlobal(
    'WebSocket',
    FakeSocket,
  );

  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: false,
        }) as Response,
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(
  'anonymous Twitch Bits connector',
  () => {
    it(
      'turns an IRC bits tag into an animated no-auth cheer event immediately',
      () => {
        const messages:
          UnifiedMessage[] = [];

        const connector =
          createTwitchConnector({
            channel:
              'streamer',
            onMessage:
              (message) =>
                messages.push(
                  message,
                ),
            onDelete:
              vi.fn(),
            onStatus:
              vi.fn(),
          });

        connector.start();

        const socket =
          FakeSocket.last!;

        socket.onopen?.();

        socket.onmessage?.({
          data:
            '@badges=;bits=100;display-name=Viewer;color=#9C3EE8;id=bits-1;user-id=9 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #streamer :Cheer100 this is clean\r\n',
        });

        expect(
          messages,
        ).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          id:
            'bits-1',
          kind:
            'system',
          category:
            'cheer',
          text:
            'Cheer100 this is clean',
          twitchCheer: {
            bits:
              100,
            cheermotes: [
              {
                tierMinBits:
                  100,
                color:
                  '#9c3ee8',
                animatedUrl:
                  'https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/100/1.gif',
              },
            ],
          },
        });

        expect(
          messages[0]
            .emotes[0],
        ).toMatchObject({
          text:
            'Cheer100',
          kind:
            'cheermote',
        });

        connector.stop();
      },
    );
  },
);