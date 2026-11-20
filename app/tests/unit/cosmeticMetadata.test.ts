import { describe, expect, it } from 'vitest';
import {
  COSMETIC_METADATA_LIMITS,
  createSevenTVBadgeFromEvent,
  parseCosmeticBadge,
  parseSevenTVBadge,
  parseSevenTVPaint,
  sevenTVBadgeImageFromHost,
  validateCosmeticAssetUrl,
} from '@/lib/cosmeticMetadata';
import { buildPaintStyle } from '@/lib/multichatMessageModel';
import type { SevenTVPaint } from '@/lib/kick';

const gradient = (overrides: Record<string, unknown> = {}) => ({
  id: 'paint-1',
  function: 'LINEAR_GRADIENT',
  angle: 90,
  color: 0x11223380,
  repeat: false,
  stops: [
    { color: 0xff0000ff, at: 0 },
    { color: 0x0000ffff, at: 1 },
  ],
  shadows: [{ color: 0x00000080, x_offset: 1, y_offset: 2, radius: 3 }],
  ...overrides,
});

describe('provider cosmetic asset URL policy', () => {
  it('accepts only normalized HTTPS URLs on each fixed cosmetic CDN', () => {
    expect(validateCosmeticAssetUrl('https://cdn.7tv.app/paint/a.webp?version=2', '7tv'))
      .toBe('https://cdn.7tv.app/paint/a.webp?version=2');
    expect(validateCosmeticAssetUrl('https://images.cdn.7tv.app/paint/a.webp', '7tv'))
      .toBe('https://images.cdn.7tv.app/paint/a.webp');
    expect(validateCosmeticAssetUrl('https://cdn.frankerfacez.com/badge/a.png', 'ffz')).not.toBeNull();
    expect(validateCosmeticAssetUrl('https://cdn2.frankerfacez.com/badge/a.png', 'ffz')).not.toBeNull();
    expect(validateCosmeticAssetUrl('https://cdn.betterttv.net/badges/a.svg', 'bttv')).not.toBeNull();
    expect(validateCosmeticAssetUrl('https://cdn.7tv.app./badge/a.webp', '7tv'))
      .toBe('https://cdn.7tv.app/badge/a.webp');
  });

  it.each([
    'http://cdn.7tv.app/paint.webp',
    'https://user:secret@cdn.7tv.app/paint.webp',
    'https://cdn.7tv.app/paint.webp#fragment',
    'https://cdn.7tv.app:8443/paint.webp',
    'https://localhost/paint.webp',
    'https://127.0.0.1/paint.webp',
    'https://10.0.0.1/paint.webp',
    'https://cdn.7tv.app.evil.example/paint.webp',
    'https://notcdn.7tv.app.example/paint.webp',
    'https://example.com/paint.webp',
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'blob:https://cdn.7tv.app/id',
    'file:///tmp/paint.webp',
    'not a URL',
  ])('rejects an unsafe or unrelated 7TV asset: %s', (url) => {
    expect(validateCosmeticAssetUrl(url, '7tv')).toBeNull();
  });

  it('does not let one provider use another provider cosmetic CDN', () => {
    expect(validateCosmeticAssetUrl('https://cdn.betterttv.net/badge.svg', 'ffz')).toBeNull();
    expect(validateCosmeticAssetUrl('https://cdn.frankerfacez.com/badge.png', '7tv')).toBeNull();
  });

  it('builds only allowlisted 7TV badge images', () => {
    expect(sevenTVBadgeImageFromHost('//cdn.7tv.app/badge/a')).toBe('https://cdn.7tv.app/badge/a/3x');
    expect(sevenTVBadgeImageFromHost('//media.cdn.7tv.app/badge/a')).toBe('https://media.cdn.7tv.app/badge/a/3x');
    expect(sevenTVBadgeImageFromHost('//evil.example/badge/a')).toBeNull();
    expect(sevenTVBadgeImageFromHost('//cdn.7tv.app/badge/a?token=secret')).toBeNull();
    expect(parseSevenTVBadge({ id: 'badge-a', host: { url: '//cdn.7tv.app/badge/a' } }))
      .toEqual({ id: 'badge-a', image: 'https://cdn.7tv.app/badge/a/3x' });
    expect(parseCosmeticBadge({ id: 'ffz-a', image: 'https://cdn.frankerfacez.com/a.png' }, 'ffz'))
      .not.toBeNull();
  });

  it('keeps the fixed event fallback but rejects a supplied hostile host', () => {
    expect(createSevenTVBadgeFromEvent('badge-a', undefined)).toEqual({
      id: 'badge-a',
      image: 'https://cdn.7tv.app/badge/badge-a/3x',
    });
    expect(createSevenTVBadgeFromEvent('badge-a', '//evil.example/badge/a')).toBeNull();
  });
});

describe('7TV paint metadata bounds', () => {
  it('preserves valid gradients, uint32 alpha colors, and finite geometry', () => {
    const parsed = parseSevenTVPaint(gradient());
    expect(parsed).toEqual({
      id: 'paint-1',
      func: 'LINEAR_GRADIENT',
      angle: 90,
      color: 0x11223380,
      repeat: false,
      stops: [
        { color: 0xff0000ff, at: 0 },
        { color: 0x0000ffff, at: 1 },
      ],
      shadows: [{ color: 0x00000080, x_offset: 1, y_offset: 2, radius: 3 }],
    });
    expect(buildPaintStyle(parsed!, true).background).toContain('rgba(255, 0, 0, 1.000) 0%');
  });

  it('accepts a valid 7TV image paint and normalizes supported radial shapes', () => {
    expect(parseSevenTVPaint(gradient({
      function: 'URL',
      image_url: 'https://cdn.7tv.app/misc/paint.webp?version=2',
    }))?.image_url).toBe('https://cdn.7tv.app/misc/paint.webp?version=2');
    expect(parseSevenTVPaint(gradient({ function: 'RADIAL_GRADIENT', shape: 'ELLIPSE' }))?.shape)
      .toBe('ellipse');
  });

  it('preserves legacy GraphQL compatibility when optional fields are null', () => {
    expect(parseSevenTVPaint(gradient({
      angle: null,
      color: null,
      repeat: null,
      shape: null,
      shadows: null,
      stops: null,
    }))).toEqual({
      id: 'paint-1',
      func: 'LINEAR_GRADIENT',
      repeat: false,
      shadows: [],
      stops: [],
    });
  });

  it('rejects excessive arrays instead of copying or rendering them', () => {
    expect(parseSevenTVPaint(gradient({
      stops: Array.from({ length: COSMETIC_METADATA_LIMITS.gradientStops + 1 }, () => ({ color: 1, at: 0.5 })),
    }))).toBeNull();
    expect(parseSevenTVPaint(gradient({
      shadows: Array.from({ length: COSMETIC_METADATA_LIMITS.shadows + 1 }, () => ({
        color: 1, x_offset: 0, y_offset: 0, radius: 1,
      })),
    }))).toBeNull();
  });

  it.each([
    { angle: Number.NaN },
    { angle: Number.POSITIVE_INFINITY },
    { angle: COSMETIC_METADATA_LIMITS.angleMagnitude + 1 },
    { color: -1 },
    { color: 0x1_0000_0000 },
    { color: 1.5 },
    { stops: [{ color: 1, at: Number.NaN }] },
    { stops: [{ color: 1, at: -0.01 }] },
    { stops: [{ color: 1, at: 1.01 }] },
    { shadows: [{ color: 1, x_offset: 65, y_offset: 0, radius: 1 }] },
    { shadows: [{ color: 1, x_offset: 0, y_offset: 0, radius: -1 }] },
  ])('rejects non-finite, out-of-range, or invalid numeric metadata', (override) => {
    expect(parseSevenTVPaint(gradient(override))).toBeNull();
  });

  it('rejects unknown functions, arbitrary CSS shapes, and unsafe image URLs', () => {
    expect(parseSevenTVPaint(gradient({ function: 'conic-gradient' }))).toBeNull();
    expect(parseSevenTVPaint(gradient({ function: 'RADIAL_GRADIENT', shape: 'circle at 0 0, red' }))).toBeNull();
    expect(parseSevenTVPaint(gradient({ function: 'URL', image_url: 'https://example.com/x.png' }))).toBeNull();
  });

  it('fails closed without throwing on hostile objects or malformed nesting', () => {
    const hostile = Object.defineProperty({}, 'id', { get() { throw new Error('getter'); } });
    expect(() => parseSevenTVPaint(hostile)).not.toThrow();
    expect(parseSevenTVPaint(hostile)).toBeNull();
    expect(parseSevenTVPaint(null)).toBeNull();
    expect(parseSevenTVPaint([])).toBeNull();
    expect(parseSevenTVPaint(gradient({ stops: {} }))).toBeNull();
  });

  it('returns no CSS for malformed paint instead of emitting raw tokens', () => {
    const malformed = {
      id: 'paint-1',
      func: 'RADIAL_GRADIENT',
      repeat: false,
      stops: [{ color: 1, at: 0 }],
      shadows: [],
      shape: 'circle);background:url(https://evil.example/x)',
    } as SevenTVPaint;
    expect(buildPaintStyle(malformed, true)).toEqual({ background: '', filter: '' });
  });
});
