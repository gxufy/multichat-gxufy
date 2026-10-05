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
import { readFileSync, readdirSync } from 'node:fs';
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

const OVERLAY_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'components', 'overlay', 'ChatOverlay.tsx'),
  'utf8',
);

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
    expect(css).toContain('family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,400');
    expect(css).toContain('family=Lato:wght@600&display=swap');
  });

  it('requests the selected italic custom-family variant', () => {
    const css = overlayFontCss('google:Inter', { fontWeight: '700', fontItalic: true });
    expect(css).toContain('family=Inter:ital,wght@1,700&display=swap');
  });
});

describe('no route asks next/head for a stylesheet', () => {
  /* Next warns "Do not add stylesheets using next/head" once per href, on every
     render in development. Three routes did: the homepage, the Classic
     generator, and the overlay. A grep guard is coarse but it is the only thing
     that catches a fourth being added later. */

  /** Every .tsx under a directory, recursively. */
  const tsxFiles = (dir: string): string[] =>
    readdirSync(join(process.cwd(), 'src', dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return tsxFiles(rel);
      return entry.name.endsWith('.tsx') ? [rel] : [];
    });

  const SOURCES = ['components', 'pages', 'app']
    .flatMap(tsxFiles)
    .map((rel) => [rel, readFileSync(join(process.cwd(), 'src', rel), 'utf8')] as const);

  it('reads the component and page sources', () => {
    // Guards the walk: an empty list must not pass the assertion below.
    expect(SOURCES.length).toBeGreaterThan(5);
    expect(SOURCES.map(([rel]) => rel)).toContain('components/overlay/ChatOverlay.tsx');
  });

  it('has no rel="stylesheet" in any page or component', () => {
    const offenders = SOURCES.filter(([, src]) => /rel="stylesheet"/.test(src))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});

describe('the overlay actually renders the request', () => {
  it('emits a style rule from the resolved CSS', () => {
    // Pins the wiring, not just the helper: correct CSS that reaches no element
    // leaves the original bug in place. Asserted in the DOM by the companion
    // test in overlayFontLink.test.tsx; this guards the source coupling.
    expect(OVERLAY_SOURCE).toContain('overlayFontCss(cfg.font, {');
    expect(OVERLAY_SOURCE).toContain('__html: fontCss');
  });

  it('hands next/head no stylesheet link, which it warns about', () => {
    expect(OVERLAY_SOURCE).not.toMatch(/rel="stylesheet"/);
  });

  it('keeps the self-hosted Alsina face the exemption relies on', () => {
    expect(OVERLAY_SOURCE).toContain('font-family:Alsina');
  });
});
