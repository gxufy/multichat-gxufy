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

function gift():
  ParsedMessage {
  return {
    id:
      'twitch:gift-test',
    platform:
      'twitch',
    senderId:
      'gifter',
    kind:
      'system',
    category:
      'gift',
    timestamp:
      1,
    twitchGift: {
      type:
        'community',
      anonymous:
        false,
      plan:
        '1000',
      count:
        5,
      senderCount:
        120,
      originId:
        'bomb',
      recipients: [
        {
          displayName:
            'ViewerOne',
          userId:
            '1',
        },
        {
          displayName:
            'ViewerTwo',
          userId:
            '2',
        },
      ],
    },
    raw: {
      platform:
        'twitch',
      id:
        'gift-test',
      senderId:
        'gifter',
      username:
        'GiftBoss',
      color:
        '#a970ff',
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
        'gift',
      twitchGift: {
        type:
          'community',
        anonymous:
          false,
        plan:
          '1000',
        count:
          5,
        senderCount:
          120,
        recipients: [
          {
            displayName:
              'ViewerOne',
          },
          {
            displayName:
              'ViewerTwo',
          },
        ],
      },
    },
    identity: {
      username:
        'GiftBoss',
      color:
        '#a970ff',
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
  'Twitch gift event row',
  () => {
    it(
      'keeps the gifter primary and shows the collapsed recipient progress',
      () => {
        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              gift(),
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
            sourceTagExplicit={
              true
            }
          />,
        );

        const row =
          container.querySelector(
            '[data-testid="twitch-gift-row"]',
          );

        expect(row).toBeTruthy();

        expect(
          row?.textContent,
        ).toContain(
          'GiftBoss',
        );

        expect(
          row?.textContent,
        ).toContain(
          'gifted 5 Tier 1 subs',
        );

        expect(
          row?.textContent,
        ).toContain(
          '120 total gifted',
        );

        expect(
          row?.textContent,
        ).toContain(
          '2 of 5 gifted to',
        );

        expect(
          row?.textContent,
        ).toContain(
          'ViewerOne',
        );

        expect(
          row?.textContent,
        ).toContain(
          'ViewerTwo',
        );

        expect(
          row?.classList.contains(
            'gx-event-strip',
          ),
        ).toBe(true);

        expect(
          row?.querySelector(
            '.gx-gift-plan',
          ),
        ).toBeNull();

        expect(
          row?.querySelector(
            '.gx-event-icon-svg',
          ),
        ).toBeTruthy();
      },
    );
  },
);
