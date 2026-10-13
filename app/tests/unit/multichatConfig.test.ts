/* MultiChat config compatibility contract.
 *
 * These tests lock the current parser and serializer behaviour, including the
 * shared large-shadow default, retired pin parameters, community-badge toggle,
 * legacy numeric aliases, and URL parameter ordering/encoding.
 */
import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_GENERATOR_DEFAULT_CHANNELS,
  MULTICHAT_OVERLAY_DEFAULTS,
  MULTICHAT_UNREAD_PARAMS,
  buildMultichatQuery,
  hasConfiguredMultichatChannel,
  multichatKickChannel,
  multichatPlatformCount,
  safeParseMultichatConfig,
  type MultichatGeneratorStyle,
} from '@/lib/multichatConfig';

/** Parse helper that asserts success and returns the data. */
function parse(query: Record<string, string | string[]>) {
  const result = safeParseMultichatConfig(query);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('unreachable');
  return result.data;
}

/** Serialize the generator defaults with the given overrides applied. */
function build(
  over: Partial<MultichatGeneratorStyle> = {},
  channels: Partial<typeof MULTICHAT_GENERATOR_DEFAULT_CHANNELS> = {},
): string {
  return buildMultichatQuery(
    { ...MULTICHAT_GENERATOR_DEFAULT_CHANNELS, ...channels },
    { ...MULTICHAT_GENERATOR_DEFAULTS, ...over },
  );
}

/* ------------------------------------------------------------------ */
/* Overlay and generator defaults                                      */
/* ------------------------------------------------------------------ */

describe('overlay parse defaults', () => {
  it('an empty query resolves to the current overlay defaults', () => {
    expect(parse({})).toEqual({
      sevenTVCosmeticsEnabled: true,
      sevenTVEmotesEnabled: true,
      showCommunityBadges: true,
      textShadow: 'large',
      textSize: 'medium',
      animation: 'slide',
      entryAnimation: 'none',
      showPinEnabled: false,
      showSystemMsgs: true,
      mentionColor: true,
      bgColor: '',
      showFirstMessages: true,
      showRedeems: true,
      sourceTag: 'icon',
      showAvatars: false,
      font: 'opensans',
      stroke: 'none',
      emoteScale: 1,
      gifs: false,
      gifSize: 100,
      fade: false,
      msgBold: true,
      fontWeight: undefined,
      msgCaps: false,
      textTransform: 'none',
      fontItalic: false,
      smoothScroll: false,
      sharedChatEnabled: true,
      replyStyle: 'full',
      restoreOnReload: false,
      maxMessageLines: 100,
      maxMessageAge: 0,
      fontColor: '',
      paintShadows: true,
      modAction: true,
      userBL: '',
      prefixBL: '',
      pinPlatforms: [],
      hideNames: false,
      botNames: '',
      ttsEnabled: true,
    });
  });

  it('a bare overlay URL resolves textShadow to large', () => {
    expect(parse({ kick: 'someone' }).textShadow).toBe('large');
    expect(MULTICHAT_OVERLAY_DEFAULTS.textShadow).toBe('large');
  });
});

describe('generator defaults', () => {
  it('the generator begins at the same large shadow as the overlay', () => {
    expect(MULTICHAT_GENERATOR_DEFAULTS.textShadow).toBe('large');
    expect(MULTICHAT_GENERATOR_DEFAULTS.textShadow).toBe(
      MULTICHAT_OVERLAY_DEFAULTS.textShadow,
    );
  });

  it('keeps Open Sans locked as the default font', () => {
    expect(MULTICHAT_OVERLAY_DEFAULTS.font).toBe('opensans');
    expect(MULTICHAT_GENERATOR_DEFAULTS.font).toBe('opensans');
  });

  it('every generator default matches the current initial state', () => {
    expect(MULTICHAT_GENERATOR_DEFAULTS).toEqual({
      sevenTVEmotesEnabled: true,
      sevenTVCosmeticsEnabled: true,
      showCommunityBadges: true,
      textSize: 'medium',
      textSizePx: '',
      font: 'opensans',
      googleFont: '',
      textShadow: 'large',
      stroke: 'none',
      animation: 'slide',
      entryAnimation: 'none',
      fade: '30',
      fadeEnabled: true,
      showPinEnabled: false,
      platformIcons: true,
      mentionColor: true,
      bgColor: '',
      emoteScale: '',
      gifs: false,
      gifSize: '100',
      msgBold: true,
      fontWeight: '800',
      msgCaps: false,
      textTransform: 'none',
      fontItalic: false,
      smoothScroll: false,
      sharedChatEnabled: true,
      replyStyle: 'full',
      restoreOnReload: false,
      maxMessageLines: '100',
      maxMessageAge: '',
      showSystemMsgs: true,
      showFirstMessages: true,
      showRedeems: true,
      modAction: true,
      paintShadows: true,
      fontColor: '',
      pinPlatforms: [],
      hideNames: false,
      botNames: '',
      userBL: '',
      prefixBL: '',
    });
    expect(MULTICHAT_GENERATOR_DEFAULT_CHANNELS).toEqual({
      kick: '', twitch: '', youtube: '', tiktok: '',
    });
  });

  it('the generator writes the shared large shadow', () => {
    expect(build({}, { kick: 'a' })).toContain('textShadow=large');
  });

  it('keeps the existing custom Google Font parser and serializer contract', () => {
    const query = build({ googleFont: 'Press Start 2P' }, { kick: 'a' });
    expect(new URLSearchParams(query).get('font')).toBe('google:Press Start 2P');
    expect(parse({ kick: 'a', font: 'google:Press Start 2P' }).font)
      .toBe('google:Press Start 2P');
    expect(new URLSearchParams(build({ googleFont: '' }, { kick: 'a' })).get('font'))
      .toBe('opensans');
  });
});

/* ------------------------------------------------------------------ */
/* Numeric alias tables                                                */
/* ------------------------------------------------------------------ */

describe('legacy numeric aliases', () => {
  const cases: [string, [string, string][]][] = [
    ['textSize', [['1', 'small'], ['2', 'medium'], ['3', 'large']]],
    ['textShadow', [['1', 'none'], ['2', 'small'], ['3', 'medium'], ['4', 'large']]],
    ['animation', [['1', 'none'], ['2', 'slide'], ['3', 'fade']]],
    ['stroke', [
      ['1', 'none'], ['2', 'thin'], ['3', 'medium'], ['4', 'thick'], ['5', 'thicker'],
    ]],
    ['font', [
      ['1', 'baloo'], ['2', 'segoe'], ['3', 'roboto'], ['4', 'lato'],
      ['5', 'noto'], ['6', 'sourcecode'], ['7', 'impact'], ['8', 'comfortaa'],
      ['9', 'dancing'], ['10', 'indieflower'], ['11', 'opensans'], ['12', 'alsina'],
    ]],
  ];

  for (const [param, table] of cases) {
    for (const [alias, expected] of table) {
      it(`${param}=${alias} → ${expected}`, () => {
        const cfg = parse({ kick: 'a', [param]: alias }) as Record<string, unknown>;
        expect(cfg[param]).toBe(expected);
      });
    }
  }

  it('canonical values pass through unchanged', () => {
    expect(parse({ kick: 'a', textSize: 'large' }).textSize).toBe('large');
    expect(parse({ kick: 'a', textShadow: 'none' }).textShadow).toBe('none');
    expect(parse({ kick: 'a', animation: 'fade' }).animation).toBe('fade');
    expect(parse({ kick: 'a', stroke: 'thin' }).stroke).toBe('thin');
    expect(parse({ kick: 'a', font: 'impact' }).font).toBe('impact');
  });

  it('malformed enums fall back to the current default', () => {
    expect(parse({ kick: 'a', textSize: 'gigantic' }).textSize).toBe('medium');
    expect(parse({ kick: 'a', textSize: '0' }).textSize).toBe('medium');
    expect(parse({ kick: 'a', textShadow: 'huge' }).textShadow).toBe('large');
    expect(parse({ kick: 'a', animation: 'zoom' }).animation).toBe('slide');
    expect(parse({ kick: 'a', stroke: 'huge' }).stroke).toBe('none');
    expect(parse({ kick: 'a', sourceTag: 'badge' }).sourceTag).toBe('icon');
  });

  it('font is the one enum that passes unknown values straight through', () => {
    expect(parse({ kick: 'a', font: '13' }).font).toBe('13');
    expect(parse({ kick: 'a', font: 'comicsans' }).font).toBe('comicsans');
  });

  it('sourceTag accepts all four canonical modes', () => {
    for (const mode of ['none', 'dot', 'label', 'icon'] as const) {
      expect(parse({ kick: 'a', sourceTag: mode }).sourceTag).toBe(mode);
    }
  });
});

describe('typography query compatibility', () => {
  it('keeps legacy text-size presets and maps them to their locked geometry', () => {
    for (const textSize of ['small', 'medium', 'large'] as const) {
      const query = build({ textSize }, { kick: 'a' });
      const params = new URLSearchParams(query);
      expect(params.get('textSize')).toBe(textSize);
      expect(params.has('textSizePx')).toBe(false);
      expect(parse(Object.fromEntries(params)).textSize).toBe(textSize);
    }
  });

  it('round-trips a custom pixel size and clamps bounds safely', () => {
    const query = build({ textSizePx: '41' }, { kick: 'a' });
    const params = new URLSearchParams(query);
    expect(params.get('textSize')).toBe('medium');
    expect(params.get('textSizePx')).toBe('41');
    expect(parse(Object.fromEntries(params)).textSizePx).toBe(41);

    expect(parse({ kick: 'a', textSizePx: '1' }).textSizePx).toBe(24);
    expect(parse({ kick: 'a', textSizePx: '999' }).textSizePx).toBe(64);
    expect(parse({ kick: 'a', textSizePx: 'nope' }).textSizePx).toBeUndefined();
  });

  it('omits a pixel override equal to the active legacy preset', () => {
    expect(new URLSearchParams(build({ textSizePx: '34' })).has('textSizePx')).toBe(false);
    expect(new URLSearchParams(build({ textSize: 'large', textSizePx: '48' }))
      .has('textSizePx')).toBe(false);
  });

  it('preserves msgCaps for uppercase and uses textTransform for new modes', () => {
    const legacy = new URLSearchParams(build({ msgCaps: true }, { kick: 'a' }));
    expect(legacy.get('msgCaps')).toBe('true');
    expect(legacy.has('textTransform')).toBe(false);

    const uppercase = new URLSearchParams(build({ textTransform: 'uppercase' }, { kick: 'a' }));
    expect(uppercase.get('msgCaps')).toBe('true');
    expect(uppercase.has('textTransform')).toBe(false);

    for (const textTransform of ['lowercase', 'capitalize'] as const) {
      const params = new URLSearchParams(build({ textTransform }, { kick: 'a' }));
      expect(params.get('textTransform')).toBe(textTransform);
      expect(params.has('msgCaps')).toBe(false);
      expect(parse(Object.fromEntries(params)).textTransform).toBe(textTransform);
    }
  });

  it('round-trips all nine explicit weights and keeps absence on the legacy path', () => {
    for (const fontWeight of [
      '100', '200', '300', '400', '500', '600', '700', '800', '900',
    ] as const) {
      expect(parse({ kick: 'a', fontWeight }).fontWeight).toBe(fontWeight);
      const params = new URLSearchParams(build({ fontWeight }, { kick: 'a' }));
      if (fontWeight === '800') {
        expect(params.has('fontWeight')).toBe(false);
        expect(parse(Object.fromEntries(params)).fontWeight).toBeUndefined();
      } else {
        expect(params.get('fontWeight')).toBe(fontWeight);
        expect(parse(Object.fromEntries(params)).fontWeight).toBe(fontWeight);
      }
    }
  });

  it('round-trips italic, rejects malformed weights, and has no Small Caps parameter', () => {
    const params = new URLSearchParams(build({
      fontWeight: '600',
      fontItalic: true,
    }, { kick: 'a' }));
    expect(params.get('fontWeight')).toBe('600');
    expect(params.get('fontItalic')).toBe('true');
    expect(params.has('smallCaps')).toBe(false);

    const parsed = parse(Object.fromEntries(params));
    expect(parsed.fontWeight).toBe('600');
    expect(parsed.fontItalic).toBe(true);
    expect('smallCaps' in parsed).toBe(false);
    expect(parse({ kick: 'a', fontWeight: '950' }).fontWeight).toBeUndefined();
    expect(parse({ kick: 'a' }).fontWeight).toBeUndefined();
    expect(parse({ kick: 'a', textTransform: 'sideways' }).textTransform).toBe('none');
  });
});

/* ------------------------------------------------------------------ */
/* Number transforms and malformed input                               */
/* ------------------------------------------------------------------ */

describe('fade (parseInt semantics)', () => {
  const cases: [string | undefined, number | false][] = [
    [undefined, false],
    ['30', 30],
    ['0', 0],
    ['-5', -5],
    ['abc', false],
    ['', false],
    ['12.9', 12],
    ['10s', 10],
  ];

  for (const [input, expected] of cases) {
    it(`${input === undefined ? 'absent' : `"${input}"`} → ${expected}`, () => {
      const query: Record<string, string> = { kick: 'a' };
      if (input !== undefined) query.fade = input;
      expect(parse(query).fade).toBe(expected);
    });
  }
});

describe('emoteScale (parseFloat semantics)', () => {
  const cases: [string | undefined, number][] = [
    [undefined, 1],
    ['1.5', 1.5],
    ['big', 1],
    ['', 1],
    ['0', 0],
    ['-2', -2],
  ];

  for (const [input, expected] of cases) {
    it(`${input === undefined ? 'absent' : `"${input}"`} → ${expected}`, () => {
      const query: Record<string, string> = { kick: 'a' };
      if (input !== undefined) query.emoteScale = input;
      expect(parse(query).emoteScale).toBe(expected);
    });
  }
});

describe('colour parsing', () => {
  it('accepts a bare six-digit hex and prefixes it', () => {
    expect(parse({ kick: 'a', bgColor: '191919' }).bgColor).toBe('#191919');
    expect(parse({ kick: 'a', fontColor: 'FFAA00' }).fontColor).toBe('#FFAA00');
  });

  it('rejects an already-hashed value, a short value, and a name', () => {
    expect(parse({ kick: 'a', bgColor: '#191919' }).bgColor).toBe('');
    expect(parse({ kick: 'a', bgColor: '191' }).bgColor).toBe('');
    expect(parse({ kick: 'a', bgColor: 'red' }).bgColor).toBe('');
    expect(parse({ kick: 'a', fontColor: 'nope' }).fontColor).toBe('');
  });
});

describe('boolean coercion', () => {
  it('default-on flags need exactly "false" to turn off', () => {
    const on = parse({ kick: 'a', msgBold: 'FALSE', ttsEnabled: '0' });
    expect(on.msgBold).toBe(true);
    expect(on.ttsEnabled).toBe(true);

    const off = parse({
      kick: 'a', msgBold: 'false', ttsEnabled: 'false',
      sevenTVEmotesEnabled: 'false', sevenTVCosmeticsEnabled: 'false',
      showCommunityBadges: 'false', showSystemMsgs: 'false', mentionColor: 'false',
      showHypeTrains: 'false', showFirstMessages: 'false', showRedeems: 'false',
      paintShadows: 'false', modAction: 'false',
    });
    expect(off).toMatchObject({
      msgBold: false, ttsEnabled: false, sevenTVEmotesEnabled: false,
      sevenTVCosmeticsEnabled: false, showCommunityBadges: false,
      showSystemMsgs: false, mentionColor: false,
      showFirstMessages: false, showRedeems: false, paintShadows: false,
      modAction: false,
    });
    expect(off).not.toHaveProperty('showHypeTrains');
  });

  it('default-off flags need exactly "true" to turn on', () => {
    const junk = parse({
      kick: 'a', showPinEnabled: 'yes', showAvatars: '1',
      msgCaps: 'TRUE', hideNames: 'on',
    });
    expect(junk).toMatchObject({
      showPinEnabled: false, showAvatars: false, msgCaps: false, hideNames: false,
    });

    const on = parse({
      kick: 'a', showPinEnabled: 'true', showAvatars: 'true',
      msgCaps: 'true', hideNames: 'true',
    });
    expect(on).toMatchObject({
      showPinEnabled: false, showAvatars: true, msgCaps: true, hideNames: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Retired pin parameters                                              */
/* ------------------------------------------------------------------ */

describe('retired pin parameters', () => {
  it('showPinEnabled is always normalized off', () => {
    expect(parse({ kick: 'a' }).showPinEnabled).toBe(false);
    expect(parse({ kick: 'a', showPinEnabled: 'true' }).showPinEnabled).toBe(false);
    expect(parse({ kick: 'a', showPinEnabled: 'false' }).showPinEnabled).toBe(false);
  });

  it('pinPlatforms is always normalized to an empty list', () => {
    expect(parse({ kick: 'a' }).pinPlatforms).toEqual([]);
    expect(parse({ kick: 'a', pinPlatforms: '' }).pinPlatforms).toEqual([]);
    expect(parse({ kick: 'a', pinPlatforms: 'kick,youtube' }).pinPlatforms).toEqual([]);
    expect(parse({ kick: 'a', pinPlatforms: 'discord,irc' }).pinPlatforms).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Unknown keys and repeated parameters                                */
/* ------------------------------------------------------------------ */

describe('unknown keys are stripped, not rejected', () => {
  it('parses successfully and omits them from the result', () => {
    const cfg = parse({
      kick: 'a', label: 'x', weight: '700', tab: 'counter', nonsense: '1',
    });
    expect(cfg.kick).toBe('a');
    expect(cfg).not.toHaveProperty('label');
    expect(cfg).not.toHaveProperty('weight');
    expect(cfg).not.toHaveProperty('tab');
    expect(cfg).not.toHaveProperty('nonsense');
  });
});

describe('repeated (array-valued) parameters fail', () => {
  const cases: Record<string, string | string[]>[] = [
    { kick: ['a', 'b'] },
    { kick: 'a', textSize: ['1', '2'] },
    { kick: 'a', pinPlatforms: ['kick', 'twitch'] },
    { kick: 'a', fade: ['30'] },
    { kick: 'a', msgBold: ['false'] },
  ];

  for (const [index, query] of cases.entries()) {
    it(`case ${index + 1} does not parse`, () => {
      expect(safeParseMultichatConfig(query).success).toBe(false);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Compatibility-only parameters                                      */
/* ------------------------------------------------------------------ */

describe('compatibility-only parameters', () => {
  it('all listed compatibility parameters remain present in a parsed config', () => {
    const cfg = parse({ kick: 'a' }) as Record<string, unknown>;
    for (const key of MULTICHAT_UNREAD_PARAMS) {
      expect(cfg).toHaveProperty(key);
    }
  });

  it('their defaults are unchanged', () => {
    const cfg = parse({ kick: 'a' });
    expect(cfg.ttsEnabled).toBe(true);
    expect(cfg.showAvatars).toBe(false);
  });

  it('explicit values still round-trip through the parser', () => {
    const cfg = parse({
      kick: 'a', ttsEnabled: 'false', showAvatars: 'true',
    });
    expect(cfg).toMatchObject({
      ttsEnabled: false, showAvatars: true,
    });
  });

  it('none of them is emitted by the generator', () => {
    const query = build({}, { kick: 'a' });
    for (const key of MULTICHAT_UNREAD_PARAMS) {
      expect(query).not.toContain(key);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Overlay-versus-generator mode detection                             */
/* ------------------------------------------------------------------ */

describe('mode detection', () => {
  it('no channel means generator mode', () => {
    const cfg = parse({});
    expect(multichatPlatformCount(cfg)).toBe(0);
    expect(hasConfiguredMultichatChannel(cfg)).toBe(false);
  });

  it('any single platform means overlay mode', () => {
    for (const key of ['kick', 'twitch', 'youtube', 'tiktok'] as const) {
      const cfg = parse({ [key]: 'someone' });
      expect(multichatPlatformCount(cfg)).toBe(1);
      expect(hasConfiguredMultichatChannel(cfg)).toBe(true);
    }
  });

  it('counts all four when all four are present', () => {
    const cfg = parse({ kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' });
    expect(multichatPlatformCount(cfg)).toBe(4);
  });

  it('the legacy channel= alias counts as the kick channel', () => {
    const cfg = parse({ channel: 'legacyname' });
    expect(multichatKickChannel(cfg)).toBe('legacyname');
    expect(multichatPlatformCount(cfg)).toBe(1);
  });

  it('kick= wins over channel= when both are present', () => {
    expect(multichatKickChannel(parse({ kick: 'k', channel: 'c' }))).toBe('k');
  });

  it('a whitespace-only channel still counts', () => {
    const cfg = parse({ kick: '   ' });
    expect(cfg.kick).toBe('   ');
    expect(hasConfiguredMultichatChannel(cfg)).toBe(true);
  });

  it('a leading @ on kick is preserved by the parser', () => {
    expect(parse({ kick: '@someone' }).kick).toBe('@someone');
  });
});

/* ------------------------------------------------------------------ */
/* Serializer — complete strings                                      */
/* ------------------------------------------------------------------ */

describe('buildMultichatQuery matches the current generator byte-for-byte', () => {
  const golden: [string, Partial<MultichatGeneratorStyle>, Partial<typeof MULTICHAT_GENERATOR_DEFAULT_CHANNELS>, string][] = [
    ['initial state emits the placeholder channel', {}, {},
      'kick=yourchannel&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['kick only', {}, { kick: 'samplechannel' },
      'kick=samplechannel&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['kick is trimmed', {}, { kick: '  samplechannel  ' },
      'kick=samplechannel&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['kick keeps a leading @, unlike the other three', {}, { kick: '@samplechannel' },
      'kick=%40samplechannel&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['twitch strips a leading @', {}, { twitch: '@forsen' },
      'twitch=forsen&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['all four, in fixed order', {}, { kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' },
      'kick=a&twitch=b&youtube=c&tiktok=d&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['whitespace-only channels still trigger the placeholder', {}, { kick: ' ', twitch: '  ' },
      'kick=yourchannel&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['7TV off', { sevenTVEmotesEnabled: false, sevenTVCosmeticsEnabled: false }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=false&sevenTVCosmeticsEnabled=false&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['community badges off', { showCommunityBadges: false }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&showCommunityBadges=false&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['fade disabled omits the parameter', { fadeEnabled: false }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&hideNames=false'],
    ['fade empty also omits the parameter', { fade: '' }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&hideNames=false'],
    ['platform icons off emits sourceTag=none', { platformIcons: false }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&sourceTag=none&hideNames=false'],
    ['bgColor drops its hash', { bgColor: '#191919' }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&bgColor=191919&hideNames=false'],
    ['emoteScale is emitted when non-empty', { emoteScale: '1.5' }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&emoteScale=1.5&hideNames=false'],
    ['retired pin selections are ignored', { pinPlatforms: ['twitch'] }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['retired showPinEnabled is ignored', { showPinEnabled: true }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['filters are trimmed and percent-encoded', { botNames: ' bot1,bot2 ', userBL: ' x,y ', prefixBL: ' !,? ' }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false&botNames=bot1%2Cbot2&userBL=x%2Cy&prefixBL=%21%2C%3F'],
    ['whitespace-only filters are omitted', { botNames: '  ', userBL: '  ' }, { kick: 'a' },
      'kick=a&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false'],
    ['encoding-sensitive values', { botNames: 'a b,c+d', userBL: 'ü/é', prefixBL: '#,%' }, { kick: 'a b&c' },
      'kick=a+b%26c&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30&hideNames=false&botNames=a+b%2Cc%2Bd&userBL=%C3%BC%2F%C3%A9&prefixBL=%23%2C%25'],
  ];

  for (const [label, style, channels, expected] of golden) {
    it(label, () => {
      expect(build(style, channels)).toBe(expected);
    });
  }

  it('every active control off its default at once', () => {
    expect(build(
      {
        sevenTVEmotesEnabled: false, sevenTVCosmeticsEnabled: false,
        showCommunityBadges: false,
        textSize: 'small', font: 'alsina', textShadow: 'none',
        stroke: 'thicker', animation: 'none', fade: '7', fadeEnabled: true,
        showPinEnabled: true, platformIcons: false, mentionColor: false,
        bgColor: '#0a0a0a', emoteScale: '2', msgBold: false, msgCaps: true,
        modAction: false, paintShadows: false, fontColor: '#ffffff',
        hideNames: true, pinPlatforms: ['twitch', 'tiktok'],
        botNames: 'nightbot', userBL: 'troll', prefixBL: '!',
      },
      { kick: 'kickguy', twitch: '@twitchguy', youtube: '@ytguy', tiktok: '@ttguy' },
    )).toBe(
      'kick=kickguy&twitch=twitchguy&youtube=ytguy&tiktok=ttguy&sevenTVEmotesEnabled=false&sevenTVCosmeticsEnabled=false&showCommunityBadges=false&textSize=small&font=alsina&textShadow=none&stroke=thicker&animation=none&fade=7&sourceTag=none&mentionColor=false&bgColor=0a0a0a&emoteScale=2&msgBold=false&msgCaps=true&modAction=false&paintShadows=false&fontColor=ffffff&hideNames=true&botNames=nightbot&userBL=troll&prefixBL=%21',
    );
  });

  it('emits no retired pin params, fragment, or leading question mark', () => {
    const query = build({ showPinEnabled: true, pinPlatforms: ['twitch'] }, { kick: 'a' });
    expect(query.startsWith('?')).toBe(false);
    expect(query).not.toContain('#');
    expect(query).not.toContain('showPinEnabled');
    expect(query).not.toContain('pinPlatforms');
    expect(query).not.toContain('twitchConnectionId');
  });
});

/* ------------------------------------------------------------------ */
/* Round-trips                                                         */
/* ------------------------------------------------------------------ */

describe('parse(build(state)) round-trips', () => {
  it('serialized active fields survive a round-trip', () => {
    const style: MultichatGeneratorStyle = {
      ...MULTICHAT_GENERATOR_DEFAULTS,
      showCommunityBadges: false,
      textSize: 'large', font: 'impact', textShadow: 'medium',
      stroke: 'thick', animation: 'fade', fade: '12', fadeEnabled: true,
      showPinEnabled: true, platformIcons: false, mentionColor: false,
      bgColor: '#191919', emoteScale: '1.5', msgBold: false, msgCaps: true,
      modAction: false, paintShadows: false, fontColor: '#ffaa00',
      hideNames: true, pinPlatforms: ['kick', 'twitch'],
      botNames: 'nightbot', userBL: 'troll', prefixBL: '!',
    };
    const query = buildMultichatQuery({ kick: 'a', twitch: 'b', youtube: '', tiktok: '' }, style);
    const cfg = parse(Object.fromEntries(new URLSearchParams(query)));

    expect(cfg.showCommunityBadges).toBe(false);
    expect(cfg.textSize).toBe('large');
    expect(cfg.font).toBe('impact');
    expect(cfg.textShadow).toBe('medium');
    expect(cfg.stroke).toBe('thick');
    expect(cfg.animation).toBe('fade');
    expect(cfg.fade).toBe(12);
    expect(cfg.showPinEnabled).toBe(false);
    expect(cfg.sourceTag).toBe('none');
    expect(cfg.mentionColor).toBe(false);
    expect(cfg.bgColor).toBe('#191919');
    expect(cfg.emoteScale).toBe(1.5);
    expect(cfg.msgBold).toBe(false);
    expect(cfg.msgCaps).toBe(true);
    expect(cfg.modAction).toBe(false);
    expect(cfg.paintShadows).toBe(false);
    expect(cfg.fontColor).toBe('#ffaa00');
    expect(cfg.hideNames).toBe(true);
    expect(cfg.pinPlatforms).toEqual([]);
    expect(cfg.botNames).toBe('nightbot');
    expect(cfg.userBL).toBe('troll');
    expect(cfg.prefixBL).toBe('!');
    expect(cfg.kick).toBe('a');
    expect(cfg.twitch).toBe('b');
  });

  it('the generator default state round-trips to the shared large-shadow default', () => {
    const query = build({}, { kick: 'a' });
    expect(parse(Object.fromEntries(new URLSearchParams(query))).textShadow)
      .toBe('large');
  });

  it('documented lossy cases stay lossy', () => {
    /* fade disabled → parameter absent → parses back as false, not '30'. */
    const faded = parse(Object.fromEntries(new URLSearchParams(
      build({ fadeEnabled: false }, { kick: 'a' }),
    )));
    expect(faded.fade).toBe(false);

    /* retired pins are omitted by the generator and parse back disabled. */
    const retiredPins = parse(Object.fromEntries(new URLSearchParams(
      build({ showPinEnabled: true, pinPlatforms: ['kick', 'twitch'] }, { kick: 'a' }),
    )));
    expect(retiredPins.showPinEnabled).toBe(false);
    expect(retiredPins.pinPlatforms).toEqual([]);

    /* no channel → placeholder, so the parsed channel is not the empty input. */
    const placeholder = parse(Object.fromEntries(new URLSearchParams(build())));
    expect(placeholder.kick).toBe('yourchannel');
  });
});
