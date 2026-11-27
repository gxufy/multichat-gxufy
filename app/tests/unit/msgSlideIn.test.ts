import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { normalizeMultichatStyle } from '@/features/multichat/config';
import { resetRuntimeAnimationState } from '@/lib/multichatAnimationRuntime';
import { MULTICHAT_GENERATOR_DEFAULTS, MultichatQuerySchema, buildMultichatQuery } from '@/lib/multichatConfig';

const channels = { kick: 'gxufy', twitch: '', youtube: '', tiktok: '' };

beforeEach(() => resetRuntimeAnimationState());

describe('directional entrance configuration', () => {
  it('defaults Off independently of the main Slide animation', () => {
    const parsed = MultichatQuerySchema.parse({});
    expect(parsed.animation).toBe('slide');
    expect(parsed.entryAnimation).toBe('none');
  });

  it.each(['none', 'slideRight', 'slideLeft'] as const)(
    'accepts entryAnimation=%s without changing the main animation',
    (entryAnimation) => {
      const parsed = MultichatQuerySchema.parse({ animation: 'fade', entryAnimation });
      expect(parsed.animation).toBe('fade');
      expect(parsed.entryAnimation).toBe(entryAnimation);
    },
  );

  it.each(['1', 'true'])(
    'maps legacy msgSlideIn=%s to From right',
    (msgSlideIn) => {
      const parsed = MultichatQuerySchema.parse({ msgSlideIn });
      expect(parsed.entryAnimation).toBe('slideRight');
      expect('msgSlideIn' in parsed).toBe(false);
    },
  );

  it.each(['0', 'false', 'off'])(
    'keeps legacy msgSlideIn=%s Off',
    (msgSlideIn) => {
      expect(MultichatQuerySchema.parse({ msgSlideIn }).entryAnimation).toBe('none');
    },
  );

  it('lets an explicit entryAnimation value win over the legacy alias', () => {
    expect(MultichatQuerySchema.parse({ entryAnimation: 'slideLeft', msgSlideIn: '1' }).entryAnimation)
      .toBe('slideLeft');
    expect(MultichatQuerySchema.parse({ entryAnimation: 'none', msgSlideIn: 'true' }).entryAnimation)
      .toBe('none');
  });

  it('serializes only non-default modern values and never emits msgSlideIn', () => {
    for (const entryAnimation of ['none', 'slideRight', 'slideLeft'] as const) {
      const params = new URLSearchParams(buildMultichatQuery(channels, {
        ...MULTICHAT_GENERATOR_DEFAULTS,
        entryAnimation,
      }));
      expect(params.get('entryAnimation')).toBe(entryAnimation === 'none' ? null : entryAnimation);
      expect(params.has('msgSlideIn')).toBe(false);
    }
  });

  it('migrates old saved workspace state without changing the main animation', () => {
    expect(normalizeMultichatStyle({ msgSlideIn: true }).entryAnimation).toBe('slideRight');
    expect(normalizeMultichatStyle({ animation: 'fade', msgSlideIn: true })).toMatchObject({
      animation: 'fade',
      entryAnimation: 'slideRight',
    });
    expect(normalizeMultichatStyle({ entryAnimation: 'slideLeft', msgSlideIn: true }).entryAnimation)
      .toBe('slideLeft');
    expect(normalizeMultichatStyle({ entryAnimation: 'none', msgSlideIn: true }).entryAnimation)
      .toBe('none');
  });
});
