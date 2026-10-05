import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

function mount(query: Record<string, string>) {
  const config = MultichatQuerySchema.parse({ kick: 'someone', ...query });
  const result = render(
    <ChatOverlay
      config={config}
      messages={[]}
      fadingIds={new Set()}
      pinnedMessage={null}
      showLoader={false}
    />,
  );
  return result.container.querySelector('#chat_container') as HTMLElement;
}

function renderedCss(chat: HTMLElement): string {
  return Array.from(chat.parentElement?.querySelectorAll('style') ?? [])
    .map((style) => style.textContent ?? '')
    .join('\n');
}

function mountedLineHeight(textSize: 'small' | 'medium' | 'large'): string {
  const message: ParsedMessage = {
    id: `size-${textSize}`,
    platform: 'twitch',
    kind: 'chat',
    identity: { username: 'size', color: '#fff', background: '', filter: '', badges: [] },
    message: ['hello'],
  };
  const config = MultichatQuerySchema.parse({ kick: 'someone', animation: 'none', textSize });
  const result = render(
    <ChatOverlay config={config} messages={[message]} fadingIds={new Set()}
      pinnedMessage={null} showLoader={false} />,
  );
  return (result.container.querySelector('.ck-body')?.parentElement as HTMLElement).style.lineHeight;
}

describe('MultiChat Typography rendering', () => {
  it('keeps every legacy text-size preset at its original pixel geometry', () => {
    expect(mount({ textSize: 'small' }).style.fontSize).toBe('20px');
    expect(mount({ textSize: 'medium' }).style.fontSize).toBe('34px');
    expect(mount({ textSize: 'large' }).style.fontSize).toBe('48px');
    expect(mountedLineHeight('small')).toBe('30px');
    expect(mountedLineHeight('medium')).toBe('55px');
    expect(mountedLineHeight('large')).toBe('75px');
  });

  it('applies an exact custom pixel size without changing the legacy fallback', () => {
    const chat = mount({ textSize: 'medium', textSizePx: '41' });
    expect(chat.style.fontSize).toBe('41px');
  });

  it('applies weight, lowercase, italic, and the existing text colour', () => {
    const chat = mount({
      fontWeight: '600',
      textTransform: 'lowercase',
      fontItalic: 'true',
      fontColor: 'abcdef',
    });
    expect(chat.style.fontWeight).toBe('600');
    expect(chat.style.textTransform).toBe('lowercase');
    expect(chat.style.fontStyle).toBe('italic');
    expect(chat.style.color).toBe('rgb(171, 205, 239)');
  });

  it('renders every explicit Style weight without the legacy Bold override masking it', () => {
    for (const fontWeight of [
      '100', '200', '300', '400', '500', '600', '700', '800', '900',
    ]) {
      const chat = mount({ fontWeight });
      const css = renderedCss(chat);
      expect(chat.style.fontWeight).toBe(fontWeight);
      expect(css).toMatch(new RegExp(`\\.ck-body \\{[\\s\\S]*font-weight: ${fontWeight} !important`));
      expect(css).toMatch(new RegExp(`\\.ck-name \\{[\\s\\S]*font-weight: ${fontWeight} !important`));
    }
  });

  it('keeps legacy no-weight URLs and msgCaps visually compatible', () => {
    const legacyCaps = mount({ msgCaps: 'true' });
    expect(legacyCaps.style.textTransform).toBe('uppercase');

    expect(mount({}).style.fontWeight).toBe('800');
    expect(mount({ msgBold: 'false' }).style.fontWeight).toBe('400');
  });
});
