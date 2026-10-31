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

function message():
  ParsedMessage {
  return {
    id:
      'twitch:resub-test',
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
    raw: {
      platform:
        'twitch',
      id:
        'resub-test',
      senderId:
        'viewer',
      username:
        'LongTimeViewer',
      color:
        '#a970ff',
      badges:
        [],
      text:
        'still here',
      emotes:
        [],
      timestamp:
        1,
      kind:
        'system',
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
    },
    identity: {
      username:
        'LongTimeViewer',
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
      ['still here'],
  };
}

describe(
  'Twitch subscription row',
  () => {
    it(
      'renders a compact natural sentence and keeps the resub comment below',
      () => {
        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              message(),
            ]}
            fadingIds={
              new Set<string>()
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
            '[data-testid="twitch-subscription-row"]',
          );

        expect(row).toBeTruthy();

        expect(
          row?.textContent,
        ).toContain(
          'LongTimeViewer',
        );

        expect(
          row?.textContent,
        ).toContain(
          'resubscribed for 8 months with Prime',
        );

        expect(
          row?.textContent,
        ).toContain(
          '3 month streak',
        );

        expect(
          row?.textContent,
        ).not.toContain(
          'PRIME',
        );

        expect(
          row?.textContent,
        ).toContain(
          'still here',
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

        const styleText =
          Array.from(
            container.querySelectorAll(
              'style',
            ),
          )
            .map((style) =>
              style.textContent ?? '',
            )
            .join('\n');

        expect(styleText).toContain(
          'border-radius: 0',
        );

        expect(styleText).not.toContain(
          'font-size: 1.65em',
        );

        expect(styleText).not.toContain(
          'gxSubShimmer',
        );
      },
    );
  },
);
