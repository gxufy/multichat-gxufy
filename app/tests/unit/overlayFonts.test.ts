/* The overlay must actually load the faces it names.
 *
 * `ChatOverlay` resolves `font=` to a CSS family through the shared OVERLAY_FONT_FAMILIES
 * map. Naming a family loads nothing, and the overlay route shipped no font
 * stylesheet at all, so nine of the twelve options rendered as generic
 * sans-serif in OBS — including `opensans`, the generator's default — while the
 * generator's own preview showed the real face.
 *
 * The load-bearing test reads the shared family map and asserts every family
 * that needs a web font has a spec. A hardcoded list would drift the moment a
 * font is added; deriving the keys from the production map cannot. The
 * exemptions are asserted individually below so "needs no stylesheet" always has
 * a stated reason rather than being a silent omission.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OVERLAY_FONT_FAMILIES,
  OVERLAY_FONT_SPECS,
  googleFontsUrl,
  overlayFontCss,
  overlayFontUrl,
} from '@/lib/overlayFonts';
import { MULTICHAT_FONTS } from '@/lib/multichatConfig';

/* The overlay (the web app's ChatOverlay.svelte) plus the shared view it
   draws from (sizes, fonts and the stylesheet are in lib/chatOverlayView.ts). */
const OVERLAY_SOURCE = [
  join(process.cwd(), '..', 'web', 'src', 'lib', 'overlay', 'chat', 'ChatOverlay.svelte'),
  join(process.cwd(), 'src', 'lib', 'chatOverlayView.ts'),
].map((file) => readFileSync(file, 'utf8')).join('\n');

/** Font keys that deliberately need no Google stylesheet, and why. */
const EXEMPT: Readonly<Record<string, string>> = {
  default: 'resolves to self-hosted Geist',
  geist: 'self-hosted local face',
  segoe: 'system face',
  impact: 'system face',
  alsina: 'self-hosted @font-face in ChatOverlay',
};

const fontFamilyKeys = (): string[] => Object.keys(OVERLAY_FONT_FAMILIES);

describe('every named family is either loaded or exempt', () => {
  it('reads the shared overlay font-family keys', () => {
    const keys = fontFamilyKeys();
    expect(keys).toContain('opensans');
    expect(keys.length).toBeGreaterThanOrEqual(MULTICHAT_FONTS.length);
  });

  it('has a spec or a stated exemption for each', () => {
    for (const key of fontFamilyKeys()) {
      const covered = key in OVERLAY_FONT_SPECS || key in EXEMPT;
      expect(covered, `${key} has neither a font spec nor an exemption`).toBe(true);
    }
  });

  it('never both loads and exempts the same family', () => {
    for (const key of Object.keys(EXEMPT)) {
      expect(OVERLAY_FONT_SPECS[key]).toBeUndefined();
    }
  });

  it('covers every selectable font value', () => {
    for (const font of MULTICHAT_FONTS) {
      expect(font in OVERLAY_FONT_SPECS || font in EXEMPT).toBe(true);
    }
  });
});

describe('overlayFontUrl', () => {
  it('returns a stylesheet for the generator default', () => {
    // The regression this whole module exists for: opensans loaded nothing.
    expect(overlayFontUrl('opensans')).toBe(
      googleFontsUrl(['Open+Sans:ital,wght@0,300..800;1,300..800']),
    );
  });

  it('requests only the selected family', () => {
    const url = overlayFontUrl('dancing') ?? '';
    expect(url.match(/family=/g)).toHaveLength(1);
    expect(url).toContain('Dancing+Script');
    expect(url).not.toContain('Open+Sans');
  });

  it('asks for swap so text stays visible while loading', () => {
    expect(overlayFontUrl('roboto')).toContain('display=swap');
  });

  it('returns null for system, inherited, and self-hosted faces', () => {
    for (const key of Object.keys(EXEMPT)) {
      expect(overlayFontUrl(key), key).toBeNull();
    }
  });

  it('returns null for an absent or unknown value', () => {
    expect(overlayFontUrl(undefined)).toBeNull();
    // The parser passes an unrecognized font through verbatim, so this is real.
    expect(overlayFontUrl('not-a-font')).toBeNull();
  });
});

describe('overlayFontCss', () => {
  it('wraps the same URL overlayFontUrl resolves', () => {
    // One source of truth for the request; only the mechanism differs.
    expect(overlayFontCss('opensans')).toBe(
      `@import url('${overlayFontUrl('opensans')}');`,
    );
  });

  it('returns null wherever overlayFontUrl does', () => {
    for (const key of [...Object.keys(EXEMPT), 'not-a-font']) {
      expect(overlayFontCss(key), key).toBeNull();
    }
    expect(overlayFontCss(undefined)).toBeNull();
  });

  it('requests a selected custom-family weight while retaining a base fallback', () => {
    const css = overlayFontCss('google:Inter', { fontWeight: '600' });
    expect(css).toContain('family=Inter&display=swap');
    expect(css).toContain('family=Inter:wght@600&display=swap');
  });

  it('requests a selected preset-family weight while retaining its established request', () => {
    const css = overlayFontCss('lato', { fontWeight: '600' });
    expect(css).toContain('family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900');
    expect(css).toContain('family=Lato:wght@600&display=swap');
  });

  it('requests the selected italic custom-family variant', () => {
    const css = overlayFontCss('google:Inter', { fontWeight: '700', fontItalic: true });
    expect(css).toContain('family=Inter:ital,wght@1,700&display=swap');
  });
});

describe('the overlay actually renders the request', () => {
  it('emits a style rule from the resolved CSS', () => {
    // Pins the wiring, not just the helper: correct CSS that reaches no element
    // leaves the original bug in place.
    expect(OVERLAY_SOURCE).toContain('overlayFontCss(cfg.font, {');
    expect(OVERLAY_SOURCE).toContain('<style>${view.fontCss}</style>');
  });

  it('loads fonts through its own style, with no stylesheet link', () => {
    expect(OVERLAY_SOURCE).not.toMatch(/rel="stylesheet"/);
  });

  it('keeps the self-hosted Alsina face the exemption relies on', () => {
    expect(OVERLAY_SOURCE).toContain('font-family:Alsina');
  });
});
