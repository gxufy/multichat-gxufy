// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

function css(stroke: string): string {
  const config = MultichatQuerySchema.parse({ twitch: 'streamer', stroke });
  const { container } = render(<ChatOverlay config={config} messages={[]} fadingIds={new Set()} showLoader={false} />);
  return [...container.querySelectorAll('style'), ...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
}

describe('outline spacing', () => {
  it('keeps the normal gaps with no outline', () => {
    const text = css('none');
    expect(text).toMatch(/\.ck-name \{[^}]*margin-right: 8px;[^}]*word-spacing: 0px;/);
  });

  it('gives back the space a thick outline covers', () => {
    const text = css('thick');
    expect(text).toMatch(/\.ck-name \{[^}]*margin-right: 14px;[^}]*word-spacing: 6px;/);
    expect(text).toMatch(/\.ck-body \{[^}]*word-spacing: 6px;/);
  });
});
