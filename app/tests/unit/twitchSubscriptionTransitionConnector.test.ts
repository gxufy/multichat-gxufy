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
      onPin:
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
  'Twitch subscription transition notices',
  () => {
    it(
      'parses Prime to paid upgrade',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=subscriber/1;color=#A970FF;display-name=PrimeViewer;id=u1;login=primeviewer;msg-id=primepaidupgrade;msg-param-sub-plan=1000;system-msg=PrimeViewer\\sconverted\\sfrom\\sa\\sPrime\\ssub\\sto\\sa\\sTier\\s1\\ssub!;tmi-sent-ts=1;user-id=1 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          category:
            'subscription',
          twitchSubscriptionTransition: {
            type:
              'prime-paid-upgrade',
            plan:
              '1000',
          },
        });

        connector.stop();
      },
    );

    it(
      'parses gift paid upgrade and original gifter',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=subscriber/1;color=#FF7F50;display-name=GiftReceiver;id=u2;login=giftreceiver;msg-id=giftpaidupgrade;msg-param-sender-login=giftboss;msg-param-sender-name=GiftBoss;msg-param-promo-name=Subtember;msg-param-promo-gift-total=5;tmi-sent-ts=2;user-id=2 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          twitchSubscriptionTransition: {
            type:
              'gift-paid-upgrade',
            priorGifterDisplayName:
              'GiftBoss',
            promoName:
              'Subtember',
            promoGiftTotal:
              5,
          },
        });

        connector.stop();
      },
    );

    it(
      'parses standard pay forward recipient and original gifter',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=subscriber/1;color=#53FC18;display-name=PayForwarder;id=u3;login=payforwarder;msg-id=standardpayforward;msg-param-prior-gifter-anonymous=false;msg-param-prior-gifter-display-name=OriginalGifter;msg-param-prior-gifter-id=20;msg-param-recipient-display-name=NextViewer;msg-param-recipient-id=21;tmi-sent-ts=3;user-id=3 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          twitchSubscriptionTransition: {
            type:
              'standard-pay-forward',
            priorGifterDisplayName:
              'OriginalGifter',
            recipientDisplayName:
              'NextViewer',
          },
        });

        connector.stop();
      },
    );

    it(
      'does not expose an anonymous prior gifter on community pay forward',
      () => {
        const {
          connector,
          messages,
        } = setup();

        FakeSocket.last!.onmessage?.({
          data:
            '@badges=subscriber/1;color=#38BDF8;display-name=CommunityForwarder;id=u4;login=communityforwarder;msg-id=communitypayforward;msg-param-prior-gifter-anonymous=true;msg-param-prior-gifter-display-name=ShouldNotShow;tmi-sent-ts=4;user-id=4 :tmi.twitch.tv USERNOTICE #streamer\r\n',
        });

        expect(
          messages[0],
        ).toMatchObject({
          twitchSubscriptionTransition: {
            type:
              'community-pay-forward',
            priorGifterAnonymous:
              true,
          },
        });

        expect(
          messages[0]
            .twitchSubscriptionTransition
            ?.priorGifterDisplayName,
        ).toBeUndefined();

        connector.stop();
      },
    );
  },
);