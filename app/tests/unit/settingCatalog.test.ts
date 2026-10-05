/* The setting catalog must never become a second source of defaults, and it
 * must serialize to exactly what the existing overlay serializer produces.
 */
import { describe, expect, it } from 'vitest';
import {
  ALIGNMENTS,
  COUNTER_FONTS,
  COUNTER_FONT_WEIGHTS,
  COUNTER_TEXT_SIZES,
  COUNTER_TEXT_TRANSFORMS,
  DEFAULT_STYLE,
  STROKES,
  TEXT_SHADOWS,
  buildViewerCounterQuery,
  type ViewerCounterStyle,
} from '@/lib/viewerCounterConfig';
import { COUNTER_CATALOG } from '@/features/counter/settings';
import { counterTool } from '@/features/counter/config';
import { visibleSettings } from '@/lib/tools/settingTypes';

describe('catalog integrity', () => {
  it('every key is unique', () => {
    const keys = COUNTER_CATALOG.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every query parameter is unique', () => {
    const params = COUNTER_CATALOG.map((setting) => setting.param);
    expect(new Set(params).size).toBe(params.length);
  });

  it('every select default appears in its own option list', () => {
    for (const setting of COUNTER_CATALOG) {
      if (setting.type !== 'select') continue;
      const values = setting.options.map((option) => option.value);
      expect(values).toContain(setting.default);
    }
  });

  it('hides only the custom-family state mirrored by the shared font picker', () => {
    expect(COUNTER_CATALOG.filter((setting) => setting.hidden).map((setting) => setting.key))
      .toEqual(['googleFont']);
    expect(visibleSettings(COUNTER_CATALOG)).toHaveLength(COUNTER_CATALOG.length - 1);
  });

  it('uses only supported control types', () => {
    for (const setting of COUNTER_CATALOG) {
      expect(['toggle', 'select', 'text', 'color']).toContain(setting.type);
    }
  });

  it('declares Typography first, followed by the established controls', () => {
    expect(COUNTER_CATALOG.map((setting) => setting.key)).toEqual([
      'font',
      'googleFont',
      'fontWeight',
      'textTransform',
      'fontItalic',
      'textSize',
      'fontColor',
      'combined',
      'icons',
      'bg',
      'align',
      'textShadow',
      'stroke',
    ]);
  });

  it('covers exactly the counter style fields, including the optional Google font, and no channel fields', () => {
    const keys = COUNTER_CATALOG.map((setting) => setting.key).sort();
    expect(keys).toEqual(
      [...(Object.keys(DEFAULT_STYLE) as (keyof ViewerCounterStyle)[]), 'googleFont'].sort(),
    );
    for (const platform of ['twitch', 'youtube', 'kick', 'tiktok']) {
      expect(keys).not.toContain(platform);
    }
  });
});

describe('catalog defaults match the authoritative defaults', () => {
  it('every catalog default equals the authoritative default or the blank optional-font state', () => {
    for (const setting of COUNTER_CATALOG) {
      expect(setting.default).toBe(
        setting.key === 'googleFont' ? '' : DEFAULT_STYLE[setting.key],
      );
    }
  });

  it('select option lists match the authoritative enums', () => {
    const byKey = new Map(COUNTER_CATALOG.map((setting) => [setting.key, setting]));
    const expected: [keyof ViewerCounterStyle, readonly string[]][] = [
      ['textShadow', TEXT_SHADOWS],
      ['stroke', STROKES],
      ['align', ALIGNMENTS],
      ['font', COUNTER_FONTS],
      ['fontWeight', COUNTER_FONT_WEIGHTS],
      ['textTransform', COUNTER_TEXT_TRANSFORMS],
      ['textSize', COUNTER_TEXT_SIZES],
    ];
    for (const [key, values] of expected) {
      const setting = byKey.get(key);
      expect(setting?.type).toBe('select');
      if (setting?.type !== 'select') return;
      expect(setting.options.map((option) => option.value)).toEqual([...values]);
    }
  });

  it('the tool descriptor reuses the authoritative defaults object', () => {
    expect(counterTool.defaults).toBe(DEFAULT_STYLE);
  });
});

describe('catalog serialization matches the existing serializer', () => {
  const channels = { twitch: 'someone', kick: 'other_1' };

  it('produces an identical query for the defaults', () => {
    expect(counterTool.serialize(channels, DEFAULT_STYLE)).toBe(
      buildViewerCounterQuery(channels, DEFAULT_STYLE),
    );
  });

  it('produces an identical query for every single-field change', () => {
    for (const setting of COUNTER_CATALOG) {
      expect(['toggle', 'select', 'text', 'color']).toContain(setting.type);
      const values: (boolean | string)[] =
        setting.type === 'toggle'
          ? [true, false]
          : setting.type === 'select'
            ? setting.options.map((option) => option.value)
            : setting.type === 'text'
              ? ['', 'Press Start 2P']
              : setting.type === 'color'
                ? ['#ffffff', '#12abef']
              : [];

      for (const value of values) {
        const style = counterTool.normalize({
          ...DEFAULT_STYLE,
          [setting.key]: value,
        } as Partial<ViewerCounterStyle>);
        expect(counterTool.serialize(channels, style)).toBe(
          buildViewerCounterQuery(channels, style),
        );
      }
    }
  });

  it('every emitted non-channel parameter is declared by the catalog', () => {
    const declared = new Set(COUNTER_CATALOG.map((setting) => setting.param));
    const platforms = new Set(['twitch', 'youtube', 'kick', 'tiktok']);
    const style: ViewerCounterStyle = {
      ...DEFAULT_STYLE,
      combined: false,
      icons: false,
      bg: false,
      textShadow: 'large',
      stroke: 'thick',
      align: 'center',
      googleFont: 'Press Start 2P',
      fontWeight: '600',
      textTransform: 'capitalize',
      fontItalic: true,
      textSize: 'large',
      fontColor: '#12abef',
    };
    for (const [param] of new URLSearchParams(
      counterTool.serialize(channels, style),
    )) {
      if (platforms.has(param)) continue;
      expect(declared).toContain(param);
    }
  });
});

describe('normalize', () => {
  it('replaces out-of-range enums with authoritative defaults', () => {
    const style = counterTool.normalize({
      textShadow: 'enormous',
      stroke: '',
      align: 'diagonal',
    } as unknown as Partial<ViewerCounterStyle>);
    expect(style).toEqual(DEFAULT_STYLE);
  });

  it('fills missing fields from defaults and keeps valid ones', () => {
    expect(counterTool.normalize({ combined: false })).toEqual({
      ...DEFAULT_STYLE,
      combined: false,
    });
  });

  it('rejects non-boolean toggle values', () => {
    const style = counterTool.normalize({
      icons: 'false',
    } as unknown as Partial<ViewerCounterStyle>);
    expect(style.icons).toBe(DEFAULT_STYLE.icons);
  });
});
