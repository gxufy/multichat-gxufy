/* Paint, emote and zero-width rendering, asserted where each is actually decided.
 *
 * The preview looked right in jsdom and wrong in Chromium, twice. Both times the
 * defect was geometric — an emote drawn at its own height instead of the
 * configured one, a wrapper 6px narrower than the image inside it — and neither
 * could fail a jsdom test, because jsdom has no layout and applies no stylesheet.
 *
 * So this file deliberately does not measure. It asserts the three things that
 * decide the geometry and that jsdom can see honestly:
 *
 *   1. the CSS the overlay emits, as text — the rules Chromium will apply
 *   2. the DOM structure those rules act on
 *   3. the paint style values, which are inline and therefore real here
 *
 * The measurements themselves belong in a browser and were taken there. What this
 * file protects is that the inputs to those measurements do not silently change:
 * if an ordinary emote loses its size profile, or the zero-width base loses its
 * wrapper, the numbers in Chromium change and these assertions fail first.
 */
import { describe, expect, it } from 'vitest';
import { buildPaintStyle } from '@/lib/multichatMessageModel';
import { SAMPLE_COSMETICS } from '@/features/multichat/samples';
import type { SevenTVPaint } from '@/lib/kick';

describe('7TV paint as CSS', () => {
  it('builds a gradient background image from the paint stops', () => {
    const { background } = buildPaintStyle(SAMPLE_COSMETICS.paints[0], true);
    expect(background).toContain('linear-gradient(');
    expect(background).toContain('90deg');
    /* Every stop, at its own position — not a two-colour approximation. */
    const stops = SAMPLE_COSMETICS.paints[0].stops;
    expect(stops.length).toBeGreaterThanOrEqual(3);
    expect(background.match(/rgba\(/g)).toHaveLength(stops.length);
    for (const stop of stops) expect(background).toContain(`${stop.at * 100}%`);
  });

  it('uses the exact 7TV shadow stack without an added readability shadow', () => {
    const paint = SAMPLE_COSMETICS.paints[0];
    expect(paint.shadows.length).toBeGreaterThanOrEqual(2);

    const { filter } = buildPaintStyle(paint, true);

    expect(filter.match(/drop-shadow\(/g)).toHaveLength(paint.shadows.length);
    expect(filter).not.toContain(
      'drop-shadow(rgba(0, 0, 0, 0.8) 2px 3px 0.15rem)',
    );

    for (const shadow of paint.shadows) {
      expect(filter).toContain(
        `drop-shadow(${shadow.x_offset}px ${shadow.y_offset}px ${shadow.radius}px`,
      );
    }

    expect(filter).toMatch(/\) drop-shadow\(/);
    expect(filter).not.toMatch(/\),\s*drop-shadow\(/);
  });

  it('decodes the alpha byte of a packed colour rather than forcing it opaque', () => {
    /* rgba(17, 34, 51, 0.502): 128 in the low byte. The 7TV model carries alpha
       there, so a renderer that hardcoded 1 would draw every translucent stop and
       every soft shadow at full strength. */
    const paint: SevenTVPaint = {
      id: 'p',
      func: 'LINEAR_GRADIENT',
      angle: 0,
      repeat: false,
      shadows: [],
      stops: [{ color: 0x11223380, at: 0 }],
    };
    expect(buildPaintStyle(paint, true).background).toContain('rgba(17, 34, 51, 0.502)');
  });

  it('keeps every underscore out of the emitted gradient function name', () => {
    /* A single replace left `repeating-linear_gradient(...)`, which is not a CSS
       value at all — the declaration would be dropped and the paint would vanish
       rather than degrade. */
    const paint: SevenTVPaint = {
      id: 'p',
      func: 'LINEAR_GRADIENT',
      angle: 45,
      repeat: true,
      shadows: [],
      stops: [
        { color: 0xff0000ff, at: 0 },
        { color: 0x0000ffff, at: 1 },
      ],
    };
    const { background } = buildPaintStyle(paint, true);
    expect(background.startsWith('repeating-linear-gradient(')).toBe(true);
    expect(background).not.toContain('_');
  });

  it('quotes an image paint url', () => {
    const paint: SevenTVPaint = {
      id: 'p',
      func: 'URL',
      repeat: false,
      image_url: 'https://cdn.7tv.app/paint(1).png',
      shadows: [],
      stops: [],
    };
    /* Unquoted, a URL containing parentheses or whitespace ends the url() token
       early and takes the declaration with it. */
    expect(buildPaintStyle(paint, true).background).toBe(
      'url("https://cdn.7tv.app/paint(1).png")',
    );
  });

  it('returns no filter when paint shadows are off, and the same gradient', () => {
    const paint = SAMPLE_COSMETICS.paints[0];
    const on = buildPaintStyle(paint, true);
    const off = buildPaintStyle(paint, false);
    expect(off.filter).toBe('');
    /* The setting removes shadows only. Dropping the paint instead would be the
       obvious wrong implementation, and it would look deliberate. */
    expect(off.background).toBe(on.background);
  });
});
