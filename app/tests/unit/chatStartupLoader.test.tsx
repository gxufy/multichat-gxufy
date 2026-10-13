import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

const config = MultichatQuerySchema.parse({ kick: 'somechannel' });

function mount(showLoader: false | 'visible' | 'fading') {
  return render(
    <ChatOverlay
      config={config}
      messages={[]}
      fadingIds={new Set()}
      pinnedMessage={null}
      showLoader={showLoader}
    />,
  );
}

describe('production Chat startup presentation', () => {
  it('uses text-only startup branding with no logo image', () => {
    mount('visible');
    const loader = screen.getByTestId('chat-startup-loader');
    expect(loader.textContent).toContain('Multi-Chat Overlay');
    expect(loader.textContent).toContain('made by @Gxufy');
    expect(loader.textContent).toContain('Loading...');
    expect(loader.querySelector('img')).toBeNull();
  });

  it('keeps the layer mounted during fade and removes it when hidden', () => {
    const { rerender } = mount('fading');
    expect(screen.getByTestId('chat-startup-loader').dataset.phase).toBe('fading');
    rerender(
      <ChatOverlay
        config={config}
        messages={[]}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
      />,
    );
    expect(screen.queryByTestId('chat-startup-loader')).toBeNull();
  });

  it('provides a usable reduced-motion presentation', () => {
    const { container } = mount('visible');
    const css = Array.from(container.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.ck-startup-spinner { animation: none');
    expect(css).toContain('.ck-startup-loader { transition: none; }');
  });
});
