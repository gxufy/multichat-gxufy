/* The generator's built-in viewer counter preview.
 *
 * What these assert, and why each one is here rather than being obvious:
 *
 *   - the preview holds numbers on first paint, with no channel, no click, and no
 *     timer advanced. The state this replaces was an empty frame, and an empty
 *     frame and a broken renderer look identical;
 *   - nothing fetches. No /api/viewers, no iframe, no polling of any kind. The
 *     samples exist so the generator can render without a channel, and the moment
 *     it starts a poll that claim stops being true;
 *   - all six settings reach the screen, including the two that are only
 *     observable as inline style;
 *   - no sample value reaches the generated URL.
 *
 * The renderer is not re-implemented here and its formatting is not restated. The
 * expected thousands separator is taken from `toLocaleString()` — the call
 * `RollingCount` itself makes — so a locale difference between machines cannot
 * turn this into a false failure, and a fixture that hardcoded "12,480" cannot
 * quietly disagree with what the overlay prints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import ClassicCounterPreview from '@/components/classic/ClassicCounterPreview';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';
import { counterTool } from '@/features/counter/config';
import {
  COUNTER_COUNT_MAX,
  SAMPLE_COUNTER_COUNTS,
  parseCounterCount,
  sampleCounterStatuses,
} from '@/features/counter/samples';
import { PLATFORM_ORDER, type ViewerPlatform } from '@/lib/viewerCounterConfig';
import type { ToolChannels } from '@/features/registry';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const NO_CHANNELS: ToolChannels<ViewerPlatform> = {};

/** The query string the generator would produce for a style, via the real serializer. */
const queryFor = (style: Partial<Record<string, unknown>> = {}) =>
  counterTool.serialize(NO_CHANNELS, { ...counterTool.defaults, ...style } as never);

/** Mount the preview alone, at default settings unless overridden. */
const mountPreview = (
  style: Partial<Record<string, unknown>> = {},
  counts: Partial<Record<ViewerPlatform, number>> = SAMPLE_COUNTER_COUNTS,
) =>
  render(
    <ClassicCounterPreview
      query={queryFor(style)}
      statuses={sampleCounterStatuses(counts)}
      width={counterTool.obs.width}
      height={counterTool.obs.height}
    />,
  );

/** The isolation frame, in the generator document. */
const frame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="Viewer Counter sample preview"]')!;

/* Every query below starts inside the frame's own document rather than at
   `screen`, because the renderer is portalled into that document and a portal
   moves DOM without moving it into the parent document's tree. The scoping is
   the point rather than an inconvenience: if ViewerCounterDisplay were ever
   mounted into the generator document again, these queries would find nothing. */
const previewDoc = () => frame().contentDocument!;
const preview = () => previewDoc().body;
const previewText = () => preview().textContent ?? '';

/* body > the inset wrapper reproducing pages/counter.tsx's padding > the
   renderer's own flex row, which is the only element carrying alignment and the
   only honest place to count pills: each pill is one of its element children.
   Walking the two levels explicitly rather than taking the first div in the
   document, so the wrapper can never be mistaken for the row. */
const inset = () => preview().firstElementChild as HTMLElement;
const row = () => inset().querySelector('div') as HTMLElement;
const pills = () => Array.from(row().children) as HTMLElement[];

/** What the production formatter prints for a number, not what I assume it does. */
const formatted = (value: number) => value.toLocaleString();

const SAMPLE_TOTAL = PLATFORM_ORDER.reduce(
  (sum, platform) => sum + SAMPLE_COUNTER_COUNTS[platform],
  0,
);

afterEach(cleanup);

describe('the built-in counter preview is populated immediately', () => {
  it('shows a number on first paint, with no channel and no timer advanced', () => {
    mountPreview();
    /* Combined is the default, so this is one pill holding the total. Asserting
       the total rather than "some digits" is what distinguishes a populated
       preview from a renderer that drew a zero. */
    expect(previewText()).toContain(formatted(SAMPLE_TOTAL));
    expect(pills()).toHaveLength(1);
  });

  it('never shows only dashes or an empty frame at defaults', () => {
    mountPreview();
    /* The em dash is the renderer's "present but not countable" mark. At the
       built-in counts nothing is uncountable, so its presence here would mean the
       samples are not arriving as measured values. */
    expect(previewText()).not.toContain('—');
    expect(previewText().trim()).not.toBe('');
  });

  it('carries a sample value for every platform', () => {
    mountPreview({ combined: false });
    /* Separate mode is where each platform is individually visible, so this is
       where "all four have samples" can actually be asserted. */
    expect(pills()).toHaveLength(PLATFORM_ORDER.length);
    for (const platform of PLATFORM_ORDER) {
      expect(previewText()).toContain(formatted(SAMPLE_COUNTER_COUNTS[platform]));
    }
  });

  it('includes a value large enough to prove the grouping separator', () => {
    /* A four-figure sample set would render identically whether or not the
       formatter groups, so at least one sample has to be five figures for the
       preview to show a user what their counter will really look like. */
    const largest = Math.max(...PLATFORM_ORDER.map((p) => SAMPLE_COUNTER_COUNTS[p]));
    expect(largest).toBeGreaterThanOrEqual(10_000);
    expect(formatted(largest)).not.toBe(String(largest));
    mountPreview({ combined: false });
    expect(previewText()).toContain(formatted(largest));
  });

  it('is deterministic — identical markup across two mounts', () => {
    /* Read from inside the frame, not from `container`: the container now holds
       an empty iframe element and comparing that would compare nothing. */
    mountPreview();
    const first = preview().innerHTML;
    expect(first).toContain(formatted(SAMPLE_TOTAL));
    cleanup();
    mountPreview();
    expect(preview().innerHTML).toBe(first);
  });

  it('reads no clock and no random source', () => {
    const now = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');
    mountPreview();
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    now.mockRestore();
    random.mockRestore();
  });

  it('labels the samples for both sighted and assistive users', () => {
    render(<ClassicGenerator />);
    const panel = document.querySelector('.panel-counter-output') as HTMLElement;
    expect(within(panel).getByText('Preview Data')).toBeTruthy();
    /* The visible badge and the accessible name say the same thing, so the
       samples cannot read as somebody's real audience either way. */
    expect(
      within(panel).getByRole('group', {
        name: /sample viewer counts, not live numbers/i,
      }),
    ).toBeTruthy();
  });
});

describe('the counter preview opens no connections', () => {
  let seen: string[];

  beforeEach(() => {
    seen = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        seen.push(String(input));
        return Promise.reject(new Error('no network in this test'));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch /api/viewers for the preview alone', () => {
    mountPreview();
    expect(seen).toEqual([]);
  });

  it('fetches only curated chat identities from the whole generator without a channel', () => {
    vi.useFakeTimers();
    render(<ClassicGenerator />);
    /* Past the preview debounce: a poll scheduled behind a timer would be
       invisible to an assertion taken on the first paint alone. */
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 4);
    });
    expect(seen.every((url) => url.startsWith('/api/twitch/preview-identity?login='))).toBe(true);
    expect(seen.every((url) => !url.includes('/api/viewers'))).toBe(true);
    /* Iframes now exist by design — they are what contain each overlay's styles
       and positioning, and without a channel the generator holds both fixture
       frames. What must remain true is that neither ever *navigates*: loading the
       real /counter or /multichat document is what would reintroduce the
       overlays' own polling. So the assertion is about src, not about existence,
       and it covers both frames rather than only the counter's. */
    const frames = Array.from(document.querySelectorAll('iframe'));
    expect(frames.map((f) => f.getAttribute('title')).sort()).toEqual([
      'MultiChat sample preview',
      'Viewer Counter sample preview',
    ]);
    for (const f of frames) {
      expect(f.getAttribute('src')).toBeNull();
      expect(f.getAttribute('srcdoc')).toBeNull();
    }
    vi.useRealTimers();
  });
});

describe('the six counter settings reach the preview', () => {
  it('combined shows one pill, separate shows one per live platform', () => {
    mountPreview({ combined: true });
    expect(pills()).toHaveLength(1);
    expect(previewText()).toContain(formatted(SAMPLE_TOTAL));
    cleanup();
    mountPreview({ combined: false });
    expect(pills()).toHaveLength(PLATFORM_ORDER.length);
    /* The total is the combined-only reading, so its absence is what proves the
       switch actually changed the arithmetic rather than just the layout. */
    expect(previewText()).not.toContain(formatted(SAMPLE_TOTAL));
  });

  it('icons adds a mark per platform and removes every one', () => {
    mountPreview({ combined: false, icons: true });
    const withIcons = preview().querySelectorAll('svg, img').length;
    expect(withIcons).toBeGreaterThanOrEqual(PLATFORM_ORDER.length);
    cleanup();
    mountPreview({ combined: false, icons: false });
    expect(preview().querySelectorAll('svg, img')).toHaveLength(0);
    /* The numbers stay: turning icons off is not turning the counter off. */
    expect(previewText()).toContain(formatted(SAMPLE_COUNTER_COUNTS.twitch));
  });

  it('bg adds the pill background and removes it', () => {
    mountPreview({ bg: true });
    expect(pills()[0].style.background).not.toBe('');
    expect(pills()[0].style.borderRadius).not.toBe('');
    cleanup();
    mountPreview({ bg: false });
    expect(pills()[0].style.background).toBe('');
    expect(pills()[0].style.borderRadius).toBe('');
  });

  it('align moves the row', () => {
    for (const [align, justify] of [
      ['left', 'flex-start'],
      ['center', 'center'],
      ['right', 'flex-end'],
    ] as const) {
      mountPreview({ align });
      expect(row().style.justifyContent).toBe(justify);
      cleanup();
    }
  });

  it('textShadow reaches the pill and scales with the option', () => {
    const seenShadows = new Set<string>();
    for (const shadow of ['none', 'small', 'medium', 'large'] as const) {
      mountPreview({ textShadow: shadow });
      const filter = pills()[0].style.filter;
      if (shadow === 'none') {
        expect(filter).toBe('');
      } else {
        expect(filter).toContain('drop-shadow');
        /* Each option must be distinguishable, or three of the four would be
           the same picture under different names. */
        expect(seenShadows.has(filter)).toBe(false);
        seenShadows.add(filter);
      }
      cleanup();
    }
    expect(seenShadows.size).toBe(3);
  });

  it('stroke reaches the pill and scales with the option', () => {
    const seenStrokes = new Set<string>();
    for (const stroke of ['none', 'thin', 'medium', 'thick', 'thicker'] as const) {
      mountPreview({ stroke });
      /* -webkit-text-stroke is not in jsdom's typed CSSStyleDeclaration, so it is
         read from the attribute the renderer actually wrote. */
      const css = pills()[0].getAttribute('style') ?? '';
      const match = /-webkit-text-stroke:\s*([^;]+)/.exec(css);
      if (stroke === 'none') {
        expect(match).toBeNull();
      } else {
        expect(match).not.toBeNull();
        const value = match![1].trim();
        expect(seenStrokes.has(value)).toBe(false);
        seenStrokes.add(value);
      }
      cleanup();
    }
    expect(seenStrokes.size).toBe(4);
  });
});

describe('the preview count controls', () => {
  const fieldFor = (platform: ViewerPlatform) =>
    document.getElementById(`sample-count-${platform}`) as HTMLInputElement;

  /* The production number is animated: RollingCount eases from the old value to
     the new one over 600ms, and it schedules that easing with
     requestAnimationFrame while reading the clock through performance.now.

     Neither of those is driven by a timer, so faking timers does nothing here —
     the first attempt at this file advanced 700ms and the DOM still held the
     value from first paint, which is exactly the failure mode being guarded
     against: an assertion that never sees the number move would pass no matter
     what the controls did.

     So both are driven by hand. Frames are queued rather than run immediately,
     because RollingCount schedules the next frame from inside the current one —
     a stub that invoked the callback synchronously would recurse until the stack
     gave out. `roll` then drains the queue with a clock that advances past the
     animation's duration, so the easing reaches t=1 and settles on the exact
     target value rather than somewhere near it. */
  const ROLL_MS = 600;
  let frames: FrameRequestCallback[] = [];
  let clock = 0;

  beforeEach(() => {
    frames = [];
    clock = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    /* Cancelling is a no-op rather than a splice: the ids handed out above are
       positional, so removing an entry would shift every later id. Draining is
       bounded and a stale callback only recomputes a value it already reached. */
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run queued frames until the animation has settled. */
  const roll = () => {
    /* Bounded: each pass advances the clock past ROLL_MS, so one pass is enough
       to finish an easing. The cap is a guard against a scheduling change
       turning this into an infinite drain, not an expected iteration count. */
    for (let pass = 0; pass < 10 && frames.length > 0; pass += 1) {
      const due = frames;
      frames = [];
      clock += ROLL_MS + 100;
      act(() => {
        for (const cb of due) cb(clock);
      });
    }
  };

  it('starts at the built-in sample values', () => {
    render(<ClassicGenerator />);
    for (const platform of PLATFORM_ORDER) {
      expect(fieldFor(platform).value).toBe(String(SAMPLE_COUNTER_COUNTS[platform]));
    }
  });

  it('an edited count reaches the preview through the real formatter', () => {
    render(<ClassicGenerator />);
    /* Separate mode, so the edited platform has a pill of its own. In combined
       mode the number on screen is the sum of all four, which is a fine thing to
       assert — the test below does — but it would not show that *this* field
       reached the renderer rather than another one. */
    fireEvent.click(screen.getByLabelText('Combined total'));
    fireEvent.change(fieldFor('twitch'), { target: { value: '654321' } });
    roll();
    /* Formatted by toLocaleString, not by the field: a control that printed its
       own separator would disagree with OBS the moment the locale differed. */
    expect(preview().textContent ?? '').toContain(formatted(654321));
  });

  it('combined mode totals the edited counts through the same formatter', () => {
    render(<ClassicGenerator />);
    fireEvent.change(fieldFor('twitch'), { target: { value: '654321' } });
    roll();
    /* The renderer owns the arithmetic as well as the grouping: `summarize` adds
       the measured platforms and RollingCount formats the result. Restating the
       expected sum from the fixtures rather than hardcoding it keeps this honest
       if a sample value ever changes. */
    const expected =
      654321 +
      SAMPLE_COUNTER_COUNTS.youtube +
      SAMPLE_COUNTER_COUNTS.kick +
      SAMPLE_COUNTER_COUNTS.tiktok;
    expect(preview().textContent ?? '').toContain(formatted(expected));
  });

  it('refuses anything that is not a plain non-negative integer', () => {
    render(<ClassicGenerator />);
    const field = fieldFor('kick');
    const before = field.value;
    for (const bad of ['-5', '1.5', '1e6', ' 12', 'abc', '12a', '99999999']) {
      fireEvent.change(field, { target: { value: bad } });
      expect(field.value).toBe(before);
    }
  });

  it('accepts an empty field as "not countable" and shows the dash', () => {
    render(<ClassicGenerator />);
    /* Separate mode, so one platform going uncountable is visible as its own
       pill rather than being folded into a total. */
    fireEvent.click(screen.getByLabelText('Combined total'));
    fireEvent.change(fieldFor('tiktok'), { target: { value: '' } });
    expect(fieldFor('tiktok').value).toBe('');
    expect(preview().textContent ?? '').toContain('—');
  });

  it('Restore sample counts puts every field back', () => {
    render(<ClassicGenerator />);
    fireEvent.change(fieldFor('twitch'), { target: { value: '1' } });
    fireEvent.change(fieldFor('kick'), { target: { value: '' } });
    /* Rolled before restoring as well as after. Without this the displayed
       number would never have left its starting value, and the assertion below
       would pass against a total that was simply never disturbed. */
    roll();
    expect(preview().textContent ?? '').not.toContain(formatted(SAMPLE_TOTAL));
    fireEvent.click(screen.getByRole('button', { name: 'Restore sample counts' }));
    roll();
    for (const platform of PLATFORM_ORDER) {
      expect(fieldFor(platform).value).toBe(String(SAMPLE_COUNTER_COUNTS[platform]));
    }
    expect(preview().textContent ?? '').toContain(formatted(SAMPLE_TOTAL));
  });

  it('labels every field and duplicates no id', () => {
    render(<ClassicGenerator />);
    for (const platform of PLATFORM_ORDER) {
      const field = fieldFor(platform);
      const label = document.querySelector(`label[for="sample-count-${platform}"]`);
      expect(label?.textContent ?? '').not.toBe('');
      expect(field).toBeTruthy();
    }
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the count parser is strict on its own', () => {
  it('accepts plain whole numbers in range', () => {
    expect(parseCounterCount('0')).toBe(0);
    expect(parseCounterCount('842')).toBe(842);
    expect(parseCounterCount(String(COUNTER_COUNT_MAX))).toBe(COUNTER_COUNT_MAX);
  });

  it('rejects everything else, including finite-but-not-typed forms', () => {
    for (const bad of ['', ' ', '-1', '1.0', '1e3', ' 12 ', '0x10', '10000000', 'NaN']) {
      expect(parseCounterCount(bad)).toBeNull();
    }
  });
});

describe('sample counts cannot leak into the generated URL', () => {
  it('appears in neither URL, at defaults or after editing', () => {
    render(<ClassicGenerator />);
    fireEvent.change(
      document.getElementById('sample-count-twitch') as HTMLInputElement,
      { target: { value: '777777' } },
    );
    const urls = Array.from(document.querySelectorAll('.url-code')).map(
      (el) => el.textContent ?? '',
    );
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).not.toContain('777777');
      for (const platform of PLATFORM_ORDER) {
        expect(url).not.toContain(String(SAMPLE_COUNTER_COUNTS[platform]));
      }
    }
  });

  it('the counter URL stays byte-identical to the serializer', () => {
    render(<ClassicGenerator />);
    fireEvent.change(
      document.getElementById('sample-count-kick') as HTMLInputElement,
      { target: { value: '5' } },
    );
    const shown = (
      document.querySelector('[aria-label="Generated viewer counter URL"]')
        ?.textContent ?? ''
    );
    const expected = counterTool.serialize(NO_CHANNELS, counterTool.defaults);
    expect(shown.endsWith(expected ? `?${expected}` : '/counter')).toBe(true);
  });

  it('writes nothing fixture-shaped to sessionStorage', () => {
    render(<ClassicGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore sample counts' }));
    const dump = JSON.stringify(sessionStorage);
    for (const platform of PLATFORM_ORDER) {
      expect(dump).not.toContain(String(SAMPLE_COUNTER_COUNTS[platform]));
    }
  });
});
