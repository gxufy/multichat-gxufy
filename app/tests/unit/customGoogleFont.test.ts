import { describe, expect, it } from 'vitest';
import {
  customGoogleFontFamily,
  googleFontValue,
  normalizeGoogleFontFamily,
  overlayFontCss,
  overlayFontUrl,
} from '@/lib/overlayFonts';

describe('custom Google Fonts', () => {
  it('normalizes a free-form family name', () => {
    expect(normalizeGoogleFontFamily('  Press   Start 2P ')).toBe('Press Start 2P');
    expect(normalizeGoogleFontFamily('Bebas Neue')).toBe('Bebas Neue');
  });

  it('rejects values that could escape into CSS or a URL', () => {
    expect(normalizeGoogleFontFamily("Bad'; color:red")).toBeNull();
    expect(normalizeGoogleFontFamily('Bad/Font')).toBeNull();
    expect(normalizeGoogleFontFamily('')).toBeNull();
  });

  it('requires explicit custom selection and leaves legacy bare values alone', () => {
    expect(customGoogleFontFamily('opensans')).toBeNull();
    expect(customGoogleFontFamily('geist')).toBeNull();
    expect(customGoogleFontFamily('segoe')).toBeNull();
    expect(customGoogleFontFamily('Press Start 2P')).toBeNull();
    expect(googleFontValue('Press Start 2P')).toBe('google:Press Start 2P');
    expect(customGoogleFontFamily('google:Press Start 2P')).toBe('Press Start 2P');
  });

  it('loads one safe explicitly selected family and overrides the renderer fallback', () => {
    const font = googleFontValue('Press Start 2P');
    expect(font).toBe('google:Press Start 2P');
    const url = overlayFontUrl(font ?? undefined);
    const css = overlayFontCss(font ?? undefined);
    expect(url).toContain('family=Press+Start+2P');
    expect(css).toContain('family=Press+Start+2P');
    expect(css).toContain("#chat_container { font-family: 'Press Start 2P'");
  });

  it('preserves exact preset requests and ignores unsafe unknown names', () => {
    expect(overlayFontUrl('opensans')).toContain('Open+Sans');
    expect(overlayFontCss('opensans')).not.toContain('#chat_container');
    expect(overlayFontCss("Bad'; color:red")).toBeNull();
    expect(googleFontValue("Bad'; color:red")).toBeNull();
  });
});
