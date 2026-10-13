/* Platform chip parity.
 *
 * The workspace styles channel fields with Tailwind ws-<platform> tokens, while
 * the overlay renders source tags from lib/render's PROVIDERS. Those are two
 * copies of the same four brand colours, in two places, consumed at two
 * different times — build and render. This asserts they agree, so a chip cannot
 * claim Kick is one green while the overlay draws another.
 */
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';
import { PROVIDERS } from '@/lib/render';
import {
  CHIP_BASE,
  PLATFORM_CHIP,
  chipClass,
  isChipPlatform,
} from '@/lib/tools/platformChrome';
import type { Platform } from '@/lib/types';

const PLATFORMS: readonly Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];

/** The ws- colour tokens, read from the real config rather than restated. */
const colors = (
  tailwindConfig as {
    theme: { extend: { colors: Record<string, string> } };
  }
).theme.extend.colors;

describe('platform chip tokens match the overlay brand colours', () => {
  for (const platform of PLATFORMS) {
    it(`ws-${platform} equals PROVIDERS.${platform}.color`, () => {
      expect(colors[`ws-${platform}`]?.toLowerCase()).toBe(
        PROVIDERS[platform].color.toLowerCase(),
      );
    });
  }
});

describe('chip class strings', () => {
  it('covers exactly the four known platforms', () => {
    expect(Object.keys(PLATFORM_CHIP).sort()).toEqual([...PLATFORMS].sort());
  });

  it('composes the shared base with the per-platform colours', () => {
    for (const platform of PLATFORMS) {
      const cls = chipClass(platform);
      expect(cls.startsWith(CHIP_BASE)).toBe(true);
      expect(cls).toContain(PLATFORM_CHIP[platform]);
    }
  });

  it('references each platform token by name, so purging keeps them', () => {
    for (const platform of PLATFORMS) {
      expect(PLATFORM_CHIP[platform]).toContain(`text-ws-${platform}`);
    }
  });
});

describe('isChipPlatform', () => {
  it('accepts the four platforms', () => {
    for (const platform of PLATFORMS) expect(isChipPlatform(platform)).toBe(true);
  });

  it('rejects a channel key that is not a platform', () => {
    /* A tool may declare channel keys that are not platforms; those must render
       no chip rather than an undefined class string. */
    expect(isChipPlatform('discord')).toBe(false);
    expect(isChipPlatform('')).toBe(false);
  });

  it('rejects inherited Object properties', () => {
    /* hasOwnProperty, not `in`: `'toString' in PLATFORM_CHIP` is true. */
    expect(isChipPlatform('toString')).toBe(false);
    expect(isChipPlatform('constructor')).toBe(false);
  });
});
