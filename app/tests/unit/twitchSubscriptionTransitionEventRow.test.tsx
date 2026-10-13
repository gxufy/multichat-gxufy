import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  cleanup,
  render,
} from '@testing-library/react';

import ChatOverlay from '@/components/overlay/ChatOverlay';

import {
  MultichatQuerySchema,
} from '@/lib/multichatConfig';

import type {
  ParsedMessage,
} from '@/lib/kick';

vi.mock(
  'next/head',
  () => ({
    default: ({
      children,
    }: {
      children:
        React.ReactNode;
    }) => <>{children}</>,
  }),
);

afterEach(cleanup);

const config =
  MultichatQuerySchema.parse({
    twitch:
      'channel',
    animation:
      'none',
    sourceTag:
      'none',
  });

function transition():
  ParsedMessage {
  return {
    id:
      'transition-test',
    platform:
      'twitch',
    senderId:
      'viewer',
    kind:
      'system',
    category:
      'subscription',
    timestamp:
      1,
    twitchSubscriptionTransition: {
      type:
        'standard-pay-forward',
      priorGifterDisplayName:
        'OriginalGifter',
      recipientDisplayName:
        'NextViewer',
    },
    raw: {
      platform:
        'twitch',
      id:
        'transition-test',
      senderId:
        'viewer',
      username:
        'PayForwarder',
      color:
        '#53fc18',
      badges:
        [],
      text:
        '',
      emotes:
        [],
      timestamp:
        1,
      kind:
        'system',
      category:
        'subscription',
      twitchSubscriptionTransition: {
        type:
          'standard-pay-forward',
        priorGifterDisplayName:
          'OriginalGifter',
        recipientDisplayName:
          'NextViewer',
      },
    },
    identity: {
      username:
        'PayForwarder',
      color:
        '#53fc18',
      background:
        '',
      filter:
        '',
      badges:
        [],
    },
    message:
      [],
  };
}

describe(
  'Twitch subscription transition row',
  () => {
    it(
      'keeps the username primary and renders pay-forward context',
      () => {
        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              transition(),
            ]}
            fadingIds={
              new Set<string>()
            }
            pinnedMessage={
              null
            }
            showLoader={
              false
            }
          />,
        );

        const row =
          container.querySelector(
            '[data-testid="twitch-subscription-transition-row"]',
          );

        expect(row).toBeTruthy();

        expect(
          row?.textContent,
        ).toContain(
          'PayForwarder',
        );

        expect(
          row?.textContent,
        ).toContain(
          'paid the gift forward',
        );

        expect(
          row?.textContent,
        ).toContain(
          'NextViewer',
        );

        expect(
          row?.textContent,
        ).toContain(
          'OriginalGifter',
        );

        expect(
          row?.classList.contains(
            'gx-event-strip',
          ),
        ).toBe(true);

        expect(
          row?.querySelector(
            '.gx-event-icon-svg',
          ),
        ).toBeTruthy();

        expect(
          row?.querySelector(
            '.gx-sub-plan',
          ),
        ).toBeNull();
      },
    );
  },
);
