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
    twitch: 'channel',
    animation: 'none',
    sourceTag: 'none',
  });

function hypeMessage(
  phase:
    | 'progress'
    | 'end',
  level: number,
  progress: number,
  goal: number,
): ParsedMessage {
  return {
    id:
      'twitch:hype-train',
    platform: 'twitch',
    senderId:
      'twitch-hype-train',
    kind: 'system',
    category:
      'hypetrain',
    timestamp: 1,
    hypeTrain: {
      phase,
      level,
      progress,
      goal,
      hideAfterMs: 5000,
    },
    raw: {
      platform: 'twitch',
      id: 'hype-train',
      senderId:
        'twitch-hype-train',
      username: 'Twitch',
      color: '#9147ff',
      badges: [],
      text: 'Hype Train',
      emotes: [],
      timestamp: 1,
      kind: 'system',
      category:
        'hypetrain',
      hypeTrain: {
        phase,
        level,
        progress,
        goal,
        hideAfterMs:
          5000,
      },
    },
    identity: {
      username: 'Twitch',
      color: '#9147ff',
      background: '',
      filter: '',
      badges: [],
    },
    message: [
      'Hype Train',
    ],
  };
}

describe(
  'Hype Train event row',
  () => {
    it(
      'renders progress and updates the same row',
      () => {
        const props = {
          config,
          fadingIds:
            new Set<string>(),
          showLoader: false,
          sourceTagExplicit:
            true,
        };

        const {
          container,
          rerender,
        } = render(
          <ChatOverlay
            {...props}
            messages={[
              hypeMessage(
                'progress',
                3,
                3600,
                5000,
              ),
            ]}
          />,
        );

        const row =
          container.querySelector(
            '[data-testid="hype-train-row"]',
          );

        expect(row).toBeTruthy();

        expect(
          row?.textContent,
        ).toContain(
          'HYPE TRAIN',
        );

        expect(
          row?.textContent,
        ).toContain(
          'LVL 3',
        );

        expect(
          row?.textContent,
        ).toContain(
          '72%',
        );

        expect(
          row?.textContent,
        ).toContain(
          '3,600 / 5,000',
        );

        expect(
          row?.textContent,
        ).toContain(
          '1,400 remaining',
        );

        rerender(
          <ChatOverlay
            {...props}
            messages={[
              hypeMessage(
                'progress',
                4,
                100,
                6000,
              ),
            ]}
          />,
        );

        expect(
          container.querySelectorAll(
            '[data-testid="hype-train-row"]',
          ),
        ).toHaveLength(1);

        expect(
          container.querySelector(
            '[data-hype-level="4"]',
          ),
        ).toBeTruthy();

        expect(
          container.textContent,
        ).toContain(
          'LVL 4',
        );
      },
    );

    it(
      'renders completion in that same event row',
      () => {
        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              hypeMessage(
                'end',
                5,
                7000,
                7000,
              ),
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

        expect(
          container.querySelectorAll(
            '[data-testid="hype-train-row"]',
          ),
        ).toHaveLength(1);

        expect(
          container.textContent,
        ).toContain(
          'HYPE TRAIN COMPLETE',
        );

        expect(
          container.textContent,
        ).toContain(
          'LVL 5',
        );
      },
    );
  },
);