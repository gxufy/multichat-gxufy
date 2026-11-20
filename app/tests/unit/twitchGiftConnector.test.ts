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

function setup() {
  const messages:
    UnifiedMessage[] = [];

  const updates:
    UnifiedMessage[] = [];

  const deletes:
    Array<{ id?: string }> = [];

  const connector =
    createTwitchConnector({
      channel:
        'streamer',
      onMessage:
        (message) =>
          messages.push(
            message,
          ),
      onMessageUpdate:
        (message) =>
          updates.push(
            message,
          ),
      onDelete:
        (event) =>
          deletes.push(
            event,
          ),
      onStatus:
        vi.fn(),
    });

  connector.start();

  FakeSocket.last!.onopen?.();

  return {
    connector,
    messages,
    updates,
    deletes,
  };
}

describe(
  'anonymous Twitch gift events',
  () => {
    it(
      'parses a standalone gift recipient',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=sub-gifter/1;color=#FF7F50;display-name=GiftKing;id=gift-1;login=giftking;msg-id=subgift;msg-param-recipient-display-name=LuckyViewer;msg-param-recipient-id=55;msg-param-recipient-user-name=luckyviewer;msg-param-sub-plan=1000;tmi-sent-ts=1;user-id=9 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(messages).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          id:
            'gift-1',
          category:
            'gift',
          twitchGift: {
            type:
              'gift',
            anonymous:
              false,
            plan:
              '1000',
            count:
              1,
            recipient: {
              displayName:
                'LuckyViewer',
              username:
                'luckyviewer',
              userId:
                '55',
            },
          },
        });

        connector.stop();
      },
    );

    it(
      'collapses community gift children into the announcement row',
      () => {
        const {
          connector,
          messages,
          updates,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=sub-gifter/10;color=#A970FF;display-name=GiftBoss;id=bomb-1;login=giftboss;msg-id=submysterygift;msg-param-mass-gift-count=5;msg-param-origin-id=origin-1;msg-param-sender-count=120;msg-param-sub-plan=1000;tmi-sent-ts=1;user-id=10 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=sub-gifter/10;color=#A970FF;display-name=GiftBoss;id=child-1;login=giftboss;msg-id=subgift;msg-param-origin-id=origin-1;msg-param-recipient-display-name=ViewerOne;msg-param-recipient-id=20;msg-param-recipient-user-name=viewerone;msg-param-sub-plan=1000;tmi-sent-ts=2;user-id=10 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=sub-gifter/10;color=#A970FF;display-name=GiftBoss;id=child-2;login=giftboss;msg-id=subgift;msg-param-origin-id=origin-1;msg-param-recipient-display-name=ViewerTwo;msg-param-recipient-id=21;msg-param-recipient-user-name=viewertwo;msg-param-sub-plan=1000;tmi-sent-ts=3;user-id=10 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(messages).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          id:
            'bomb-1',
          twitchGift: {
            type:
              'community',
            count:
              5,
            senderCount:
              120,
            originId:
              'origin-1',
          },
        });

        expect(
          updates,
        ).toHaveLength(2);

        expect(
          updates[1]
            .twitchGift
            ?.recipients,
        ).toEqual([
          {
            displayName:
              'ViewerOne',
            username:
              'viewerone',
            userId:
              '20',
          },
          {
            displayName:
              'ViewerTwo',
            username:
              'viewertwo',
            userId:
              '21',
          },
        ]);

        connector.stop();
      },
    );

    it(
      'labels anonymous gift notices without inventing an identity',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=;color=;id=anon-1;msg-id=anonsubgift;msg-param-recipient-display-name=Viewer;msg-param-recipient-id=44;msg-param-recipient-user-name=viewer;msg-param-sub-plan=Prime;tmi-sent-ts=4 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(messages).toHaveLength(1);

        expect(
          messages[0],
        ).toMatchObject({
          username:
            'Anonymous',
          senderId:
            '',
          twitchGift: {
            type:
              'gift',
            anonymous:
              true,
            plan:
              'Prime',
          },
        });

        connector.stop();
      },
    );
  },
);