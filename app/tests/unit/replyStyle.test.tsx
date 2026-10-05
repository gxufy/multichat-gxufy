import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { normalizeMultichatStyle } from '@/features/multichat/config';
import type { ParsedMessage } from '@/lib/kick';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_REPLY_STYLES,
  MultichatQuerySchema,
  buildMultichatQuery,
} from '@/lib/multichatConfig';

const channels = { kick: 'somechannel', twitch: '', youtube: '', tiktok: '' };

const replyMessage: ParsedMessage = {
  id: 'reply-message',
  platform: 'twitch',
  reply: {
    username: 'ParentUser',
    text: 'quoted message',
    messageId: 'parent-message',
  },
  identity: {
    username: 'ReplyGuy',
    color: '#9146ff',
    background: '',
    filter: '',
    badges: [],
  },
  message: ['answer'],
};

afterEach(cleanup);

function renderReply(replyStyle?: string) {
  const config = MultichatQuerySchema.parse({
    twitch: 'local',
    animation: 'none',
    ...(replyStyle ? { replyStyle } : {}),
  });
  return render(
    <ChatOverlay
      config={config}
      messages={[replyMessage]}
      fadingIds={new Set()}
      pinnedMessage={null}
      showLoader={false}
    />,
  );
}

describe('replyStyle config', () => {
  it('accepts full, mention, and off while defaulting invalid or missing values to full', () => {
    expect(MULTICHAT_REPLY_STYLES).toEqual(['full', 'mention', 'off']);
    expect(MultichatQuerySchema.parse({}).replyStyle).toBe('full');
    expect(MultichatQuerySchema.parse({ replyStyle: 'invalid' }).replyStyle).toBe('full');
    expect(MultichatQuerySchema.parse({ replyStyle: 'mention' }).replyStyle).toBe('mention');
    expect(MultichatQuerySchema.parse({ replyStyle: 'off' }).replyStyle).toBe('off');
  });

  it('omits full and serializes mention and off explicitly', () => {
    const queryFor = (replyStyle: 'full' | 'mention' | 'off') => new URLSearchParams(
      buildMultichatQuery(channels, { ...MULTICHAT_GENERATOR_DEFAULTS, replyStyle }),
    );

    expect(queryFor('full').has('replyStyle')).toBe(false);
    expect(queryFor('mention').get('replyStyle')).toBe('mention');
    expect(queryFor('off').get('replyStyle')).toBe('off');
  });

  it('normalizes saved workspace values against the reply-style enum', () => {
    expect(normalizeMultichatStyle({ replyStyle: 'mention' }).replyStyle).toBe('mention');
    expect(normalizeMultichatStyle({ replyStyle: 'off' }).replyStyle).toBe('off');
    expect(normalizeMultichatStyle({ replyStyle: 'invalid' as never }).replyStyle).toBe('full');
  });
});

describe('replyStyle renderer', () => {
  it('keeps the default and explicit full renderer byte-identical', () => {
    const implicit = renderReply();
    const implicitMarkup = implicit.container.innerHTML;
    expect(screen.getByText('ParentUser').parentElement?.textContent).toContain('quoted message');
    implicit.unmount();

    const explicit = renderReply('full');
    expect(explicit.container.innerHTML).toBe(implicitMarkup);
    expect(screen.getByText('answer')).toBeTruthy();
  });

  it('renders mention as an @username prefix without the quoted context', () => {
    renderReply('mention');
    expect(screen.getByText('@ParentUser')).toBeTruthy();
    expect(screen.queryByText('quoted message')).toBeNull();
    expect(screen.getByText('answer')).toBeTruthy();
  });

  it('renders off without reply context or a reply mention', () => {
    renderReply('off');
    expect(screen.queryByText('ParentUser')).toBeNull();
    expect(screen.queryByText('@ParentUser')).toBeNull();
    expect(screen.queryByText('quoted message')).toBeNull();
    expect(screen.getByText('answer')).toBeTruthy();
  });
});
