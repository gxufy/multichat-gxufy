import { cleanup, render } from '@testing-library/react';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import ChatOverlay from '@/components/overlay/ChatOverlay';
import {
  buildParsedMessage,
  NO_COSMETICS,
} from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { UnifiedMessage } from '@/lib/types';

const config = MultichatQuerySchema.parse({
  twitch: 'gxufy',
  kick: 'gxufy',
  youtube: '@gxufy',
  tiktok: 'gxufy',
  animation: 'none',
  entryAnimation: 'none',
  showSystemMsgs: 'true',
});

function event(
  platform: UnifiedMessage['platform'],
  category: NonNullable<UnifiedMessage['category']>,
  text: string,
): UnifiedMessage {
  return {
    platform,
    id: `${platform}-${category}`,
    senderId: `${platform}-sender`,
    username: `${platform}Viewer`,
    color: platform === 'kick' ? '#53fc18' : '',
    badges: [],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'system',
    category,
  };
}

const rawEvents: UnifiedMessage[] = [
  {
    ...event('twitch', 'subscription', 'authored Twitch sub message'),
    color: '#0000FF',
    twitchSubscription: { type: 'sub', plan: 'Prime', months: 1 },
  },
  event('kick', 'gift', 'KickViewer gifted 5 subscriptions!'),
  event('youtube', 'cheer', 'YouTubeViewer sent a $25.00 Super Chat: Great stream!'),
  event('tiktok', 'follow', 'TikTokViewer shared the LIVE'),
];

function mount() {
  let head: ReactElement[] = [];
  const mentions = { enabled: true, colors: new Map<string, string>() };
  const parsed = rawEvents.map((message, index) => buildParsedMessage(
    message,
    config,
    NO_COSMETICS,
    mentions,
    index + 1,
  ));
  const view = render(
    <HeadManagerContext.Provider
      value={{
        updateHead: (items) => {
          head = items as ReactElement[];
        },
        mountedInstances: new Set(),
      }}
    >
      <ChatOverlay
        config={config}
        messages={parsed}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
        sourceTagExplicit
      />
    </HeadManagerContext.Provider>,
  );
  const css = head
    .filter((element) => element?.type === 'style')
    .map((element) => {
      const props = element.props as {
        children?: string;
        dangerouslySetInnerHTML?: { __html: string };
      };
      return props.dangerouslySetInnerHTML?.__html ?? props.children ?? '';
    })
    .join('\n')
    .replace(/\s+/g, ' ');

  return { ...view, css, parsed };
}

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

afterEach(cleanup);

describe('subtle multiplatform event strips', () => {
  it('uses one compact event-color wash without a black underlay or opaque card plate', () => {
    const { css } = mount();
    const base = cssBlock(css, '.gx-event-strip {');

    expect(base).toContain('border-left: .09em solid var(--gx-event-accent)');
    expect(base).toContain('background-image: linear-gradient');
    expect(base).toContain('color-mix(in srgb, var(--gx-event-accent) 18%, transparent) 0%');
    expect(base).toContain('color-mix(in srgb, var(--gx-event-accent) 10%, transparent) 35%');
    expect(base).toContain('transparent 75%');
    expect(base).toContain('color: rgba(255,255,255,.98)');
    expect(base).toContain('text-shadow: none');
    expect(base.match(/linear-gradient/g)).toHaveLength(1);
    expect(base).not.toContain('rgba(6,8,13');
    expect(base).not.toContain('border-top');
    expect(css).not.toContain('#0c0c0d');
    expect(css).not.toContain('rgba(13,12,20');
  });

  it('keeps the dedicated Twitch event test id and shared compact shell', () => {
    const { getByTestId } = mount();
    const twitch = getByTestId('twitch-subscription-row');
    const twitchRow = twitch.closest('.gx-message-row') as HTMLElement;

    expect(twitch.classList).toContain('gx-event-strip');
    expect(twitch.classList).toContain('gx-event-subscription');
    expect(twitch.textContent).toContain('authored Twitch sub message');
    expect(twitchRow.style.marginLeft).toBe('10px');
    expect(twitchRow.style.marginRight).toBe('30px');
  });

  it('routes Kick, YouTube, and TikTok system categories through the shared shell', () => {
    const { container, parsed } = mount();
    const expected = [
      ['kick', 'gift', 'gx-event-gift', 'gifted 5 subscriptions!'],
      ['youtube', 'cheer', 'gx-event-bits', 'sent a $25.00 Super Chat: Great stream!'],
      ['tiktok', 'follow', 'gx-event-follow', 'shared the LIVE'],
    ] as const;

    for (const [platform, category, className, authoredContent] of expected) {
      const row = container.querySelector(
        `[data-event-platform="${platform}"][data-event-category="${category}"]`,
      ) as HTMLElement;
      expect(row).not.toBeNull();
      expect(row.classList).toContain('gx-event-strip');
      expect(row.classList).toContain(className);
      const parsedEvent = parsed.find((message) => message.platform === platform);
      expect(parsedEvent?.category).toBe(category);
      expect(row.textContent).toContain(authoredContent);
    }

    const kickName = container.querySelector(
      '[data-event-platform="kick"] .gx-event-name',
    ) as HTMLElement;
    expect(kickName.textContent).toBe('kickViewer');
    expect(kickName.style.color).toBe('rgb(83, 252, 24)');
  });

  it('keeps sentences neutral while reserving event color for accents', () => {
    const { container, css } = mount();
    const action = cssBlock(css, '.gx-event-action {');
    const body = cssBlock(css, '.gx-event-body, .gx-event-subline {');
    const accent = cssBlock(css, '.gx-event-accent {');

    expect(action).toContain('color: rgba(255,255,255,.98)');
    expect(body).toContain('color: rgba(255,255,255,.96)');
    expect(body).toContain('opacity: 1');
    expect(accent).toContain('color: var(--gx-event-accent');

    const genericSentence = container.querySelector(
      '[data-event-platform="kick"] .gx-event-generic-text',
    ) as HTMLElement;
    expect(genericSentence.querySelector('.gx-reference-glyph-foreground'))
      .not.toBeNull();
    expect(genericSentence.closest('.gx-event-strip')?.classList)
      .toContain('gx-event-gift');
  });
});
