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

function cheerMessage():
  ParsedMessage {
  return {
    id:
      'twitch:cheer-test',
    platform:
      'twitch',
    senderId:
      'viewer-1',
    kind:
      'system',
    category:
      'cheer',
    timestamp: 1,
    twitchCheer: {
      bits: 1000,
      cheermotes: [
        {
          prefix:
            'Cheer',
          bits: 1000,
          tierMinBits:
            1000,
          color:
            '#1db2a5',
          animatedUrl:
            'https://cdn.example/cheer.gif',
          staticUrl:
            'https://cdn.example/cheer.png',
        },
      ],
    },
    raw: {
      platform:
        'twitch',
      id:
        'cheer-test',
      senderId:
        'viewer-1',
      username:
        'BigCheerer',
      color:
        '#ff7f50',
      badges: [],
      text:
        'Cheer1000 lets go',
      emotes: [],
      timestamp: 1,
      kind:
        'system',
      category:
        'cheer',
      twitchCheer: {
        bits: 1000,
        cheermotes: [
          {
            prefix:
              'Cheer',
            bits: 1000,
            tierMinBits:
              1000,
            color:
              '#1db2a5',
            animatedUrl:
              'https://cdn.example/cheer.gif',
            staticUrl:
              'https://cdn.example/cheer.png',
          },
        ],
      },
    },
    identity: {
      username:
        'BigCheerer',
      color:
        '#ff7f50',
      background: '',
      filter: '',
      badges: [],
    },
    message: [
      'Cheer1000 lets go',
    ],
  };
}

describe(
  'Twitch cheer event row',
  () => {
    it(
      'renders the chatter, authoritative Bits total, body, and animated official art',
      () => {
        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              cheerMessage(),
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
            '[data-testid="twitch-cheer-row"]',
          );

        expect(row).toBeTruthy();

        expect(
          row?.getAttribute(
            'data-cheer-bits',
          ),
        ).toBe('1000');

        expect(
          row?.textContent,
        ).toContain(
          'BigCheerer',
        );

        expect(
          row?.textContent,
        ).toContain(
          'cheered 1,000 bits',
        );

        const action = row?.querySelector(
          '.gx-cheer-amount',
        ) as HTMLElement;
        expect(action.style.color).toBe('');
        expect(
          action.querySelector(
            '.gx-event-accent',
          )?.textContent,
        ).toBe('1,000 bits');

        expect(
          row?.textContent,
        ).toContain(
          'Cheer1000 lets go',
        );

        expect(
          row?.querySelector(
            'img',
          )?.getAttribute(
            'src',
          ),
        ).toBe(
          'https://cdn.example/cheer.gif',
        );

        expect(
          row?.classList.contains(
            'gx-event-strip',
          ),
        ).toBe(true);

        expect(
          row?.querySelectorAll(
            '.gx-cheer-art img',
          ),
        ).toHaveLength(1);
      },
    );

    it(
      'honors hide-names without hiding the Bits amount',
      () => {
        const hidden =
          MultichatQuerySchema.parse({
            twitch:
              'channel',
            animation:
              'none',
            sourceTag:
              'none',
            hideNames:
              'true',
          });

        const {
          container,
        } = render(
          <ChatOverlay
            config={hidden}
            messages={[
              cheerMessage(),
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

        expect(
          container.textContent,
        ).not.toContain(
          'BigCheerer',
        );

        expect(
          container.textContent,
        ).toContain(
          'cheered 1,000 bits',
        );
      },
    );
  },
);
