import { cleanup, render } from '@testing-library/react';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';

const baseConfig = MultichatQuerySchema.parse({
  twitch: 'gxufy',
  textShadow: 'medium',
  stroke: 'thin',
  smoothScroll: '1',
});

function message(overrides: Partial<ParsedMessage['identity']> = {}): ParsedMessage {
  return {
    id: 'twitch:visual-shadow',
    platform: 'twitch',
    timestamp: 1,
    identity: {
      username: 'ColorUser',
      color: '#ff4f8b',
      background: '',
      filter: '',
      badges: [],
      ...overrides,
    },
    message: ['hello'],
  };
}

function mount(
  config = baseConfig,
  msg = message(),
) {
  let head: ReactElement[] = [];

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
        messages={[msg]}
        fadingIds={new Set()}
        pinnedMessage={null}
        showLoader={false}
      />
    </HeadManagerContext.Provider>,
  );

  const css = head
    .filter((el) => el?.type === 'style')
    .map((el) => {
      const props = el.props as {
        children?: string;
        dangerouslySetInnerHTML?: { __html: string };
      };
      return props.dangerouslySetInnerHTML?.__html ?? props.children ?? '';
    })
    .join('\n')
    .replace(/\s+/g, ' ');

  return { ...view, css };
}

function block(css: string, selector: string): string {
  const start = css.lastIndexOf(selector);
  if (start < 0) throw new Error(`No CSS rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

afterEach(cleanup);

describe('shadow, stroke, and paint composition', () => {
  it('keeps the animated row unfiltered and applies glyph shadows in CSS', () => {
    const { container, css } = mount();

    const row = container.querySelector('.gx-message-row') as HTMLElement;
    expect(row.style.filter).toBe('');

    const body = block(css, '.ck-body {');
    expect(body).toContain('1px 1px 0 black');
    expect(body).toContain('1.75px 2px 1.1px');

    const name = block(css, '.ck-name {');
    expect(name).toContain('1px 1px 0 black');
    expect(name).toContain('2px 2.2px 1.1px');
  });

  it('keeps 7TV paint shadow on the painted name without a row filter', () => {
    const paintFilter = 'drop-shadow(0px 0px 2px rgba(255,0,85,0.8))';

    const { container } = mount(
      baseConfig,
      message({
        background: 'linear-gradient(90deg, #ff0055, #6f5cff)',
        filter: paintFilter,
      }),
    );

    const row = container.querySelector('.gx-message-row') as HTMLElement;
    const name = container.querySelector('.ck-name-paint') as HTMLElement;

    expect(row.style.filter).toBe('');
    expect(name.style.filter).toBe(paintFilter);
    expect(name.style.textShadow).toBe('none');
  });

  it('uses a direct paint stroke when paint shadows are off', () => {
    const { container } = mount(
      { ...baseConfig, paintShadows: false },
      message({
        background: 'linear-gradient(90deg, #ff0055, #6f5cff)',
        filter: '',
      }),
    );

    const name = container.querySelector('.ck-name-paint') as HTMLElement;

    expect(name.style.filter).toBe('');
    expect(name.style.backgroundImage).toContain('linear-gradient');
    expect(name.style.textShadow).toBe('none');
    expect(name.style.webkitTextStroke).toBe('1px black');
  });

  it('maps shadow strength to the configured glyph-shadow layers', () => {
    const large = mount({ ...baseConfig, textShadow: 'large', stroke: 'none' });
    const largeBody = block(large.css, '.ck-body {');

    expect(largeBody).toContain('2.5px 3px 1.6px');
    expect(largeBody).toContain('0 3px 6.4px');
    cleanup();

    const none = mount({ ...baseConfig, textShadow: 'none', stroke: 'none' });
    const noneBody = block(none.css, '.ck-body {');

    expect(noneBody).toContain('text-shadow: none');
    expect((none.container.querySelector('.gx-message-row') as HTMLElement).style.filter).toBe('');
  });
});
