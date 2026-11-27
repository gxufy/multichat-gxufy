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

function start(
  messages:
    UnifiedMessage[],
) {
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

  return connector;
}

describe(
  'anonymous Twitch subscriptions',
  () => {
    it(
      'parses a new Tier 1 subscription with no user message',
      () => {
        const messages:
          UnifiedMessage[] = [];

        const connector =
          start(messages);

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=subscriber/1;color=#FF7F50;display-name=Viewer;id=sub-1;login=viewer;msg-id=sub;msg-param-cumulative-months=1;msg-param-sub-plan=1000;system-msg=Viewer\\ssubscribed\\sat\\sTier\\s1.;tmi-sent-ts=1;user-id=9 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(messages).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          id:
            'sub-1',
          kind:
            'system',
          category:
            'subscription',
          text:
            '',
          twitchSubscription: {
            type:
              'sub',
            plan:
              '1000',
            months:
              1,
          },
        });

        connector.stop();
      },
    );

    it(
      'keeps a resub comment separate from its metadata',
      () => {
        const messages:
          UnifiedMessage[] = [];

        const connector =
          start(messages);

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=subscriber/8;color=#A970FF;display-name=LongTimeViewer;emotes=;id=resub-1;login=longtimeviewer;msg-id=resub;msg-param-cumulative-months=8;msg-param-should-share-streak=1;msg-param-streak-months=3;msg-param-sub-plan=Prime;system-msg=LongTimeViewer\\ssubscribed\\sfor\\s8\\smonths!;tmi-sent-ts=2;user-id=10 :tmi.twitch.tv USERNOTICE #streamer :still here after all this time',
        });

        expect(messages).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          id:
            'resub-1',
          text:
            'still here after all this time',
          category:
            'subscription',
          twitchSubscription: {
            type:
              'resub',
            plan:
              'Prime',
            months:
              8,
            streakMonths:
              3,
          },
        });

        connector.stop();
      },
    );
  },
);