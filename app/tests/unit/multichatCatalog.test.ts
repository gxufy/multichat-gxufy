/* MultiChat descriptor/catalog integrity and serializer identity.
 *
 * The parser contract lives in multichatConfig.test.ts. This suite verifies the
 * workspace adapter, current defaults, hidden retired pin descriptors, and the
 * exact serializer shape the descriptor exposes.
 */
import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_ANIMATIONS,
  MULTICHAT_FONTS,
  MULTICHAT_FONT_WEIGHTS,
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_PLATFORMS,
  MULTICHAT_SOURCE_TAGS,
  MULTICHAT_SOURCE_TAG_ORDER,
  MULTICHAT_STROKES,
  MULTICHAT_TEXT_SHADOWS,
  MULTICHAT_TEXT_SIZES,
  MULTICHAT_TEXT_TRANSFORMS,
  MULTICHAT_UNREAD_PARAMS,
  MULTICHAT_WORKSPACE_DEFAULTS,
  MultichatQuerySchema,
  buildMultichatQuery,
  multichatSourceTagOf,
  type MultichatPlatform,
  type MultichatWorkspaceStyle,
} from '@/lib/multichatConfig';
import {
  MULTICHAT_PLATFORM_DEFS,
  configuredMultichatPlatforms,
  multichatTool,
  normalizeMultichatStyle,
  normalizePinPlatforms,
  toMultichatChannels,
} from '@/features/multichat/config';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';
import { TOOLS, TOOL_IDS, findTool } from '@/features/registry';

const D = MULTICHAT_WORKSPACE_DEFAULTS;
const GENERATOR = MULTICHAT_GENERATOR_DEFAULTS;
const noChannels = { kick: '', twitch: '', youtube: '', tiktok: '' };

const DEFAULT_QUERY =
  'kick=yourchannel' +
  '&sevenTVEmotesEnabled=true' +
  '&sevenTVCosmeticsEnabled=true' +
  '&textSize=medium' +
  '&font=opensans' +
  '&textShadow=large' +
  '&stroke=none' +
  '&animation=slide' +
  '&fade=30' +
  '&hideNames=false';

const serializePair = (
  channels: Partial<Record<MultichatPlatform, string>>,
  style: MultichatWorkspaceStyle,
) => ({
  viaTool: multichatTool.serialize(channels, style),
  viaAuthority: buildMultichatQuery(toMultichatChannels(channels), style),
});

describe('generator compatibility shape', () => {
  it('produces the current default string exactly', () => {
    expect(buildMultichatQuery(noChannels, GENERATOR)).toBe(DEFAULT_QUERY);
  });

  it('keeps platformIcons on the generator shape and maps it to sourceTag', () => {
    expect(GENERATOR.platformIcons).toBe(true);
    expect('sourceTag' in GENERATOR).toBe(false);
    expect(multichatSourceTagOf({ ...GENERATOR, platformIcons: true })).toBe('icon');
    expect(multichatSourceTagOf({ ...GENERATOR, platformIcons: false })).toBe('none');
  });

  it('emits sourceTag=none in the stable serializer slot', () => {
    expect(buildMultichatQuery(noChannels, { ...GENERATOR, platformIcons: false })).toBe(
      DEFAULT_QUERY.replace('&hideNames=false', '&sourceTag=none&hideNames=false'),
    );
  });

  it('retired pin fields are harmless even when legacy callers set them', () => {
    for (const style of [
      { ...GENERATOR, showPinEnabled: true },
      { ...GENERATOR, pinPlatforms: ['twitch'] },
      { ...GENERATOR, showPinEnabled: true, pinPlatforms: ['kick', 'twitch'] },
    ]) {
      const query = buildMultichatQuery(noChannels, style);
      expect(query).toBe(DEFAULT_QUERY);
      expect(query).not.toContain('showPinEnabled');
      expect(query).not.toContain('pinPlatforms');
    }
  });

  it('community badges remain on by omission and serialize only when disabled', () => {
    expect(buildMultichatQuery(noChannels, GENERATOR)).not.toContain('showCommunityBadges');
    expect(buildMultichatQuery(noChannels, { ...GENERATOR, showCommunityBadges: false }))
      .toContain('showCommunityBadges=false');
  });
});

describe('message entrance catalog and migration', () => {
  it('exposes the live main animation and separate entrance vocabularies', () => {
    const entry = MULTICHAT_CATALOG.find(
      (setting) => setting.key === 'animation',
    );

    expect(entry).toBeDefined();
    expect(entry?.type).toBe('select');

    if (!entry || entry.type !== 'select') {
      throw new Error('animation must be a select setting');
    }

    expect(entry.label).toBe('Animation');
    expect(entry.default).toBe('slide');
    expect(entry.options.map((option) => [option.value, option.label])).toEqual([
      ['none', 'None'],
      ['slide', 'Slide'],
      ['fade', 'Fade in'],
    ]);

    expect(entry.options.map((option) => option.value)).toEqual(
      [...MULTICHAT_ANIMATIONS],
    );
    const entrance = MULTICHAT_CATALOG.find((setting) => setting.key === 'entryAnimation');
    expect(entrance?.type).toBe('select');
    if (!entrance || entrance.type !== 'select') {
      throw new Error('entryAnimation must be a select setting');
    }
    expect(entrance.label).toBe('New message entrance');
    expect(entrance.default).toBe('none');
    expect(entrance.options.map((option) => [option.value, option.label])).toEqual([
      ['none', 'Off'],
      ['slideRight', 'From right'],
      ['slideLeft', 'From left'],
    ]);
    expect(MULTICHAT_CATALOG.some((setting) => String(setting.key) === 'msgSlideIn'))
      .toBe(false);
  });

  it('migrates the legacy right entrance without changing valid main animation', () => {
    expect(normalizeMultichatStyle({ msgSlideIn: true }).entryAnimation).toBe('slideRight');
    expect(normalizeMultichatStyle({ entryAnimation: 'slideLeft' }).entryAnimation)
      .toBe('slideLeft');
    expect(normalizeMultichatStyle({ animation: 'none', msgSlideIn: true })).toMatchObject({
      animation: 'none',
      entryAnimation: 'slideRight',
    });
    expect(normalizeMultichatStyle({ animation: 'fade', entryAnimation: 'slideRight' }))
      .toMatchObject({ animation: 'fade', entryAnimation: 'slideRight' });
  });

  it('serializes and round-trips main animation independently from entrance', () => {
    for (const animation of MULTICHAT_ANIMATIONS) {
      const query = multichatTool.serialize(
        { kick: 'a' },
        { ...D, animation },
      );
      const params = new URLSearchParams(query);
      const parsed = MultichatQuerySchema.parse(
        Object.fromEntries(params),
      );
      expect(params.get('animation')).toBe(animation);
      expect(params.has('entryAnimation')).toBe(false);
      expect(params.has('msgSlideIn')).toBe(false);
      expect(parsed.animation).toBe(animation);
      expect(parsed.entryAnimation).toBe('none');
      expect('msgSlideIn' in parsed).toBe(false);
    }

    for (const entryAnimation of ['slideRight', 'slideLeft'] as const) {
      const params = new URLSearchParams(multichatTool.serialize(
        { kick: 'a' },
        { ...D, entryAnimation },
      ));
      expect(params.get('entryAnimation')).toBe(entryAnimation);
      expect(params.has('msgSlideIn')).toBe(false);
      expect(MultichatQuerySchema.parse(Object.fromEntries(params)).entryAnimation)
        .toBe(entryAnimation);
    }
  });
});

describe('typography catalog and migration', () => {
  it('exposes every weight, transform, and original size preset while hiding internal controls', () => {
    const values = (key: string) => {
      const setting = MULTICHAT_CATALOG.find((entry) => entry.key === key);
      return setting?.type === 'select'
        ? setting.options.map((option) => option.value)
        : undefined;
    };
    expect(values('fontWeight')).toEqual([...MULTICHAT_FONT_WEIGHTS]);
    expect(values('textTransform')).toEqual([...MULTICHAT_TEXT_TRANSFORMS]);
    expect(values('textSize')).toEqual(['small', 'medium', 'large']);
    expect(MULTICHAT_CATALOG.find((entry) => entry.key === 'textSize')?.hidden).not.toBe(true);
    expect(MULTICHAT_CATALOG.find((entry) => entry.key === 'textSizePx')?.hidden).toBe(true);
    expect(MULTICHAT_CATALOG.find((entry) => entry.key === 'msgCaps')?.hidden).toBe(true);
    expect(MULTICHAT_CATALOG.some((entry) => String(entry.key) === 'smallCaps')).toBe(false);
  });

  it('migrates old uppercase workspace state into the Transform control', () => {
    const migrated = normalizeMultichatStyle({ msgCaps: true });
    expect(migrated.textTransform).toBe('uppercase');
    expect(migrated.msgCaps).toBe(true);

    const normal = normalizeMultichatStyle({ msgCaps: true, textTransform: 'none' });
    expect(normal.textTransform).toBe('none');
    expect(normal.msgCaps).toBe(false);
  });

  it('normalizes the internal pixel size, weight, and italic controls', () => {
    expect(normalizeMultichatStyle({
      textSizePx: '80',
      fontWeight: '600',
      fontItalic: true,
    })).toMatchObject({
      textSizePx: '64',
      fontWeight: '600',
      fontItalic: true,
    });
    expect(normalizeMultichatStyle({
      textSizePx: 'broken',
      fontWeight: '950' as never,
    })).toMatchObject({
      textSizePx: '',
      fontWeight: '800',
    });
  });
});

describe('descriptor identity', () => {
  it('declares the stable id, route, and OBS size', () => {
    expect(multichatTool.id).toBe('multichat');
    expect(multichatTool.label).toBe('MultiChat');
    expect(multichatTool.overlayRoute).toBe('/multichat');
    expect(multichatTool.obs).toEqual({ width: 680, height: 280 });
  });

  it('uses the authoritative workspace defaults by reference', () => {
    expect(multichatTool.defaults).toBe(MULTICHAT_WORKSPACE_DEFAULTS);
  });

  it('derives workspace defaults from generator defaults without platformIcons', () => {
    const { platformIcons, ...shared } = GENERATOR;
    expect(D).toEqual({
      ...shared,
      showPinEnabled: false,
      pinPlatforms: [],
      smoothScroll: true,
      sourceTag: 'icon',
    });
    expect(platformIcons).toBe(true);
    expect('platformIcons' in D).toBe(false);
  });

  it('uses the shared legacy chat defaults', () => {
    expect(GENERATOR.textShadow).toBe('large');
    expect(D.textShadow).toBe('large');
    expect(MultichatQuerySchema.parse({}).textShadow).toBe('large');
    expect(GENERATOR.font).toBe('opensans');
    expect(D.font).toBe('opensans');
    expect(GENERATOR.msgBold).toBe(true);
    expect(D.msgBold).toBe(true);
  });

  it('has no URL context/connection fragment provider after pin retirement', () => {
    expect(multichatTool.context).toBeUndefined();
  });
});

describe('registration boundary', () => {
  it('is registered first and findable by id', () => {
    expect(TOOLS).toHaveLength(2);
    expect(TOOLS[0]?.id).toBe('multichat');
    expect(TOOL_IDS).toEqual(['multichat', 'counter']);
    const registered = findTool('multichat');
    expect(registered).toBe(TOOLS[0]);
    expect(registered?.id).toBe(multichatTool.id);
    expect(registered?.label).toBe(multichatTool.label);
    expect(registered?.overlayRoute).toBe(multichatTool.overlayRoute);
    expect(registered?.obs).toEqual(multichatTool.obs);
  });

  it('keeps /multichat as the overlay route', () => {
    expect(findTool('multichat')?.overlayRoute).toBe('/multichat');
  });
});

describe('platforms', () => {
  const keys = MULTICHAT_PLATFORM_DEFS.map((platform) => platform.key);

  it('matches the generator order and authoritative platform tuple', () => {
    expect(keys).toEqual(['kick', 'twitch', 'youtube', 'tiktok']);
    expect(keys).toEqual([...MULTICHAT_PLATFORMS]);
  });

  it('gives every platform a label and the expected placeholder', () => {
    expect(MULTICHAT_PLATFORM_DEFS.map((p) => p.label)).toEqual([
      'Kick', 'Twitch', 'YouTube', 'TikTok',
    ]);
    expect(MULTICHAT_PLATFORM_DEFS.map((p) => p.placeholder)).toEqual([
      'Channel name', 'Channel name', '@handle', '@username',
    ]);
  });

  it('preserves the @ asymmetry: kick keeps it, the others strip it', () => {
    const by = (key: MultichatPlatform) =>
      MULTICHAT_PLATFORM_DEFS.find((p) => p.key === key)!.normalize;
    expect(by('kick')('@someone')).toBe('@someone');
    expect(by('twitch')('@someone')).toBe('someone');
    expect(by('youtube')('@someone')).toBe('someone');
    expect(by('tiktok')('@someone')).toBe('someone');
  });

  it('trims input without adding counter-style validation', () => {
    for (const platform of MULTICHAT_PLATFORM_DEFS) {
      expect(platform.normalize('  spaced  ')).toBe('spaced');
      expect(platform.normalize('a b!$%')).toBe('a b!$%');
      expect(platform.normalize(undefined)).toBe('');
    }
  });
});

describe('configured platforms', () => {
  it('is empty when nothing usable is typed', () => {
    expect(configuredMultichatPlatforms({})).toEqual([]);
    expect(configuredMultichatPlatforms({ kick: '', twitch: '   ' })).toEqual([]);
  });

  it('lists normalized channels in descriptor order', () => {
    expect(configuredMultichatPlatforms({ tiktok: 'c', kick: 'a', youtube: 'b' }))
      .toEqual(['kick', 'youtube', 'tiktok']);
  });

  it('agrees with the descriptor method', () => {
    expect(multichatTool.configuredPlatforms({ kick: 'a' })).toEqual(['kick']);
    expect(multichatTool.configuredPlatforms({})).toEqual([]);
  });
});

describe('catalog integrity', () => {
  const keys = MULTICHAT_CATALOG.map((setting) => setting.key);

  it('uses unique keys and only the fade pair shares a query parameter', () => {
    expect(new Set(keys).size).toBe(keys.length);
    const params = MULTICHAT_CATALOG.map((setting) => setting.param);
    const duplicated = params.filter((p, i) => params.indexOf(p) !== i);
    expect(duplicated).toEqual(['fade']);
  });

  it('covers every workspace style field and no channel fields', () => {
    expect([...keys].sort()).toEqual(Object.keys(D).sort());
    for (const platform of MULTICHAT_PLATFORMS) expect(keys).not.toContain(platform);
    expect(keys).not.toContain('channel');
    expect(keys).not.toContain('platformIcons');
  });

  it('contains none of the unread parser-only compatibility parameters', () => {
    const params = MULTICHAT_CATALOG.map((setting) => setting.param);
    for (const unread of MULTICHAT_UNREAD_PARAMS) {
      expect(keys).not.toContain(unread);
      expect(params).not.toContain(unread);
    }
  });

  it('takes every default from the authoritative workspace defaults', () => {
    for (const setting of MULTICHAT_CATALOG) {
      expect(setting.default).toEqual(D[setting.key]);
    }
  });

  it('exposes community badges as a normal enabled toggle', () => {
    const setting = MULTICHAT_CATALOG.find((s) => s.key === 'showCommunityBadges');
    expect(setting?.type).toBe('toggle');
    expect(setting?.default).toBe(true);
    expect(setting?.hidden).toBeUndefined();
    expect(setting?.disabled).toBeUndefined();
  });

  it('retains both pin descriptors only as hidden disabled compatibility entries', () => {
    for (const key of ['showPinEnabled', 'pinPlatforms'] as const) {
      const setting = MULTICHAT_CATALOG.find((s) => s.key === key);
      expect(setting).toBeDefined();
      expect(setting?.hidden).toBe(true);
      expect(setting?.disabled).toBe(true);
    }
    const pins = MULTICHAT_CATALOG.find((s) => s.key === 'pinPlatforms');
    expect(pins?.default).toEqual([]);
  });

  it('sources every select option list from authoritative tuples', () => {
    const values = (key: string) => {
      const setting = MULTICHAT_CATALOG.find((s) => s.key === key);
      return setting && setting.type === 'select'
        ? setting.options.map((option) => option.value)
        : undefined;
    };
    expect(values('textSize')).toEqual([...MULTICHAT_TEXT_SIZES]);
    expect(values('textShadow')).toEqual([...MULTICHAT_TEXT_SHADOWS]);
    expect(values('stroke')).toEqual([...MULTICHAT_STROKES]);
    expect(values('animation')).toEqual([...MULTICHAT_ANIMATIONS]);
    expect(values('font')).toEqual([...MULTICHAT_FONTS]);
    expect(values('fontWeight')).toEqual([...MULTICHAT_FONT_WEIGHTS]);
    expect(values('textTransform')).toEqual([...MULTICHAT_TEXT_TRANSFORMS]);
    expect(values('sourceTag')).toEqual([...MULTICHAT_SOURCE_TAG_ORDER]);
  });

  it('sourceTag display values are exactly the parser values in display order', () => {
    expect([...MULTICHAT_SOURCE_TAG_ORDER].sort()).toEqual([...MULTICHAT_SOURCE_TAGS].sort());
  });
});

describe('normalization', () => {
  it('fills an empty object with the workspace defaults in a fresh object', () => {
    const result = normalizeMultichatStyle({});
    expect(result).toEqual(D);
    expect(result).not.toBe(D);
  });

  it('keeps valid active values and falls malformed enums back to defaults', () => {
    expect(normalizeMultichatStyle({
      textSize: 'large',
      textShadow: 'medium',
      sourceTag: 'dot',
      showCommunityBadges: false,
      smoothScroll: false,
      bgColor: '#191919',
    })).toMatchObject({
      textSize: 'large',
      textShadow: 'medium',
      sourceTag: 'dot',
      showCommunityBadges: false,
      smoothScroll: false,
      bgColor: '#191919',
    });
    expect(normalizeMultichatStyle({ textShadow: 'enormous' as never }).textShadow)
      .toBe('large');
    expect(normalizeMultichatStyle({ sourceTag: 'bad' as never }).sourceTag)
      .toBe('icon');
  });

  it('always retires pin state regardless of saved input', () => {
    for (const input of [
      {},
      { showPinEnabled: true },
      { pinPlatforms: ['twitch'] },
      { showPinEnabled: true, pinPlatforms: ['kick', 'twitch'] },
    ]) {
      const result = normalizeMultichatStyle(input as Partial<MultichatWorkspaceStyle>);
      expect(result.showPinEnabled).toBe(false);
      expect(result.pinPlatforms).toEqual([]);
    }
    expect(normalizePinPlatforms(['kick', 'twitch'])).toEqual([]);
    expect(normalizePinPlatforms('kick')).toEqual([]);
  });

  it('does not mutate input or authoritative defaults', () => {
    const input: Partial<MultichatWorkspaceStyle> = {
      textSize: 'large',
      pinPlatforms: ['twitch'],
    };
    const inputSnapshot = { ...input, pinPlatforms: [...(input.pinPlatforms ?? [])] };
    const defaultsSnapshot = JSON.parse(JSON.stringify(D));
    normalizeMultichatStyle(input);
    expect(input).toEqual(inputSnapshot);
    expect(D).toEqual(defaultsSnapshot);
  });

  it('never leaks platformIcons into workspace output', () => {
    const result = normalizeMultichatStyle({ platformIcons: false } as never);
    expect('platformIcons' in result).toBe(false);
    expect(result.sourceTag).toBe('icon');
  });
});

describe('serializer byte identity', () => {
  const expectIdentical = (
    channels: Partial<Record<MultichatPlatform, string>>,
    style: MultichatWorkspaceStyle,
  ) => {
    const { viaTool, viaAuthority } = serializePair(channels, style);
    expect(viaTool).toBe(viaAuthority);
    return viaTool;
  };

  it('produces the exact expected default string', () => {
    expect(multichatTool.serialize({}, D)).toBe(DEFAULT_QUERY);
  });

  it('matches for each platform and all four together', () => {
    for (const platform of MULTICHAT_PLATFORMS) {
      expectIdentical({ [platform]: 'someone' }, D);
    }
    expect(expectIdentical(
      { kick: 'k', twitch: 't', youtube: 'y', tiktok: 'tt' },
      D,
    )).not.toContain('yourchannel');
  });

  it('matches for representative active setting changes', () => {
    const states: MultichatWorkspaceStyle[] = [
      { ...D, textSize: 'large', font: 'impact', stroke: 'thick', textShadow: 'none' },
      { ...D, sourceTag: 'dot' },
      { ...D, sourceTag: 'label' },
      { ...D, showCommunityBadges: false },
      { ...D, fadeEnabled: false },
      { ...D, msgBold: false, msgCaps: true, hideNames: true, mentionColor: false },
      { ...D, bgColor: '#191919', fontColor: '#ff0000', emoteScale: '1.5' },
      { ...D, botNames: 'nightbot, streamelements', userBL: 'a b', prefixBL: 'https://' },
    ];
    for (const style of states) expectIdentical({ kick: 'someone' }, style);
  });

  it('emits each sourceTag distinctly and in the current stable position', () => {
    const icon = multichatTool.serialize({}, { ...D, sourceTag: 'icon' });
    expect(icon).toBe(DEFAULT_QUERY);
    expect(icon).not.toContain('sourceTag');

    for (const tag of ['dot', 'label', 'none'] as const) {
      const url = multichatTool.serialize({}, { ...D, sourceTag: tag });
      expect(url).toBe(DEFAULT_QUERY.replace('&hideNames=false', `&sourceTag=${tag}&hideNames=false`));
      expect(url).toContain(`sourceTag=${tag}`);
    }
  });

  it('round-trips every sourceTag through the parser', () => {
    for (const tag of MULTICHAT_SOURCE_TAGS) {
      const url = multichatTool.serialize({ kick: 'a' }, { ...D, sourceTag: tag });
      const parsed = MultichatQuerySchema.parse(Object.fromEntries(new URLSearchParams(url)));
      expect(parsed.sourceTag).toBe(tag);
    }
  });

  it('never emits retired pin params even when state is contaminated', () => {
    const url = multichatTool.serialize(
      { kick: 'a' },
      { ...D, showPinEnabled: true, pinPlatforms: ['kick', 'twitch'] },
    );
    expect(url).not.toContain('showPinEnabled');
    expect(url).not.toContain('pinPlatforms');
  });

  it('matches for fade enabled, disabled, and blank', () => {
    expect(expectIdentical({ kick: 'a' }, { ...D, fadeEnabled: true, fade: '30' }))
      .toContain('fade=30');
    expect(expectIdentical({ kick: 'a' }, { ...D, fadeEnabled: false, fade: '30' }))
      .not.toContain('fade=');
    expect(expectIdentical({ kick: 'a' }, { ...D, fadeEnabled: true, fade: '' }))
      .not.toContain('fade=');
  });

  it('emits no fragment or leading question mark', () => {
    const url = expectIdentical({ kick: 'a' }, normalizeMultichatStyle({}));
    expect(url).not.toContain('#');
    expect(url.startsWith('?')).toBe(false);
  });
});
