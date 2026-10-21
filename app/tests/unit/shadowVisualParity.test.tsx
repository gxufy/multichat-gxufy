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

function blockContaining(css: string, selector: string, required: string): string {
  let start = css.indexOf(selector);
  while (start >= 0) {
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const declarations = css.slice(open + 1, close);
    if (declarations.includes(required)) return declarations;
    start = css.indexOf(selector, close + 1);
  }
  throw new Error(`No CSS rule for ${selector} containing ${required}`);
}

afterEach(cleanup);

describe('shadow, stroke, and paint composition', () => {
  it('keeps the animated row unfiltered and applies glyph shadows in CSS', () => {
    const { container, css } = mount();

    const row = container.querySelector('.gx-message-row') as HTMLElement;
    expect(row.style.filter).toBe('');
    expect(row.style.transform).toBe('');
    expect(row.style.marginLeft).toBe('2px');
    expect(row.style.marginRight).toBe('-6px');
    expect((container.querySelector('#chat_container') as HTMLElement).style.width)
      .toBe('100%');

    expect(blockContaining(css, '.ck-body {', 'text-shadow: none'))
      .toContain('text-shadow: none');
    expect(blockContaining(css, '.ck-name {', 'text-shadow: none'))
      .toContain('text-shadow: none');
    expect(css).toMatch(/#chat_container\s*\{[^}]*font-synthesis:\s*none/);
    expect(blockContaining(css, '.ck-body {', 'font-weight: 800 !important'))
      .toContain('font-weight: 800 !important');
    expect(blockContaining(css, '.ck-name {', 'font-weight: 800 !important'))
      .toContain('font-weight: 800 !important');

    const edge = blockContaining(css, '.gx-reference-glyph::before {', 'content: attr');
    expect(edge).toContain('content: attr(data-gx-glyph) / ""');
    expect(edge).toContain('filter: none');
    expect(edge).toContain('1px 1px 0 black');
    expect(edge).toContain('-1px 0 0 rgba(0,0,0,0.58)');
    expect(edge).toContain('1px 0 0 rgba(0,0,0,0.64)');
    expect(edge).toContain('0 1px 0 rgba(0,0,0,0.67)');
    expect(edge).toContain('1.25px 2.75px 1px rgba(0,0,0,0.77)');
    expect(edge).not.toContain('1.75px');

    const foreground = blockContaining(
      css,
      '.gx-reference-glyph-foreground {',
      'position: relative',
    );
    expect(foreground).toContain('opacity: 1');
    expect(foreground).toContain('filter: none');
    expect(foreground).toContain('text-shadow: none !important');
    expect(foreground).toContain('transform: none');

    expect(container.querySelector('#gx-reference-text-alpha')).toBeNull();
    expect(css).not.toContain('url("#gx-reference-text-alpha")');
    expect(container.querySelector('.ck-name .gx-reference-glyph')?.textContent)
      .toBe('ColorUser:');
    expect(container.querySelector('.ck-body .gx-reference-glyph')?.textContent)
      .toBe('hello');
    expect((container.querySelector('#chat_container') as HTMLElement).style.fontSize)
      .toBe('34px');
    expect(container.querySelector('[style*="line-height: 58px"]')).not.toBeNull();
    expect(css).not.toContain('letter-spacing: .1px');
    expect(css).not.toContain('-webkit-font-smoothing: antialiased');
  });

  it('layers the xQc edge underneath the native 7TV paint shadow', () => {
    const paintFilter =
      'drop-shadow(0px 0px 2px rgba(255,0,85,0.8))';

    const { container } = mount(
      baseConfig,
      message({
        background: 'linear-gradient(90deg, #ff0055, #6f5cff)',
        filter: paintFilter,
      }),
    );

    const row =
      container.querySelector('.gx-message-row') as HTMLElement;

    const name =
      container.querySelector('.ck-name-paint') as HTMLElement;

    const edge =
      name.querySelector('.gx-paint-edge') as HTMLElement;

    const foreground =
      name.querySelector('.gx-paint-foreground') as HTMLElement;

    expect(row.style.filter).toBe('');
    expect(name.style.filter).toBe('');

    expect(edge).not.toBeNull();
    expect(edge.style.color).toBe('transparent');
    expect(edge.style.textShadow).toContain('1px 1px 0');

    expect(foreground).not.toBeNull();
    expect(foreground.style.filter).toBe(paintFilter);
    expect(foreground.style.textShadow).toBe('none');

    expect(name.querySelector('.gx-reference-glyph')).toBeNull();
  });

  it('keeps the xQc edge when native 7TV paint shadows are off', () => {
    const { container } = mount(
      { ...baseConfig, paintShadows: false },
      message({
        background: 'linear-gradient(90deg, #ff0055, #6f5cff)',
        filter: '',
      }),
    );

    const name =
      container.querySelector('.ck-name-paint') as HTMLElement;

    const edge =
      name.querySelector('.gx-paint-edge') as HTMLElement;

    const foreground =
      name.querySelector('.gx-paint-foreground') as HTMLElement;

    expect(name.style.filter).toBe('');

    expect(edge).not.toBeNull();
    expect(edge.style.textShadow).toContain('1px 1px 0');

    expect(foreground.style.filter).toBe('');
    expect(foreground.style.backgroundImage)
      .toContain('linear-gradient');
    expect(foreground.style.textShadow).toBe('none');
  });

  it('keeps the large text edge with the row shadow', () => {
    const large = mount({ ...baseConfig, textShadow: 'large', stroke: 'none' });
    const bodyEdge = blockContaining(
      large.css,
      '.gx-reference-glyph::before {',
      'content: attr',
    );
    const nameEdge = blockContaining(
      large.css,
      '.ck-name .gx-reference-glyph::before {',
      'text-shadow:',
    );

    expect(bodyEdge).toContain(
      '2.125px 2.55px 1.36px black, 0 2.55px 5.44px black, 0 0 4.08px rgba(0,0,0,.8)',
    );
    expect(nameEdge).toContain(
      '2.448px 2.72px 1.36px black, 0 0 4.08px black',
    );
    expect(bodyEdge).not.toContain('1.25px 2.75px');
    expect(nameEdge).not.toContain('1.25px 2.75px');
    cleanup();

    const none = mount({ ...baseConfig, textShadow: 'none', stroke: 'none' });
    const noneForeground = blockContaining(
      none.css,
      '.gx-reference-glyph-foreground {',
      'position: relative',
    );

    expect(noneForeground).toContain('filter: none');
    expect(none.css).toContain('.gx-reference-glyph::before { visibility: hidden');
    expect((none.container.querySelector('.gx-message-row') as HTMLElement).style.filter).toBe('');
  });

  it('keeps emote image nodes outside the glyph-only filter and edge layer', () => {
    const msg = message();
    msg.message = [
      'hello ',
      <img key="emote" className="ck-emote" src="/emote.png" alt="OMEGALUL" />,
      ' world',
    ];
    const { container } = mount(baseConfig, msg);

    const emote = container.querySelector('img.ck-emote') as HTMLImageElement;
    expect(emote).not.toBeNull();
    expect(emote.closest('.gx-reference-glyph')).toBeNull();
    expect(emote.getAttribute('src')).toBe('/emote.png');
  });
});
