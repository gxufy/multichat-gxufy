import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';

const message: ParsedMessage = {
  id: 'twitch:performance',
  platform: 'twitch',
  kind: 'chat',
  identity: { username: 'user', color: '#fff', background: '', filter: '', badges: [] },
  message: ['hello'],
};

afterEach(cleanup);

describe('chat overlay compositor-friendly rendering', () => {
  it('keeps text shadowing off the animated chat row', () => {
    const config = MultichatQuerySchema.parse({
      twitch: 'channel',
      animation: 'none',
      textShadow: 'large',
    });

    const { container } = render(
      <ChatOverlay
        config={config}
        messages={[message]}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
      />,
    );

    const chat = container.querySelector('#chat_container') as HTMLElement;
    const row = container.querySelector('.gx-message-row') as HTMLElement;

    expect(chat.style.filter).toBe('');
    expect(row.style.filter).toBe('');
  });

  it('does not keep the scrolling subtree permanently promoted', () => {
    const config = MultichatQuerySchema.parse({
      twitch: 'channel',
      animation: 'none',
      smoothScroll: 'true',
    });

    const { container } = render(
      <ChatOverlay
        config={config}
        messages={[message]}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
      />,
    );

    const chat = container.querySelector('#chat_container') as HTMLElement;
    expect(chat.style.willChange).toBe('');
  });
});
