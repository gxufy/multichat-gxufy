import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';

vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(cleanup);

const config = MultichatQuerySchema.parse({ twitch: 'channel', animation: 'none' });
const message = (body: React.ReactNode): ParsedMessage => ({
  id: 'twitch:stable', platform: 'twitch', senderId: '1', kind: 'chat', timestamp: 1,
  raw: {
    platform: 'twitch', id: 'stable', senderId: '1', username: 'tester', color: '#fff',
    badges: [], text: 'hello', emotes: [], timestamp: 1, kind: 'chat',
  },
  identity: { username: 'tester', color: '#fff', background: '', filter: '', badges: [] },
  message: [body],
});

describe('ChatOverlay same-ID resource repaint', () => {
  it('updates existing content without creating another row or batch', () => {
    const props = {
      config, fadingIds: new Set<string>(), pinnedMessage: null,
      showLoader: false, sourceTagExplicit: true,
    };
    const { container, rerender } = render(<ChatOverlay {...props} messages={[message('before')]} />);
    expect(container.querySelectorAll('.ck-body')).toHaveLength(1);
    expect(container.textContent).toContain('before');

    rerender(<ChatOverlay {...props} messages={[message(<img src="https://cdn.example/badge.png" alt="loaded" />)]} />);
    expect(container.querySelectorAll('.ck-body')).toHaveLength(1);
    expect(container.querySelector('img[alt="loaded"]')).toBeTruthy();
    expect(container.querySelector('.ck-body')?.textContent).not.toContain('before');
  });
});
