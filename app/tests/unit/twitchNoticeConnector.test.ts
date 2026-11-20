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

  constructor() {
    FakeSocket.last =
      this;
  }

  send() {}

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

function setup() {
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

  return {
    connector,
    messages,
  };
}

describe(
  'anonymous Twitch notice events',
  () => {
    it(
      'parses announcements with their Twitch color',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=broadcaster/1;color=#A970FF;display-name=Streamer;emotes=;id=a1;login=streamer;msg-id=announcement;msg-param-color=PURPLE;tmi-sent-ts=1;user-id=1 :tmi.twitch.tv USERNOTICE #streamer :Big announcement tonight!\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          category:
            'announcement',
          text:
            'Big announcement tonight!',
          twitchAnnouncement: {
            color:
              'PURPLE',
          },
        });

        connector.stop();
      },
    );

    it(
      'parses current viewermilestone watch streaks',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=;color=#1E90FF;display-name=Viewer;id=m1;login=viewer;msg-id=viewermilestone;msg-param-category=watch-streak;msg-param-value=7;msg-param-copoReward=450;tmi-sent-ts=2;user-id=2 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          category:
            'milestone',
          twitchMilestone: {
            type:
              'watch-streak',
            value:
              7,
            channelPoints:
              450,
          },
        });

        connector.stop();
      },
    );

    it(
      'parses Bits badge tier milestones',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=bits/10000;color=#38BDF8;display-name=Cheerer;id=m2;login=cheerer;msg-id=bitsbadgetier;msg-param-threshold=10000;tmi-sent-ts=3;user-id=3 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          twitchMilestone: {
            type:
              'bits-badge',
            value:
              10000,
          },
        });

        connector.stop();
      },
    );

    it(
      'parses 2026 modiversary notices and keeps the user message',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=moderator/1;color=#22C55E;display-name=ModHero;emotes=;id=m3;login=modhero;msg-id=modiversary;msg-param-months=36;tmi-sent-ts=4;user-id=4 :tmi.twitch.tv USERNOTICE #streamer :three years already!',
        });

        expect(
          messages[0],
        ).toMatchObject({
          category:
            'milestone',
          text:
            'three years already!',
          twitchMilestone: {
            type:
              'modiversary',
            value:
              36,
          },
        });

        connector.stop();
      },
    );
  },
);