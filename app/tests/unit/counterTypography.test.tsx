import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ViewerCounterDisplay from '@/components/overlay/ViewerCounterDisplay';
import {
  COUNTER_FONT_SIZE_PX_BY_PRESET,
  DEFAULT_STYLE,
  parseViewerCounterConfig,
} from '@/lib/viewerCounterConfig';

afterEach(cleanup);

const statuses = { twitch: { state: 'live' as const, viewers: 1234 } };

function mount(query: Record<string, string> = {}) {
  const style = parseViewerCounterConfig(query).style;
  const result = render(<ViewerCounterDisplay statuses={statuses} style={style} />);
  const row = result.container.querySelector('div') as HTMLElement;
  const pill = row.firstElementChild as HTMLElement;
  const count = pill.querySelector('span:last-child') as HTMLElement;
  const css = Array.from(result.container.querySelectorAll('style'))
    .map((element) => element.textContent ?? '')
    .join('\n');
  return { ...result, css, count, pill, row, style };
}

describe('Viewer Counter Typography rendering', () => {
  it('keeps the no-parameter legacy appearance exactly', () => {
    const { css, count, pill, style } = mount();
    expect(style).toEqual(DEFAULT_STYLE);
    expect(pill.style.fontFamily).toContain('DejaVu Sans');
    expect(pill.style.fontWeight).toBe('700');
    expect(pill.style.fontStyle).toBe('');
    expect(pill.style.textTransform).toBe('');
    expect(pill.style.color).toBe('rgb(255, 255, 255)');
    expect(count.style.fontSize).toBe('34px');
    expect(css).toContain('/fonts/DejaVuSans-Bold.ttf');
    expect(css).not.toContain('fonts.googleapis.com');
  });

  it('maps Small, Medium, and Large around the exact legacy 34px default', () => {
    for (const [textSize, fontSize] of Object.entries(COUNTER_FONT_SIZE_PX_BY_PRESET)) {
      const { count } = mount({ counterTextSize: textSize });
      expect(count.style.fontSize).toBe(`${fontSize}px`);
      cleanup();
    }
  });

  it('applies every explicit numeric weight to the rendered counter pill', () => {
    for (const fontWeight of [
      '100', '200', '300', '400', '500', '600', '700', '800', '900',
    ]) {
      const { pill } = mount({ counterFontWeight: fontWeight });
      expect(pill.style.fontWeight).toBe(fontWeight);
      cleanup();
    }
  });

  it('renders each transform plus italic and text colour independently', () => {
    for (const textTransform of ['none', 'uppercase', 'lowercase', 'capitalize']) {
      const { pill } = mount({ counterTextTransform: textTransform });
      expect(pill.style.textTransform).toBe(textTransform === 'none' ? '' : textTransform);
      cleanup();
    }

    const { pill } = mount({
      counterFontItalic: 'true',
      counterFontColor: '12abef',
    });
    expect(pill.style.fontStyle).toBe('italic');
    expect(pill.style.color).toBe('rgb(18, 171, 239)');
  });

  it('keeps old custom Google-font URLs and requests their selected variant', () => {
    const { css, pill } = mount({
      font: 'google:Press Start 2P',
      counterFontWeight: '600',
      counterFontItalic: 'true',
    });
    expect(pill.style.fontFamily).toContain('Press Start 2P');
    expect(css).toContain('family=Press+Start+2P');
    expect(css).toContain('family=Press+Start+2P:ital,wght@1,600');
  });

  it('loads a selected GXUFY Google preset at the active weight', () => {
    const { css, pill } = mount({
      counterFont: 'lato',
      counterFontWeight: '500',
    });
    expect(pill.style.fontFamily).toContain('Lato');
    expect(css).toContain('family=Lato:wght@500');
  });
});
