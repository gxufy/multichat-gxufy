/* Accessibility properties that only exist once the whole page is assembled.
 *
 * The per-control checks live in settingTypes.test.tsx, where a setting is
 * rendered on its own: one label per input, a legend on the multiselect, a
 * description linked by aria-describedby, a reason announced when a control is
 * gated. Those pass for a control in isolation and cannot see the failure this
 * file is about — two catalogs, two preview-background pickers, and thirty
 * settings on one page, where a duplicated id or a shared radio `name` silently
 * couples two unrelated controls.
 *
 * A shared radio name is the sharpest case: two `<input type=radio>` groups with
 * the same name are one group to the browser, so picking a chat font would
 * deselect the counter's alignment, and a screen reader would announce "1 of 9"
 * across controls that have nothing to do with each other.
 *
 * Nothing here claims a screen reader was run or that focus was seen. These are
 * structural assertions about the DOM and the stylesheet — necessary conditions,
 * not sufficient ones, and the manual checklist still stands.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach } from 'vitest';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { CLASSIC_GENERATOR_CSS } from '@/components/classic/classicStyles';

vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: {}, replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

function mount() {
  return render(<ClassicGenerator />);
}

/** Every id present in the document, in order. */
function allIds(): string[] {
  return Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
}

describe('ids are unique across the whole page', () => {
  it('no id appears twice', () => {
    /* A duplicate id makes `label[for]` ambiguous: the browser resolves it to
       the first match, so the second control loses its accessible name while
       still looking correctly labelled on screen. */
    mount();
    const ids = allIds();
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('every label points at an element that exists', () => {
    mount();
    const orphans: string[] = [];
    for (const label of Array.from(document.querySelectorAll('label[for]'))) {
      const target = label.getAttribute('for')!;
      if (!document.getElementById(target)) orphans.push(target);
    }
    expect(orphans).toEqual([]);
  });

  it('every aria-describedby and aria-labelledby resolves', () => {
    /* A dangling reference is worse than none: assistive technology announces
       nothing where the author believed a description was being read. */
    mount();
    const dangling: string[] = [];
    for (const attribute of ['aria-describedby', 'aria-labelledby']) {
      for (const el of Array.from(document.querySelectorAll(`[${attribute}]`))) {
        for (const id of (el.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) dangling.push(`${attribute}=${id}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('the two catalogs' + ' settings never collide on an id', () => {
    /* Both catalogs declare a `textShadow` and a `stroke`. They are different
       settings on different tools, and the page namespaces them apart. */
    mount();
    const ids = allIds();
    expect(ids.filter((id) => id.includes('textShadow')).length).toBeGreaterThan(1);
    expect(new Set(ids.filter((id) => id.includes('textShadow'))).size).toBe(
      ids.filter((id) => id.includes('textShadow')).length,
    );
  });
});

describe('radio groups stay independent', () => {
  it('no two settings share a radio name', () => {
    const grouped = new Map<string, Set<string>>();
    mount();
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    )) {
      const name = input.name;
      const set = grouped.get(name) ?? new Set<string>();
      /* The id's prefix identifies which setting on which tool an input belongs
         to; two different prefixes under one name is the coupling bug. */
      set.add(input.id.replace(/-[^-]*$/, ''));
      grouped.set(name, set);
    }
    const shared = [...grouped.entries()].filter(([, prefixes]) => prefixes.size > 1);
    expect(shared.map(([name]) => name)).toEqual([]);
  });

  it('every radio group has a name at all', () => {
    /* An unnamed radio is its own group of one, so it can be checked but never
       unchecked, and arrow keys do not move between the options. */
    mount();
    const unnamed = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).filter((input) => !input.name);
    expect(unnamed).toEqual([]);
  });

  it('each group has exactly one checked option', () => {
    mount();
    const names = new Set(
      Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
        (i) => i.name,
      ),
    );
    for (const name of names) {
      const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`),
      ).filter((i) => i.checked);
      expect(checked.length, name).toBe(1);
    }
  });

  it('gives each preview its own background control, named by tool', () => {
    /* Each preview owns a four-way radio group — Transparent, Dark, Light,
       Custom — rather than the two-state button it replaced. The independence
       question is whether the two groups' `name`s differ (a shared name would
       make picking the chat backdrop move the counter's), so each region's
       Transparent radio is read by its own id and their names compared. */
    mount();
    const transparent = ['chat', 'counter'].map(
      (tool) =>
        document.getElementById(`${tool}-preview-bg-checker`) as HTMLInputElement,
    );
    expect(transparent.every(Boolean)).toBe(true);
    /* Each Transparent radio lives inside its tool's output panel. */
    expect(
      document.querySelector('.panel-chat-output')!.contains(transparent[0]),
    ).toBe(true);
    expect(
      document.querySelector('.panel-counter-output')!.contains(transparent[1]),
    ).toBe(true);
    /* Distinct group names, so the two backdrops never couple. */
    expect(transparent[0].name).not.toBe(transparent[1].name);
    /* Both previews start on their Transparent default. */
    for (const radio of transparent) expect(radio.checked).toBe(true);
  });
});

describe('live regions exist for the things that change without a reload', () => {
  it('each output panel has its own copy-status region', () => {
    /* Copy gives visual feedback by relabelling the button, which a screen
       reader user who activated it by keyboard may not hear. */
    mount();
    for (const region of ['.panel-chat-output', '.panel-counter-output']) {
      const panel = document.querySelector<HTMLElement>(region)!;
      const statuses = panel.querySelectorAll('[role="status"]');
      expect(statuses.length, region).toBeGreaterThanOrEqual(1);
    }
  });

  it.each([
    ['.panel-chat-output', 'MultiChat overlay URL copied to the clipboard.'],
    ['.panel-counter-output', 'Viewer counter URL copied to the clipboard.'],
  ])('%s announces the copy in words', (region, announcement) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    const panel = document.querySelector<HTMLElement>(region)!;
    /* fireEvent, not element.click(): React's synthetic handler is what sets the
       state the live region renders from. */
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy' }));
    expect(within(panel).getByText(announcement)).toBeDefined();
  });

  it('keeps exactly one h1 and gives every section an h2', () => {
    mount();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const section of Array.from(document.querySelectorAll('section'))) {
      const id = section.getAttribute('aria-labelledby');
      expect(id, section.className).toBeTruthy();
      expect(document.getElementById(id!)?.tagName).toBe('H2');
    }
  });

  it('starts headings at h2 under the single h1, with no level skipped', () => {
    /* A jump from h1 to h3 breaks the outline a screen reader user navigates by. */
    mount();
    const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
      Number(h.tagName.slice(1)),
    );
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `${levels[i - 1]} → ${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });
});

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
