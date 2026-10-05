/* The font stylesheet must actually be emitted by the overlay.
 *
 * Companion to overlayFonts.test.ts, which covers the key→spec mapping. This one
 * renders the real ChatOverlay and asserts what it hands to next/head, because
 * that is the actual defect: /multichat prerendered with no
 * font stylesheet at all, so `font=roboto` named a family the page never fetched
 * and OBS drew generic sans-serif — while the generator preview, which loads
 * these faces for its own UI, showed the real one.
 *
 * next/head is mocked to render its children inline. In jsdom the real one
 * flushes to document.head asynchronously via its side channel, so asserting on
 * document.head yields an empty list for *every* font — which would make the
 * negative cases below pass vacuously even with the feature entirely removed.
 * The mock is the honest boundary: it proves ChatOverlay emits the right rules.
 * Whether next/head hoists them into <head> is Next's own behaviour, and the
 * other pages' prerendered markup already shows that it does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

/** A parsed config for one Kick channel with an explicit font. */
const config = (font?: string) =>
  MultichatQuerySchema.parse({ kick: 'somechannel', ...(font ? { font } : {}) });

/** Render the overlay with no messages — only the emitted head matters here. */
function mount(font?: string) {
  return render(
    <ChatOverlay
      config={config(font)}
      messages={[]}
      fadingIds={new Set()}
      pinnedMessage={null}
      showLoader={false}
    />,
  );
}

/* Google Fonts requests the overlay emitted, as @import rules. A stylesheet
   <link> inside next/head is unsupported and warns on every render in
   development, so the request is an @import in an inline style instead. */
function fontSheets(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .filter((css) => css.includes('fonts.googleapis.com'));
}

describe('web font is emitted by the overlay', () => {
  it('loads Open Sans for the no-explicit-selection default', () => {
    const { container } = mount();
    expect(fontSheets(container)[0]).toContain('Open+Sans');
    expect(container.querySelector('#chat_container')?.getAttribute('style')).toContain(
      'font-family: "Open Sans", Arial, system-ui, sans-serif',
    );
  });

  it('keeps explicit Geist self-hosted and selectable', () => {
    const { container } = mount('geist');
    expect(fontSheets(container)).toEqual([]);
    expect(container.innerHTML).toContain('/fonts/Geist-wght.woff2');
    expect(container.innerHTML).toContain('font-display: swap');
  });

  it('loads the face named by an explicit font parameter', () => {
    const { container } = mount('dancing');
    expect(fontSheets(container)[0]).toContain('Dancing+Script');
  });

  it('requests only the selected family, including its active weight', () => {
    const { container } = mount('roboto');
    const sheets = fontSheets(container);
    expect(sheets).toHaveLength(1);
    const requestedFamilies = Array.from(sheets[0].matchAll(/family=([^&')]+)/g))
      .map((match) => match[1]);
    expect(requestedFamilies).toHaveLength(2);
    expect(requestedFamilies.every((family) => family.startsWith('Roboto'))).toBe(true);
    expect(sheets[0]).toContain('family=Roboto:wght@800');
    expect(sheets[0]).not.toContain('Open+Sans');
  });

  it('preconnects so the stylesheet request is not serialized', () => {
    const { container } = mount('lato');
    const origins = Array.from(
      container.querySelectorAll('link[rel="preconnect"]'),
    ).map((el) => el.getAttribute('href'));
    expect(origins).toContain('https://fonts.googleapis.com');
    expect(origins).toContain('https://fonts.gstatic.com');
  });
});

describe('no request for faces that need none', () => {
  /* These would pass vacuously against document.head — see the header. Each is
     paired with a positive case above that proves the mechanism does fire. */

  it('adds no stylesheet for a system face', () => {
    const { container } = mount('segoe');
    expect(fontSheets(container)).toEqual([]);
  });

  it('adds no stylesheet for the self-hosted Alsina face', () => {
    // ChatOverlay emits its own @font-face for this one.
    const { container } = mount('alsina');
    expect(fontSheets(container)).toEqual([]);
    expect(container.innerHTML).toContain('font-family:Alsina');
  });

  it('adds no stylesheet for an unrecognized value', () => {
    // An omitted font= parses to 'geist' via the schema default, so the
    // genuinely unsupported case is an unknown value, which the parser passes
    // through verbatim rather than falling back.
    const { container } = mount('not-a-real-font');
    expect(fontSheets(container)).toEqual([]);
  });

  it('emits no preconnect when no stylesheet is needed', () => {
    const { container } = mount('impact');
    expect(container.querySelectorAll('link[rel="preconnect"]')).toHaveLength(0);
  });
});

describe('the emitted CSS is not HTML-escaped', () => {
  /* A <style> element is raw text: it does not decode entities. A text child
     would have React escape `&` to `&amp;` and `'` to `&#x27;`, leaving an
     invalid url() token and a `display=swap` that Google never sees. This
     shipped broken once in this very fix, so it is asserted on the served
     string rather than assumed. */

  /* Asserted on server-rendered markup, not the jsdom tree: textContent reads
     the same either way, so a DOM assertion here would pass vacuously. */
  const ssr = renderToStaticMarkup(
    <ChatOverlay
      config={config('opensans')}
      messages={[]}
      fadingIds={new Set()}
      pinnedMessage={null}
      showLoader={false}
    />,
  );

  it('serves the font request at all', () => {
    // Guards the two negative assertions below against a vacuous pass.
    expect(ssr).toContain('@import url(');
    expect(ssr).toContain('fonts.googleapis.com');
  });

  it('keeps query separators literal', () => {
    expect(ssr).toContain('&display=swap');
    const importRule = ssr.slice(ssr.indexOf('@import url('));
    expect(importRule.slice(0, importRule.indexOf(');'))).not.toContain('&amp;');
  });

  it('keeps the url() quotes literal', () => {
    const importRule = ssr.slice(ssr.indexOf('@import url('));
    expect(importRule.slice(0, importRule.indexOf(');'))).not.toContain('&#x27;');
  });
});

describe('the request uses a mechanism next/head supports', () => {
  /* Next warns "Do not add stylesheets using next/head" for any
     <link rel="stylesheet"> passed to it, on every render in development. The
     font still has to load, so it loads as an @import instead. */

  it('emits no stylesheet link for a face that needs loading', () => {
    const { container } = mount('opensans');
    expect(container.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
  });

  it('requests the face through an @import rule', () => {
    const { container } = mount('opensans');
    expect(fontSheets(container)[0]).toMatch(/^@import url\('https:\/\//);
  });
});
