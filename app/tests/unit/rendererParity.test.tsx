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
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';
import type { ReactElement, ReactNode } from 'react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { buildParsedMessage, buildPaintStyle } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { SAMPLE_COSMETICS, SAMPLE_MESSAGES } from '@/features/multichat/samples';
import { PREVIEW_EMOTE_TOKENS } from '@/features/multichat/previewAssets';
import type { SevenTVPaint } from '@/lib/kick';

afterEach(cleanup);

const config = (over: Record<string, string> = {}) =>
  MultichatQuerySchema.parse({ twitch: 'somebody', ...over });

/** The showcase, converted exactly as the preview converts it. */
function renderOverlay(
  over: Record<string, string> = {},
  wrap: (tree: ReactNode) => ReactNode = (t) => t,
) {
  const cfg = config(over);
  const mentions = { enabled: true, colors: new Map<string, string>() };
  const parsed = SAMPLE_MESSAGES.map((s) =>
    buildParsedMessage(s.message, cfg, SAMPLE_COSMETICS, mentions, s.message.timestamp),
  );
  const { container } = render(
    wrap(
      <ChatOverlay
        config={cfg}
        messages={parsed}
        fadingIds={new Set<string>()}
        pinnedMessage={null}
        showLoader={false}
        sourceTagExplicit
      />,
    ) as ReactElement,
  );
  return container;
}

const mount = (over: Record<string, string> = {}) => renderOverlay(over);

/* The overlay's stylesheet goes through next/head, which in jsdom mounts nothing
   into the document — it hands its children to the head manager instead. So we
   supply that manager and read what the overlay passed it. This is the same CSS
   text Next writes into <head> in the browser and in OBS. */
function overlayCss(over: Record<string, string> = {}): string {
  let head: ReactElement[] = [];
  renderOverlay(over, (tree) => (
    <HeadManagerContext.Provider
      value={{
        updateHead: (s) => {
          head = s as ReactElement[];
        },
        mountedInstances: new Set(),
      }}
    >
      {tree}
    </HeadManagerContext.Provider>
  ));
  return head
    .filter((el) => el?.type === 'style')
    .map((el) => {
      const p = el.props as { children?: string; dangerouslySetInnerHTML?: { __html: string } };
      return p.dangerouslySetInnerHTML?.__html ?? p.children ?? '';
    })
    .join('\n')
    .replace(/\s+/g, ' ');
}

/** One declaration block, by selector prefix, from the emitted stylesheet. */
function block(css: string, selector: string): string {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}

const nameSpan = (container: HTMLElement, username: string) =>
  Array.from(container.querySelectorAll('span')).find(
    (s) => s.textContent === `${username}:` && !s.querySelector('span'),
  ) as HTMLElement;

const PAINTED = 'paintedname';

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

  it('composes the readability shadow plus one drop-shadow per paint shadow', () => {
    const paint = SAMPLE_COSMETICS.paints[0];
    expect(paint.shadows.length).toBeGreaterThanOrEqual(2);
    const { filter } = buildPaintStyle(paint, true);
    expect(filter.match(/drop-shadow\(/g)).toHaveLength(paint.shadows.length + 1);
    expect(filter).toContain('drop-shadow(rgba(0, 0, 0, 0.8) 2px 3px 0.15rem)');
    for (const s of paint.shadows) {
      expect(filter).toContain(`${s.x_offset / 14}em ${s.y_offset / 14}em ${s.radius / 14}em`);
    }
    /* A chain, not a comma list: filter takes space-separated functions, and a
       comma would invalidate the whole declaration. */
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

describe('the painted username, as the overlay renders it', () => {
  it('clips the gradient to the glyphs with a transparent fill', () => {
    const name = nameSpan(mount(), PAINTED);
    /* All four are required together. Without the transparent fill the solid
       username colour covers the gradient completely; without both clips the
       gradient fills the name's box instead of its letters. */
    expect(name.style.webkitTextFillColor).toBe('transparent');
    expect(name.style.backgroundClip).toBe('text');
    /* The -webkit- alias is set beside it and is what actually clips in Chromium,
       but jsdom's CSS parser drops that property outright — it keeps
       -webkit-text-fill-color above and not this one — so there is nothing here to
       read. It is measured in the browser instead. */
    expect(name.style.backgroundImage).toContain('linear-gradient(');
  });

  it('stretches the paint across the name rather than cropping it', () => {
    /* 100% 100%, not cover. Gradients have no intrinsic size so the two agree,
       but an image paint under `cover` is cropped to the glyph box — and it is
       the same declaration for both. */
    expect(nameSpan(mount(), PAINTED).style.backgroundSize).toBe('100% 100%');
  });

  it('carries the paint shadows as a filter and no text-shadow', () => {
    const name = nameSpan(mount(), PAINTED);
    expect(name.style.filter).toContain('drop-shadow(');
    /* An inherited message text-shadow on top of a painted name muddies the
       gradient it is drawn under, so the paint branch clears it outright. */
    expect(name.style.textShadow).toBe('none');
  });

  it('keeps the gradient when paint shadows are switched off', () => {
    const name = nameSpan(mount({ paintShadows: 'false' }), PAINTED);
    expect(name.style.filter).toBe('');
    expect(name.style.backgroundImage).toContain('linear-gradient(');
    expect(name.style.webkitTextFillColor).toBe('transparent');
  });

  it('restores the ordinary username colour when 7TV cosmetics are off', () => {
    const name = nameSpan(mount({ sevenTVCosmeticsEnabled: 'false' }), PAINTED);
    /* No paint at all now: an ordinary coloured name, with nothing left over from
       the paint branch that would keep the text invisible. */
    expect(name.style.color).not.toBe('');
    expect(name.style.backgroundImage).toBe('');
    expect(name.style.webkitTextFillColor).toBe('');
    expect(name.style.backgroundClip).toBe('');
  });
});

describe('the emote rules the overlay emits', () => {
  it('pins emote height to the configured size instead of leaving it auto', () => {
    const body = block(overlayCss(), '.ck-body img.ck-emote');
    /* `height: auto` under a max-height cap draws a provider 1x variant short:
       the cap is a ceiling, not a size. Pinning height is what puts every
       provider's art on one apparent height — the parity fix. */
    expect(body).toMatch(/height:\s*calc\(1\.7em \* 1\)/);
    expect(body).not.toMatch(/height:\s*auto/);
  });

  it('leaves emote width to the aspect ratio', () => {
    const body = block(overlayCss(), '.ck-body img.ck-emote');
    /* With height fixed, `width: auto` is what preserves the ratio. A fixed width
       here would square off every wide emote. */
    expect(body).toMatch(/width:\s*auto/);
    expect(body).toMatch(/object-fit:\s*contain/);
    /* max-width still clamps the extremes, where contain letterboxes instead of
       stretching. */
    expect(body).toMatch(/max-width:\s*calc\(5em \* 1\)/);
  });

  it('aligns emotes to the middle of the surrounding text', () => {
    const body = block(overlayCss(), '.ck-body img.ck-emote');
    expect(body).toMatch(/vertical-align:\s*middle/);
  });

  it('sizes emotes by class, so no other image in a body is caught', () => {
    const css = overlayCss();
    /* The rule was `.ck-body img` — every descendant image. Harmless while height
       was auto; a pinned height would actively distort anything that ever landed
       in a body that was not an emote. Every emote path carries .ck-emote, so
       scoping to it changes nothing about emotes and everything about the rest. */
    expect(css).not.toMatch(/\.ck-body img\s*,/);
    expect(css).not.toMatch(/\.ck-body img\s*\{/);
    /* And the DOM half: every image inside a body really does carry the class. */
    const bodies = Array.from(mount().querySelectorAll('.ck-body'));
    const imgs = bodies.flatMap((b) => Array.from(b.querySelectorAll('img')));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img.className, img.getAttribute('alt') ?? '').toContain('ck-emote');
  });

  it('leaves official badges at their own size, outside the emote rules', () => {
    const container = mount();
    const badges = Array.from(container.querySelectorAll('img.ck-badge-img'));
    expect(badges.length).toBeGreaterThan(0);
    /* Badges are siblings of .ck-body, not descendants — which is the structural
       reason the emote rules cannot reach them. Assert that, not just the CSS. */
    for (const b of badges) expect(b.closest('.ck-body')).toBeNull();
    for (const b of badges) expect(b.className).not.toContain('ck-emote');

    const css = overlayCss();
    const badge = block(css, '.ck-badge-img {');
    const emote = block(css, '.ck-body img.ck-emote');
    /* Their sizes are declared independently and differ, so a change to one is
       visible as a change to one. */
    expect(badge).toMatch(/height:\s*\d+(\.\d+)?px\s*!important/);
    const px = (s: string, prop: string) =>
      Number(new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(s)?.[1]);
    expect(px(badge, 'height')).not.toBe(px(emote, 'height'));
    /* Badge spacing now belongs to the centered inline-flex wrapper rather
       than each image, while emotes keep their own negative compaction. */
    const badgeRow = block(css, '.ck-bw {');
    expect(px(badgeRow, 'gap')).toBeGreaterThan(0);
    expect(badge).toMatch(/margin:\s*0\s*!important/);
    expect(emote).toMatch(/margin-right:\s*-/);
  });
});

describe('emote size stays tied to the existing size settings', () => {
  const emoteRule = (over: Record<string, string> = {}) =>
    block(overlayCss(over), '.ck-body img.ck-emote');

  it('uses the 1.7em regular-emote profile for Medium only', () => {
    expect(emoteRule()).toMatch(/height:\s*calc\(1\.7em \* 1\)/);
    expect(emoteRule()).toMatch(/max-height:\s*calc\(1\.7em \* 1\)/);
    expect(emoteRule()).toMatch(/max-width:\s*calc\(5em \* 1\)/);
    expect(emoteRule()).toMatch(/width:\s*auto/);

    expect(emoteRule({ textSize: 'small' })).toMatch(/height:\s*25px/);
    expect(emoteRule({ textSize: 'large' })).toMatch(/height:\s*60px/);
  });

  it('keeps Medium proportional sizing tied to emoteScale', () => {
    expect(emoteRule({ emoteScale: '1.5' })).toMatch(/height:\s*calc\(1\.7em \* 1\.5\)/);
  });

  it('uses 1.2em Twemoji and a 1.65em Medium zero-width overlay', () => {
    expect(block(overlayCss(), '.ck-twemoji-wrap > img.ck-twemoji'))
      .toMatch(/height:\s*calc\(1\.2em \* 1\)/);
    expect(block(overlayCss(), '.ck-body .ck-zw > .ck-zw-layer > img.ck-emote'))
      .toMatch(/height:\s*calc\(1\.65em \* 1\)/);

    expect(block(overlayCss({ textSize: 'small' }), '.ck-body .ck-zw > .ck-zw-layer > img.ck-emote'))
      .toMatch(/height:\s*25px/);
    expect(block(overlayCss({ textSize: 'large' }), '.ck-body .ck-zw > .ck-zw-layer > img.ck-emote'))
      .toMatch(/height:\s*60px/);
  });

  it('lets Twitch-native emotes keep intrinsic height under the Medium cap', () => {
    const css = overlayCss();
    expect(block(css, '.ck-body img.ck-native-twitch')).toMatch(/height:\s*auto/);
    expect(emoteRule()).toMatch(/max-height:\s*calc\(1\.7em \* 1\)/);
    expect(overlayCss({ textSize: 'small' })).not.toContain('.ck-body img.ck-native-twitch');
    expect(overlayCss({ textSize: 'large' })).not.toContain('.ck-body img.ck-native-twitch');
  });

  it('moves the zero-width wrapper compaction with the size setting too', () => {
    /* The wrapper carries the compaction margin now, so it has to track the size
       table like an ordinary emote does rather than keeping a medium-sized value. */
    const mr = (over: Record<string, string>) =>
      /margin-right:\s*(-?\d+(?:\.\d+)?)px/.exec(block(overlayCss(over), '.ck-body .ck-zw {'))?.[1];
    expect(mr({ textSize: 'small' })).not.toBe(mr({ textSize: 'large' }));
    const cases: Record<string, string>[] = [{ textSize: 'small' }, {}, { textSize: 'large' }];
    for (const over of cases) {
      expect(mr(over)).toBe(
        /margin-right:\s*(-?\d+(?:\.\d+)?)px/.exec(
          block(overlayCss(over), '.ck-body img.ck-emote'),
        )?.[1],
      );
    }
  });
});

describe('the compaction margin is applied exactly once', () => {
  it('gives it to the wrapper and clears it on the base and the layers', () => {
    const css = overlayCss();
    /* Inside a wrapper, that negative margin was subtracted from the base's own
       box and clipped 6px off it. It belongs to the outermost element of the
       stack — where it does the same job an ordinary emote's margin does. */
    expect(block(css, '.ck-body .ck-zw {')).toMatch(/margin-right:\s*-/);
    expect(block(css, '.ck-body .ck-zw > img.ck-zw-base')).toMatch(/margin-right:\s*0/);
    expect(block(css, '.ck-body .ck-zw > .ck-zw-layer > img.ck-emote')).toMatch(
      /margin-right:\s*0/,
    );
    /* The layer itself is out of flow, so it has no layout margin to give. */
    expect(block(css, '.ck-body .ck-zw > .ck-zw-layer {')).toMatch(/position:\s*absolute/);
  });

  it('overrides the shared emote margin by specificity, not by source order alone', () => {
    /* Both clearing rules must outrank `.ck-body img.ck-emote` on class count, or
       a future reordering of the stylesheet would silently restore the clipping. */
    const classes = (sel: string) => (sel.match(/\.[a-z-]+/g) ?? []).length;
    expect(classes('.ck-body .ck-zw > img.ck-zw-base')).toBeGreaterThan(
      classes('.ck-body img.ck-emote'),
    );
    expect(classes('.ck-body .ck-zw > .ck-zw-layer > img.ck-emote')).toBeGreaterThan(
      classes('.ck-body img.ck-emote'),
    );
  });
});

describe('the zero-width stack', () => {
  const zwWrapper = (container: HTMLElement) =>
    container.querySelector('span.ck-zw') as HTMLElement;

  it('puts the base and every layer in one wrapper', () => {
    const wrapper = zwWrapper(mount());
    expect(wrapper).not.toBeNull();
    const alts = Array.from(wrapper.querySelectorAll('img')).map((i) => i.getAttribute('alt'));
    expect(alts).toContain(PREVIEW_EMOTE_TOKENS.sevenTV);
    expect(alts).toContain(PREVIEW_EMOTE_TOKENS.sevenTVZeroWidth);
    /* One wrapper for the stack, not one per layer. */
    expect(wrapper.querySelectorAll('span.ck-zw').length).toBe(0);
  });

  it('adds no second item to the text flow for a layer', () => {
    const wrapper = zwWrapper(mount());
    /* The body's direct children are what the line lays out. The whole stack must
       appear there once — as the wrapper — with no layer or overlay image beside
       it, or the pair would occupy two emotes' worth of width. */
    const body = wrapper.parentElement as HTMLElement;
    const inFlow = Array.from(body.children);
    expect(inFlow.filter((el) => el.classList.contains('ck-zw'))).toHaveLength(1);
    expect(inFlow.filter((el) => el.classList.contains('ck-zw-layer'))).toHaveLength(0);
    const overlayAlt = PREVIEW_EMOTE_TOKENS.sevenTVZeroWidth;
    expect(
      inFlow.filter((el) => el.tagName === 'IMG' && el.getAttribute('alt') === overlayAlt),
    ).toHaveLength(0);
  });

  it('takes every layer out of flow and centres it, leaving the base in flow', () => {
    const css = overlayCss();
    const wrapper = block(css, '.ck-body .ck-zw {');
    /* inline-grid, not inline-block: the base is then a grid item, whose width
       resolves from its capped height and ratio. Shrink-to-fit instead measured
       the emote's negative compaction margin into the wrapper, leaving it 6px
       narrower than the image it contained. */
    expect(wrapper).toMatch(/display:\s*inline-grid/);
    expect(wrapper).toMatch(/position:\s*relative/);
    expect(wrapper).toMatch(/vertical-align:\s*middle/);

    const layer = block(css, '.ck-body .ck-zw > .ck-zw-layer {');
    /* Absolute is what makes a layer cost no width, however wide its own art. */
    expect(layer).toMatch(/position:\s*absolute/);
    expect(layer).toMatch(/inset:\s*0/);
    expect(layer).toMatch(/align-items:\s*center/);
    expect(layer).toMatch(/justify-content:\s*center/);

    /* The compaction margin moves to the wrapper; inside it, it clipped the base. */
    expect(block(css, '.ck-body .ck-zw > img.ck-zw-base')).toMatch(/margin-right:\s*0/);
    expect(wrapper).toMatch(/margin-right:/);
  });

  it('stacks more than one layer over the same base', () => {
    const cfg = config();
    const mentions = { enabled: true, colors: new Map<string, string>() };
    const two = SAMPLE_MESSAGES.find((s) => s.group === 'emotes')!;
    const zw = PREVIEW_EMOTE_TOKENS.sevenTVZeroWidth;
    const parsed = buildParsedMessage(
      { ...two.message, id: 'zw-two', text: `${PREVIEW_EMOTE_TOKENS.sevenTV} ${zw} ${zw}` },
      cfg,
      SAMPLE_COSMETICS,
      mentions,
      two.message.timestamp,
    );
    const { container } = render(
      <ChatOverlay
        config={cfg}
        messages={[parsed]}
        fadingIds={new Set<string>()}
        pinnedMessage={null}
        showLoader={false}
        sourceTagExplicit
      />,
    );
    const wrapper = container.querySelector('span.ck-zw') as HTMLElement;
    expect(wrapper.querySelectorAll('span.ck-zw-layer')).toHaveLength(2);
    /* Still one wrapper and one base, so two layers cost no more width than one. */
    expect(container.querySelectorAll('span.ck-zw')).toHaveLength(1);
    expect(wrapper.querySelectorAll('img.ck-zw-base')).toHaveLength(1);
  });
});
