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

function raid():
  ParsedMessage {
  return {
    id:
      'twitch:raid-test',
    platform:
      'twitch',
    senderId:
      'raider',
    kind:
      'system',
    category:
      'raid',
    timestamp:
      1,
    twitchRaid: {
      raiderLogin:
        'raidboss',
      raiderDisplayName:
        'RaidBoss',
      viewers:
        420,
      profileImageUrl:
        'https://cdn.example/raidboss.png',
    },
    raw: {
      platform:
        'twitch',
      id:
        'raid-test',
      senderId:
        'raider',
      username:
        'RaidBoss',
      color:
        '#ff4f91',
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
        'raid',
      twitchRaid: {
        raiderLogin:
          'raidboss',
        raiderDisplayName:
          'RaidBoss',
        viewers:
          420,
        profileImageUrl:
          'https://cdn.example/raidboss.png',
      },
    },
    identity: {
      username:
        'RaidBoss',
      color:
        '#ff4f91',
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
  'Twitch raid event row',
  () => {
    it(
      'keeps the raider name primary and the audience count secondary',
      () => {
        const {
          container,
        } = render(
          <ChatOverlay
            config={config}
            messages={[
              raid(),
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
            '[data-testid="twitch-raid-row"]',
          );

        expect(row).toBeTruthy();

        expect(
          row?.textContent,
        ).toContain(
          'RaidBoss',
        );

        expect(
          row?.textContent,
        ).toContain(
          'raided with 420 viewers',
        );

        expect(
          row?.querySelector(
            'img',
          )?.getAttribute(
            'src',
          ),
        ).toBe(
          'https://cdn.example/raidboss.png',
        );

        expect(
          row?.classList.contains(
            'gx-event-strip',
          ),
        ).toBe(true);
      },
    );

    it(
      'does not expose raider identity when hide names is enabled',
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
              raid(),
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
        ).not.toContain(
          'RaidBoss',
        );

        expect(
          container.textContent,
        ).toContain(
          '420 viewers',
        );

        expect(
          container.querySelector(
            'img.gx-raid-avatar',
          ),
        ).toBeNull();

        expect(
          container.querySelector(
            '.gx-raid-avatar-fallback .gx-event-icon-svg',
          ),
        ).toBeTruthy();
      },
    );
  },
);
