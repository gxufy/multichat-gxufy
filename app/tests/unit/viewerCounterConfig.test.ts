/* Viewer Counter config: defaults, serialization, round-trip, and the
 * tolerance guarantees that keep already-copied overlay URLs working.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  buildViewerCounterQuery,
  channelPollKey,
  normalizeChannel,
  parseChannelPollKey,
  parseViewerCounterConfig,
  summarize,
  visiblePlatforms,
  type ViewerCounterStyle,
} from '@/lib/viewerCounterConfig';

/** Parse a query string the way the overlay route would. */
function parseQuery(query: string) {
  return parseViewerCounterConfig(
    Object.fromEntries(new URLSearchParams(query).entries()),
  );
}

describe('defaults', () => {
  it('a query with no style params parses to the documented defaults', () => {
    expect(parseQuery('twitch=someone').style).toEqual(DEFAULT_STYLE);
  });

  it('an entirely empty query still yields defaults and no channels', () => {
    const config = parseQuery('');
    expect(config.style).toEqual(DEFAULT_STYLE);
    expect(config.channels).toEqual({});
  });

  it('pins the legacy no-parameter Typography appearance', () => {
    expect(DEFAULT_STYLE).toMatchObject({
      font: 'dejavu',
      fontWeight: '700',
      textTransform: 'none',
      fontItalic: false,
      textSize: 'medium',
      fontColor: '#ffffff',
    });
  });
});

describe('serialization', () => {
  it('emits the long-standing style params and omits default align', () => {
    const query = buildViewerCounterQuery({ twitch: 'someone' }, DEFAULT_STYLE);
    const params = new URLSearchParams(query);
    expect(params.get('combined')).toBe('true');
    expect(params.get('icons')).toBe('true');
    expect(params.get('bg')).toBe('false');
    expect(params.get('textShadow')).toBe('large');
    expect(params.get('stroke')).toBe('none');
    expect(params.has('align')).toBe(false);
    expect(params.has('font')).toBe(false);
    for (const name of [
      'counterFont',
      'counterFontWeight',
      'counterTextTransform',
      'counterFontItalic',
      'counterTextSize',
      'counterFontColor',
    ]) {
      expect(params.has(name), name).toBe(false);
    }
  });

  it('emits align once it differs from its default', () => {
    const query = buildViewerCounterQuery(
      { twitch: 'someone' },
      { ...DEFAULT_STYLE, align: 'center' },
    );
    expect(new URLSearchParams(query).get('align')).toBe('center');
  });

  it('serializes an explicitly selected Google Font through font=google:', () => {
    const query = buildViewerCounterQuery(
      { twitch: 'someone' },
      { ...DEFAULT_STYLE, googleFont: '  Press   Start 2P ' },
    );
    expect(new URLSearchParams(query).get('font')).toBe('google:Press Start 2P');
  });

  it('drops unsafe custom font names rather than serializing them', () => {
    const query = buildViewerCounterQuery(
      { twitch: 'someone' },
      { ...DEFAULT_STYLE, googleFont: "Bad'; color:red" },
    );
    expect(new URLSearchParams(query).has('font')).toBe(false);
  });

  it('emits no removed typography or label params', () => {
    const params = new URLSearchParams(
      buildViewerCounterQuery({ kick: 'someone' }, DEFAULT_STYLE),
    );
    for (const removed of ['textSize', 'label', 'showLabel', 'weight', 'metric']) {
      expect(params.has(removed)).toBe(false);
    }
  });

  it('omits platforms whose channel does not normalize', () => {
    const params = new URLSearchParams(
      buildViewerCounterQuery(
        { twitch: 'good', kick: 'bad name!', youtube: '', tiktok: '   ' },
        DEFAULT_STYLE,
      ),
    );
    expect(params.get('twitch')).toBe('good');
    expect(params.has('kick')).toBe(false);
    expect(params.has('youtube')).toBe(false);
    expect(params.has('tiktok')).toBe(false);
  });
});

describe('round trip', () => {
  const styles: ViewerCounterStyle[] = [
    DEFAULT_STYLE,
    { ...DEFAULT_STYLE, combined: false, icons: false, bg: false, textShadow: 'large', stroke: 'thicker', align: 'right' },
    { ...DEFAULT_STYLE, combined: true, icons: false, bg: true, textShadow: 'none', stroke: 'medium', align: 'center' },
    { ...DEFAULT_STYLE, combined: false, icons: true, bg: false, textShadow: 'medium', stroke: 'thin', align: 'left' },
    { ...DEFAULT_STYLE, googleFont: 'Bebas Neue' },
    {
      ...DEFAULT_STYLE,
      font: 'lato',
      fontWeight: '500',
      textTransform: 'capitalize',
      fontItalic: true,
      textSize: 'large',
      fontColor: '#12abef',
    },
  ];

  it.each(styles)('parse(serialize(style)) === style', (style) => {
    const query = buildViewerCounterQuery({ twitch: 'chan' }, style);
    expect(parseQuery(query).style).toEqual(style);
  });

  it('round-trips all four channels', () => {
    const channels = { twitch: 'a_1', youtube: 'b.2', kick: 'c-3', tiktok: 'd_4' };
    const query = buildViewerCounterQuery(channels, DEFAULT_STYLE);
    expect(parseQuery(query).channels).toEqual(channels);
  });
});

describe('tolerance', () => {
  it('falls back to defaults for malformed enum values', () => {
    const style = parseQuery(
      'twitch=a&textShadow=enormous&stroke=&align=diagonal',
    ).style;
    expect(style.textShadow).toBe(DEFAULT_STYLE.textShadow);
    expect(style.stroke).toBe(DEFAULT_STYLE.stroke);
    expect(style.align).toBe(DEFAULT_STYLE.align);
  });

  it('accepts legacy numeric enum aliases', () => {
    const style = parseQuery('twitch=a&textShadow=4&stroke=5&align=3').style;
    expect(style.textShadow).toBe('large');
    expect(style.stroke).toBe('thicker');
    expect(style.align).toBe('right');
  });

  it('rejects out-of-range numeric aliases back to defaults', () => {
    const style = parseQuery('twitch=a&textShadow=0&stroke=99').style;
    expect(style.textShadow).toBe(DEFAULT_STYLE.textShadow);
    expect(style.stroke).toBe(DEFAULT_STYLE.stroke);
  });

  it('rejects repeated (array) query values rather than coercing them', () => {
    /* Next surfaces `?twitch=a&twitch=b` as an array. Arrays must not be
       treated as usable strings by either channels or enums. */
    const config = parseViewerCounterConfig({
      twitch: ['a', 'b'],
      textShadow: ['large', 'none'],
      combined: ['false'],
      font: ['google:Press Start 2P'],
    });
    expect(config.channels.twitch).toBeUndefined();
    expect(config.style.textShadow).toBe(DEFAULT_STYLE.textShadow);
    expect(config.style.googleFont).toBeUndefined();
    /* An array is not the literal string 'false', so the true-default holds. */
    expect(config.style.combined).toBe(true);
  });

  it('keeps legacy bare font values ignored', () => {
    const withLegacy = parseQuery(
      'twitch=a&font=7&textSize=2&label=Viewers&showLabel=true&weight=700&metric=followers',
    );
    expect(withLegacy.style).toEqual(DEFAULT_STYLE);
    expect(withLegacy.channels).toEqual({ twitch: 'a' });
  });

  it('accepts only explicit safe google: font values', () => {
    expect(parseQuery('twitch=a&font=google:Press%20Start%202P').style.googleFont)
      .toBe('Press Start 2P');
    expect(parseQuery('twitch=a&font=Press%20Start%202P').style.googleFont)
      .toBeUndefined();
    expect(parseQuery("twitch=a&font=google:Bad'%3Bcolor:red").style.googleFont)
      .toBeUndefined();
  });

  it('treats booleans as true unless explicitly "false"', () => {
    expect(parseQuery('twitch=a&combined=false').style.combined).toBe(false);
    expect(parseQuery('twitch=a&combined=0').style.combined).toBe(true);
    expect(parseQuery('twitch=a&icons=nope').style.icons).toBe(true);
  });
});

describe('counter Typography parameters', () => {
  it('round-trips presets, all weights, transforms, italic, sizes, and colour', () => {
    for (const fontWeight of [
      '100', '200', '300', '400', '500', '600', '700', '800', '900',
    ] as const) {
      const style = { ...DEFAULT_STYLE, fontWeight };
      const params = new URLSearchParams(buildViewerCounterQuery({ kick: 'a' }, style));
      if (fontWeight === '700') expect(params.has('counterFontWeight')).toBe(false);
      else expect(params.get('counterFontWeight')).toBe(fontWeight);
      expect(parseQuery(params.toString()).style.fontWeight).toBe(fontWeight);
    }

    for (const textTransform of [
      'none', 'uppercase', 'lowercase', 'capitalize',
    ] as const) {
      const query = buildViewerCounterQuery(
        { kick: 'a' },
        { ...DEFAULT_STYLE, textTransform },
      );
      expect(parseQuery(query).style.textTransform).toBe(textTransform);
    }

    for (const textSize of ['small', 'medium', 'large'] as const) {
      const query = buildViewerCounterQuery({ kick: 'a' }, { ...DEFAULT_STYLE, textSize });
      expect(parseQuery(query).style.textSize).toBe(textSize);
    }

    const query = buildViewerCounterQuery({ kick: 'a' }, {
      ...DEFAULT_STYLE,
      font: 'lato',
      fontItalic: true,
      fontColor: '#12abef',
    });
    const params = new URLSearchParams(query);
    expect(params.get('counterFont')).toBe('lato');
    expect(params.get('counterFontItalic')).toBe('true');
    expect(params.get('counterFontColor')).toBe('12abef');
    expect(parseQuery(query).style).toMatchObject({
      font: 'lato',
      fontItalic: true,
      fontColor: '#12abef',
    });
  });

  it('keeps the established font=google path authoritative and safe', () => {
    const style = parseQuery(
      'kick=a&counterFont=lato&font=google%3APress+Start+2P&counterFontWeight=600',
    ).style;
    expect(style.font).toBe('lato');
    expect(style.googleFont).toBe('Press Start 2P');
    expect(style.fontWeight).toBe('600');
  });
});

describe('normalizeChannel', () => {
  it('trims and drops a leading @', () => {
    expect(normalizeChannel('  @someone  ')).toBe('someone');
  });

  it('preserves case and the allowed punctuation set', () => {
    expect(normalizeChannel('Some.User_Name-1')).toBe('Some.User_Name-1');
  });

  it('rejects empty, oversized, and out-of-charset names', () => {
    expect(normalizeChannel('')).toBe('');
    expect(normalizeChannel('   ')).toBe('');
    expect(normalizeChannel('a'.repeat(51))).toBe('');
    expect(normalizeChannel('bad name')).toBe('');
    expect(normalizeChannel('bad/name')).toBe('');
    expect(normalizeChannel('@')).toBe('');
  });

  it('rejects non-string input', () => {
    expect(normalizeChannel(undefined)).toBe('');
    expect(normalizeChannel(42)).toBe('');
    expect(normalizeChannel(['a'])).toBe('');
  });
});

describe('measured zero remains a valid measurement', () => {
  it('a live platform with 0 viewers stays visible', () => {
    expect(visiblePlatforms({ twitch: { state: 'live', viewers: 0 } })).toEqual([
      'twitch',
    ]);
  });

  it('summarize reports a measured total of 0 rather than "no data"', () => {
    const summary = summarize({ twitch: { state: 'live', viewers: 0 } });
    expect(summary).toEqual({ total: 0, hasMeasured: true, hasPresence: true });
  });

  it('live-unknown and unavailable contribute presence but no measurement', () => {
    expect(summarize({ youtube: { state: 'live-unknown' } })).toEqual({
      total: 0,
      hasMeasured: false,
      hasPresence: true,
    });
    expect(summarize({ tiktok: { state: 'unavailable' } })).toEqual({
      total: 0,
      hasMeasured: false,
      hasPresence: true,
    });
  });

  it('offline platforms are neither visible nor present', () => {
    expect(visiblePlatforms({ kick: { state: 'offline' } })).toEqual([]);
    expect(summarize({ kick: { state: 'offline' } })).toEqual({
      total: 0,
      hasMeasured: false,
      hasPresence: false,
    });
  });
});

describe('channelPollKey', () => {
  it('is stable across restyling and round-trips through its parser', () => {
    const channels = { twitch: 'a', tiktok: 'd_4' };
    const key = channelPollKey(channels);
    expect(channelPollKey({ ...channels })).toBe(key);
    expect(parseChannelPollKey(key)).toEqual(channels);
  });
});
