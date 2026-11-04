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

function base(
  id: string,
): Omit<
  ParsedMessage,
  | 'category'
  | 'message'
> {
  return {
    id,
    platform:
      'twitch',
    senderId:
      'viewer',
    kind:
      'system',
    timestamp:
      1,
    raw: {
      platform:
        'twitch',
      id,
      senderId:
        'viewer',
      username:
        'EventViewer',
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
    },
    identity: {
      username:
        'EventViewer',
      color:
        '#a970ff',
      background:
        '',
      filter:
        '',
      badges:
        [],
    },
  };
}

describe(
  'Twitch announcement and milestone rows',
  () => {
    it(
      'renders a broadcaster announcement with the message underneath',
      () => {
        const message:
          ParsedMessage = {
          ...base(
            'announcement',
          ),
          category:
            'announcement',
          twitchAnnouncement: {
            color:
              'PURPLE',
          },
          message: [
            'Big announcement tonight!',
          ],
        };

        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              message,
            ]}
            fadingIds={
              new Set<string>()
            }
            showLoader={
              false
            }
          />,
        );

        expect(
          container.querySelector(
            '[data-testid="twitch-announcement-row"]',
          ),
        ).toBeTruthy();

        expect(
          container.querySelector(
            '[data-testid="twitch-announcement-row"]',
          )?.classList.contains(
            'gx-event-strip',
          ),
        ).toBe(true);

        expect(
          container.querySelector(
            '[data-testid="twitch-announcement-row"] .gx-event-icon-svg',
          ),
        ).toBeTruthy();

        expect(
          container.textContent,
        ).toContain(
          'EventViewer',
        );

        expect(
          container.textContent,
        ).toContain(
          'Big announcement tonight!',
        );
      },
    );

    it(
      'renders watch streak value and points',
      () => {
        const message:
          ParsedMessage = {
          ...base(
            'milestone',
          ),
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
          message:
            [],
        };

        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              message,
            ]}
            fadingIds={
              new Set<string>()
            }
            showLoader={
              false
            }
          />,
        );

        expect(
          container.textContent,
        ).toContain(
          'watched 7 consecutive streams',
        );

        expect(
          container.textContent,
        ).toContain(
          '+450 points',
        );

        expect(
          container.querySelector(
            '[data-testid="twitch-milestone-row"]',
          )?.classList.contains(
            'gx-event-strip',
          ),
        ).toBe(true);
      },
    );
  },
);
