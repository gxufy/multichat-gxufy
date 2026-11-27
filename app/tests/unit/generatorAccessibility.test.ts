/* The generator's stylesheet: focus stays visible on every control and
 * motion follows the visitor's reduced-motion setting. Structural assertions
 * about the stylesheet — necessary conditions, not sufficient ones; the manual
 * checklist still stands. */
import { describe, expect, it } from 'vitest';
import { CLASSIC_GENERATOR_CSS } from '@/components/classic/classicStyles';

describe('the stylesheet keeps focus visible and honours reduced motion', () => {
  it('defines a focus-visible outline rather than removing outlines', () => {
    expect(CLASSIC_GENERATOR_CSS).toContain(':focus-visible');
    /* `outline: none` is only acceptable where something else marks focus. The
       one permitted case is `main`, focused programmatically by the skip link,
       which needs no ring of its own. The selector is taken as the text between
       the previous `}` and the `{` — matching from `[^{]*` alone would swallow
       the tail of the preceding rule.

       Comments are stripped first: a CSS comment above a rule sits in exactly
       that gap, so an explained rule would otherwise fail this check for being
       explained, which is the wrong incentive. */
    const css = CLASSIC_GENERATOR_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const suppressions = css.match(/[^}{]*\{[^}]*outline:\s*(none|0)[^}]*\}/g) ?? [];
    expect(suppressions.length).toBeGreaterThan(0);

    /* Two rules legitimately suppress an outline, and each has to say why:
         - `main:focus` is focused programmatically by the skip link. A ring
           around the whole page body would be noise, and the destination is
           announced by its heading rather than by an outline.
         - the text/number/select/textarea base rule replaces the outline with a
           border colour change and a box-shadow ring on :focus. That substitute
           is asserted below rather than assumed, and it fires on :focus rather
           than :focus-visible, so it is if anything more visible than the
           default. */
    const allowed = [
      'main:focus',
      'input[type=text], input[type=number], select, textarea',
    ];
    for (const rule of suppressions) {
      const selector = rule.trim().split('{')[0].trim();
      expect(allowed, rule.trim()).toContain(selector);
    }
    /* The substitute ring must cover every element the base rule silenced —
       textarea included, or the one multiline field would lose its outline and
       gain nothing back. */
    expect(CLASSIC_GENERATOR_CSS).toMatch(
      /input\[type=text\]:focus, input\[type=number\]:focus, select:focus, textarea:focus \{[^}]*box-shadow/,
    );
  });

  it('gives each custom control its own focus ring, since the input is hidden', () => {
    /* Segmented pills, switches, and chips all hide the native input and style a
       sibling, so the browser's default ring lands on something invisible. */
    for (const selector of [
      '.classic-seg-item input:focus-visible',
      '.toggle input:focus-visible',
      '.classic-chip input:focus-visible',
    ]) {
      expect(CLASSIC_GENERATOR_CSS, selector).toContain(selector);
    }
  });

  it('reveals the skip link on focus', () => {
    expect(CLASSIC_GENERATOR_CSS).toContain('.skip-link:focus');
  });

  it('answers prefers-reduced-motion', () => {
    expect(CLASSIC_GENERATOR_CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('neutralises transitions and animations inside that query', () => {
    /* Present-but-empty would satisfy the check above while changing nothing.
       The durations are collapsed to 0.01ms rather than to `none`, which is the
       usual form — it keeps transitionend firing, so anything waiting on that
       event still proceeds instead of hanging. */
    const index = CLASSIC_GENERATOR_CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    const block = CLASSIC_GENERATOR_CSS.slice(index, index + 600);
    expect(block).toMatch(/animation-duration:\s*0\.01ms|animation:\s*none/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms|transition:\s*none/);
    expect(block).toContain('*, *::before, *::after');
  });
});
