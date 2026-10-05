/* Custom preview messages.
 *
 * Two things are being protected here, and they pull in opposite directions:
 *
 *   - a composed message must be *ordinary*. It goes through the same conversion
 *     and the same renderer as a fixture and as a live message, so every setting
 *     reaches it. Asserted by composing one and then toggling settings at it;
 *   - a composed message must be *inert*. It reaches the preview and nothing
 *     else — no provider, no draft, no overlay URL.
 *
 * The model is asserted through `composePreviewMessage` directly where the claim
 * is about the value (ids, caps, verbatim text), and through the mounted card
 * where the claim is about behaviour (Enter submits, empty does not, Clear and
 * Reset). Scraping markup for the first kind would be testing the wrong thing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';
import {
  PREVIEW_FALLBACK_NAME,
  PREVIEW_NAME_MAX,
  PREVIEW_TEXT_MAX,
  canComposePreviewMessage,
  composePreviewMessage,
} from '@/features/multichat/composePreviewMessage';
import { SAMPLE_MESSAGES, SAMPLE_PIN_ID } from '@/features/multichat/samples';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

/* The renderer lives in the isolation frame's own document, not in the generator
   document, so every query below starts there. A React portal moves DOM without
   moving it into the parent document's tree, which is exactly the containment
   these previews now depend on: a `screen` query would find the iframe element
   and nothing inside it. If ChatOverlay were ever mounted into the generator
   document again, `bodies()` would come back empty and this suite would fail. */
const previewDoc = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="MultiChat sample preview"]')!
    .contentDocument!;
const preview = () => previewDoc().body;
const bodies = () =>
  Array.from(preview().querySelectorAll('#chat_container .ck-body')).map(
    (el) => el.textContent ?? '',
  );

/* Found by role, then narrowed to the button interface so `.disabled` is
   readable. The instanceof is not ceremony: it also pins these controls to real
   <button> elements, so a rewrite into anchors or aria-pressed divs — which
   would lose the disabled semantics these tests assert — fails here loudly
   rather than silently passing a truthy-undefined check. */
function composerButton(name: string): HTMLButtonElement {
  const el = screen.getByRole('button', { name });
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`expected "${name}" to be a <button>, got <${el.tagName.toLowerCase()}>`);
  }
  return el;
}

/** Mount the generator and return the composer's three controls. */
function mountComposer() {
  render(<ClassicGenerator />);
  return {
    name: document.getElementById('compose-username') as HTMLInputElement,
    text: document.getElementById('compose-text') as HTMLTextAreaElement,
    add: composerButton('Send custom preview message'),
    clear: composerButton('Clear custom messages'),
    reset: composerButton('Reset preview'),
  };
}

/** Type a message and submit it with the Add button. */
function compose(text: string, name = '') {
  const c = mountComposer();
  if (name) fireEvent.change(c.name, { target: { value: name } });
  fireEvent.change(c.text, { target: { value: text } });
  fireEvent.click(c.add);
  return c;
}

describe('the composed message is the real normalized model', () => {
  it('produces a UnifiedMessage, not pre-rendered nodes', () => {
    const message = composePreviewMessage(
      { platform: 'twitch', username: 'someone', text: 'hello' },
      1,
    );
    /* Plain data all the way down: `text` is a string and `emotes` is a list of
       offsets. A composer that built its own <img> badges and <strong> mentions
       would be a second renderer, and the parse-time settings would not reach
       its output. */
    expect(typeof message.text).toBe('string');
    expect(message.emotes).toEqual([]);
    expect(message.badges).toEqual([]);
    expect(message.kind).toBe('chat');
    expect(message.platform).toBe('twitch');
    expect(message.username).toBe('someone');
  });

  it('derives ids from the counter, never from a clock or a random source', () => {
    const now = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');
    const first = composePreviewMessage({ platform: 'kick', username: '', text: 'a' }, 1);
    const second = composePreviewMessage({ platform: 'kick', username: '', text: 'a' }, 2);
    expect(first.id).toBe('custom-1');
    expect(second.id).toBe('custom-2');
    /* Identical fields, different ids: two composed messages cannot collide on a
       React key even when a user adds the same line twice. */
    expect(first.id).not.toBe(second.id);
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    now.mockRestore();
    random.mockRestore();
  });

  it('cannot collide with a fixture id, and specifically cannot become the pin', () => {
    /* Only SAMPLE_PIN_ID is pin-eligible. A composed id sharing that value would
       let typed text hijack the pin card. */
    const fixtureIds = new Set(SAMPLE_MESSAGES.map((s) => s.message.id));
    for (let seq = 1; seq <= 50; seq += 1) {
      const { id } = composePreviewMessage({ platform: 'kick', username: '', text: 'x' }, seq);
      expect(id).not.toBe(SAMPLE_PIN_ID);
      expect(fixtureIds.has(id)).toBe(false);
    }
  });

  it('falls back to a placeholder name but never to placeholder text', () => {
    const message = composePreviewMessage({ platform: 'kick', username: '   ', text: 'hi' }, 1);
    expect(message.username).toBe(PREVIEW_FALLBACK_NAME);
    /* Blank text does not compose at all, so there is no fallback body to get
       wrong — the samples already demonstrate what a generic line looks like. */
    expect(canComposePreviewMessage({ platform: 'kick', username: 'x', text: '   ' })).toBe(false);
    expect(canComposePreviewMessage({ platform: 'kick', username: '', text: 'x' })).toBe(true);
  });

  it('caps length by codepoint, so no cap can split a surrogate pair', () => {
    /* '🐉' is one codepoint and two UTF-16 units. Slicing at a UTF-16 index can
       land inside it and leave a lone surrogate, which renders as a replacement
       character. */
    const dragons = '🐉'.repeat(PREVIEW_TEXT_MAX + 40);
    const { text } = composePreviewMessage({ platform: 'kick', username: '', text: dragons }, 1);
    expect(Array.from(text)).toHaveLength(PREVIEW_TEXT_MAX);
    expect(text).not.toContain('�');
    /* Every codepoint survived intact rather than being torn in half. */
    expect(new Set(Array.from(text))).toEqual(new Set(['🐉']));

    const longName = 'ぁ'.repeat(PREVIEW_NAME_MAX + 10);
    const named = composePreviewMessage({ platform: 'kick', username: longName, text: 'x' }, 1);
    expect(Array.from(named.username)).toHaveLength(PREVIEW_NAME_MAX);
  });

  it('stores text verbatim, including markup characters', () => {
    const hostile = '<script>alert(1)</script> & 5 < 10';
    const { text } = composePreviewMessage({ platform: 'kick', username: '', text: hostile }, 1);
    /* Not sanitized here: React escapes a string child when it renders it, so
       this is displayed as characters. Rewriting it in the model would also
       silently mangle a perfectly innocent "5 < 10". */
    expect(text).toBe(hostile);
  });
});

describe('the final generator removes the custom composer', () => {
  it('shows no composer inputs or actions', () => {
    render(<ClassicGenerator />);
    expect(document.getElementById('compose-text')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send custom preview message' })).toBeNull();
    expect(screen.queryByText('Add your own lines to the preview')).toBeNull();
  });
});

describe.skip('retired generator composer integration', () => {
  it('renders a composed message through the production renderer', () => {
    compose('a line I typed myself', 'mychannelname');
    expect(bodies().join(' ')).toContain('a line I typed myself');
    expect(within(preview()).getByText('mychannelname')).toBeTruthy();
  });

  it('keeps the built-in samples and appends after them', () => {
    /* Counted from its own mount: `bodies()` needs a rendered preview, so reading
       it before the first render would throw rather than return a baseline. */
    mountComposer();
    const before = bodies().length;
    cleanup();
    compose('appended');
    const after = bodies();
    expect(after).toHaveLength(before + 1);
    /* Last, not first: the preview reads as one conversation in time order. */
    expect(after[after.length - 1]).toContain('appended');
  });

  it('displays hostile markup as text rather than executing it', () => {
    compose('<script>alert(1)</script>');
    expect(preview().querySelector('script')).toBeNull();
    expect(bodies().join(' ')).toContain('<script>alert(1)</script>');
  });

  it('preserves Unicode exactly', () => {
    compose('ありがとう 🎉 спасибо');
    const text = bodies().join(' ');
    expect(text).toContain('ありがとう');
    expect(text).toContain('🎉');
    expect(text).toContain('спасибо');
  });

  it('resolves third-party emote words in a composed Kick message', () => {
    /* Proof the composed message travels the real conversion path: the 7TV
       word-swap happens during it, so typing an emote name shows the emote. */
    mountComposer();
    const before = preview().querySelectorAll('img.ck-emote').length;
    cleanup();
    compose('OMEGALUL');
    expect(preview().querySelectorAll('img.ck-emote').length).toBe(before + 1);
  });

  it('responds to settings identically to a built-in sample', () => {
    const c = compose('composed line', 'composedname');
    expect(within(preview()).getByText('composedname')).toBeTruthy();
    /* hideNames is applied while drawing; userBL while filtering. Both must reach
       a composed message, or the preview would lie about one of them. */
    fireEvent.click(screen.getByLabelText('Hide usernames'));
    expect(within(preview()).queryByText('composedname')).toBeNull();
    expect(bodies().join(' ')).toContain('composed line');
    void c;
  });

  it('is filtered by the blacklist like any other chatter', () => {
    compose('should vanish', 'blockedchatter');
    fireEvent.change(document.getElementById('mc-userBL')!, {
      target: { value: 'blockedchatter' },
    });
    expect(bodies().join(' ')).not.toContain('should vanish');
  });
});

describe.skip('the composer controls behave', () => {
  it('submits on Enter and starts a new line on Shift+Enter', () => {
    const c = mountComposer();
    fireEvent.change(c.text, { target: { value: 'via enter' } });
    fireEvent.keyDown(c.text, { key: 'Enter' });
    expect(bodies().join(' ')).toContain('via enter');

    /* Shift+Enter is the multiline escape hatch: it must not submit. The text is
       deliberately unlike any sample's wording — asserting on a short word like
       "first" would match a fixture that happens to contain it and pass for the
       wrong reason. */
    fireEvent.change(c.text, { target: { value: 'shift held so not submitted' } });
    fireEvent.keyDown(c.text, { key: 'Enter', shiftKey: true });
    expect(bodies().join(' ')).not.toContain('shift held so not submitted');
  });

  it('clears the message but keeps the name, for composing several lines', () => {
    const c = compose('one', 'samechatter');
    expect(c.text.value).toBe('');
    expect(c.name.value).toBe('samechatter');
    fireEvent.change(c.text, { target: { value: 'two' } });
    fireEvent.click(c.add);
    const text = bodies().join(' ');
    expect(text).toContain('one');
    expect(text).toContain('two');
  });

  it('refuses to add an empty or whitespace-only message', () => {
    const c = mountComposer();
    const before = bodies().length;
    expect(c.add.disabled).toBe(true);
    fireEvent.change(c.text, { target: { value: '   ' } });
    expect(c.add.disabled).toBe(true);
    fireEvent.click(c.add);
    fireEvent.keyDown(c.text, { key: 'Enter' });
    expect(bodies()).toHaveLength(before);
  });

  it('caps what can be typed in the browser as well as in the model', () => {
    const c = mountComposer();
    expect(c.text.maxLength).toBe(PREVIEW_TEXT_MAX);
    expect(c.name.maxLength).toBe(PREVIEW_NAME_MAX);
  });

  it('Clear removes composed messages and leaves the samples', () => {
    const c = mountComposer();
    const samples = bodies().length;
    fireEvent.change(c.text, { target: { value: 'temporary' } });
    fireEvent.click(c.add);
    expect(bodies()).toHaveLength(samples + 1);
    fireEvent.click(c.clear);
    expect(bodies()).toHaveLength(samples);
    expect(bodies().join(' ')).not.toContain('temporary');
  });

  it('Clear is offered only when there is something to clear', () => {
    const c = mountComposer();
    expect(c.clear.disabled).toBe(true);
    fireEvent.change(c.text, { target: { value: 'x' } });
    fireEvent.click(c.add);
    expect(c.clear.disabled).toBe(false);
  });

  it('Reset restores the built-in set and empties the fields', () => {
    const c = compose('discard me', 'discardname');
    fireEvent.click(c.reset);
    expect(bodies().join(' ')).not.toContain('discard me');
    expect(c.name.value).toBe('');
    expect(c.text.value).toBe('');
    /* The samples are still there — Reset restores the preview, it does not
       empty it. */
    expect(bodies().length).toBeGreaterThan(0);
    expect(bodies().join(' ')).toContain('keep it civil in here please');
  });

  it('announces what happened, for anyone who cannot see the preview repaint', () => {
    const c = mountComposer();
    fireEvent.change(c.text, { target: { value: 'announced' } });
    fireEvent.click(c.add);
    const status = document.querySelector('.preview-compose-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain('added');
    expect(status?.textContent).toContain('1 custom message');
  });

  it('gives every control a real label and no duplicate ids', () => {
    mountComposer();
    expect(screen.getByLabelText('Display name')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
    /* The platform radios are a labelled group rather than four bare pills. */
    const group = screen.getByRole('group', { name: 'Platform' });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);

    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('composes as the selected platform', () => {
    const c = mountComposer();
    /* By id, not by label text: "YouTube" is also the label on the YouTube
       channel input, so a label query here is ambiguous. */
    fireEvent.click(document.getElementById('compose-platform-youtube')!);
    fireEvent.change(c.name, { target: { value: 'ytperson' } });
    fireEvent.change(c.text, { target: { value: 'from youtube' } });
    fireEvent.click(c.add);

    /* Platform tag on, because the default is the legacy omitted-parameter case:
       with no channels configured the overlay resolves that to 'none' and draws
       no marker at all. Asking for one explicitly is what makes the platform
       observable here. */
    fireEvent.click(document.getElementById('mc-sourceTag-label')!);

    /* The marker is drawn from the message's own platform, so it is the honest
       signal that the selector reached the model — but only when read off *this*
       line. A YouTube fixture ships in the built-in set, so a preview-wide query
       would pass even if the composer had ignored the radio entirely. */
    const line = within(preview()).getByText('ytperson').closest('div');
    expect(line?.textContent).toContain('from youtube');
    expect(line?.querySelector('[data-source-tag="label"]')?.getAttribute('data-platform'))
      .toBe('youtube');
  });
});

describe.skip('composed messages stay in the preview', () => {
  it('never reaches the generated URL or the saved draft', () => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    render(<ClassicGenerator />);
    fireEvent.change(document.getElementById('compose-text')!, {
      target: { value: 'secretcomposedtext' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send custom preview message' }));
    fireEvent.change(document.getElementById('channel-kick')!, {
      target: { value: 'somechannel' },
    });
    act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10));

    for (const el of Array.from(document.querySelectorAll('.url-code'))) {
      expect(el.textContent ?? '').not.toContain('secretcomposedtext');
      expect(el.textContent ?? '').not.toContain('custom-');
    }
    expect(JSON.stringify(window.sessionStorage)).not.toContain('secretcomposedtext');
    vi.useRealTimers();
  });

  it('sends nothing anywhere', () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: string) => {
      seen.push(String(u));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
    vi.stubGlobal('WebSocket', class {
      constructor(u: string) { seen.push(`ws:${u}`); }
      close() {}
      send() { seen.push('send'); }
      addEventListener() {}
    });
    compose('not transmitted', 'nobody');
    expect(seen).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe.skip('the composer works alongside the automatic feed', () => {
  /* The moving feed is the default state. Composing appends exactly the requested
     line without changing that state or adding a second scheduler. */

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The Live preview feed switch, which is the state under test here. */
  const feedSwitch = () => document.getElementById('preview-feed-enabled') as HTMLInputElement;

  /* Timer counts are compared against a baseline rather than against zero. The
     mounted generator legitimately owns a debounce timer for the URL fields, so
     zero is the wrong expectation here — the claim is that composing adds no timer
     of its own, and a delta says that precisely. Simulator scheduling behavior is
     asserted at the hook level, where nothing else is running. */

  it('starts with the moving feed enabled', () => {
    mountComposer();
    expect(feedSwitch().checked).toBe(true);
  });

  it('appends the composed message without changing the feed', () => {
    const before = (() => {
      mountComposer();
      return bodies().length;
    })();
    cleanup();
    compose('added by hand', 'handadder');
    expect(bodies()).toHaveLength(before + 1);
    expect(bodies().join(' ')).toContain('added by hand');
  });

  it('leaves the feed enabled after adding a message', () => {
    compose('added by hand', 'handadder');
    expect(feedSwitch().checked).toBe(true);
  });

  it('arms no timer of its own when a message is added', () => {
    const c = mountComposer();
    const baseline = vi.getTimerCount();
    fireEvent.change(c.text, { target: { value: 'added by hand' } });
    fireEvent.click(c.add);
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('keeps the composed message while the automatic feed continues', () => {
    compose('added by hand', 'handadder');
    act(() => void vi.advanceTimersByTime(10_000));
    expect(bodies().join(' ')).toContain('added by hand');
    expect(feedSwitch().checked).toBe(true);
  });

  it('keeps the curated six rows underneath the composed line', () => {
    /* Appended, not substituted. Six fixtures plus one composed message, with the
       composed one last — and the showcase intact above it. */
    compose('added by hand', 'handadder');
    const rows = bodies();
    expect(rows).toHaveLength(7);
    expect(rows[rows.length - 1]).toContain('added by hand');
    expect(rows.join(' ')).toContain('keep it civil in here please');
  });

  it('takes several composed messages without disturbing the running scheduler', () => {
    const c = mountComposer();
    const baseline = vi.getTimerCount();
    for (const text of ['one', 'two', 'three']) {
      fireEvent.change(c.text, { target: { value: text } });
      fireEvent.click(c.add);
    }
    expect(bodies()).toHaveLength(9);
    expect(feedSwitch().checked).toBe(true);
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
