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
    readonly url: string,
  ) {
    FakeSocket.last =
      this;
  }

  send(value: string) {
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
  'anonymous Twitch raid events',
  () => {
    it(
      'parses raider identity, viewer count, and profile art from USERNOTICE',
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

        FakeSocket.last!.onopen?.();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=;color=#FF4F91;display-name=RaidBoss;id=raid-1;login=raidboss;msg-id=raid;msg-param-displayName=RaidBoss;msg-param-login=raidboss;msg-param-profileImageURL=https://cdn.example/raidboss.png;msg-param-viewerCount=420;system-msg=420\\sraiders\\sfrom\\sRaidBoss\\sare\\shere!;tmi-sent-ts=1;user-id=55 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(messages).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          id:
            'raid-1',
          category:
            'raid',
          username:
            'RaidBoss',
          senderUsername:
            'raidboss',
          text:
            '',
          twitchRaid: {
            raiderLogin:
              'raidboss',
            raiderDisplayName:
              'RaidBoss',
            viewers:
              420,
            profileImageUrl:
              'https://cdn.example/raidboss.png',
          },
        });

        connector.stop();
      },
    );

    it(
      'falls back safely when optional raid art is absent',
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

        FakeSocket.last!.onopen?.();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=;color=;display-name=SmallRaider;id=raid-2;login=smallraider;msg-id=raid;msg-param-displayName=SmallRaider;msg-param-login=smallraider;msg-param-viewerCount=7;tmi-sent-ts=2 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0]
            .twitchRaid,
        ).toEqual({
          raiderLogin:
            'smallraider',
          raiderDisplayName:
            'SmallRaider',
          viewers:
            7,
        });

        connector.stop();
      },
    );
  },
);