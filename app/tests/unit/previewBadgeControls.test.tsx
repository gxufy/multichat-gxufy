/* The preview badge, cosmetic and paint controls.
 *
 * Two things are being protected here, and they pull in opposite directions.
 *
 * The picker must be HONEST. Every chip names a capability the production
 * renderer genuinely implements, so the tests assert against the renderer's own
 * output — `.ck-badge-img`, a `background` holding a real gradient, a `filter`
 * holding a real drop-shadow — rather than against the fixture that asked for
 * it. A chip whose code path was deleted would keep looking fine in a test that
 * only checked the fixture, and that is exactly the failure worth catching.
 *
 * The picker must be POWERLESS over the overlay. It chooses fake identities and
 * nothing else: the chat settings stay the authority on whether those identities
 * draw, and none of the picker's state may reach a generated URL or a saved
 * draft. So the same chips are asserted twice over — once for having an effect on
 * new messages, once for having no effect on anything serialized.
 *
 * Paints are asserted through `buildPaintStyle` by way of the real preview, never
 * re-derived here. The spec forbids approximating paint rendering, and a test
 * that hand-built a gradient string would be that approximation wearing a
 * different hat: it would agree with itself forever while the overlay broke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import ClassicChatPreview from '@/components/classic/ClassicChatPreview';
import ClassicPreviewBadgePicker from '@/components/classic/ClassicPreviewBadgePicker';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';
import { multichatTool } from '@/features/multichat/config';
import { MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';
import { SAMPLE_COSMETICS, sampleMessages } from '@/features/multichat/samples';
import { PREVIEW_EMOTE_TOKENS } from '@/features/multichat/previewAssets';
import { resetAssetErrorLog } from '@/lib/render/imageFallback';
import {
  PREVIEW_SOURCES,
  PREVIEW_SOURCE_HINT,
  PREVIEW_SOURCE_LABEL,
  allSourcesEnabled,
  generateMessage,
  noSourcesEnabled,
  randomSources,
  seededRandom,
  type PreviewSource,
  type PreviewSourceState,
} from '@/features/multichat/previewSimulator';
import { workspaceDraftKey } from '@/lib/workspaceStorage';
import type { ToolChannels } from '@/features/registry';
import type { MultichatPlatform } from '@/lib/multichatConfig';
import type { UnifiedMessage } from '@/lib/types';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const NO_CHANNELS: ToolChannels<MultichatPlatform> = {};

const queryFor = (style: Partial<Record<string, unknown>> = {}) =>
  multichatTool.serialize(NO_CHANNELS, { ...multichatTool.defaults, ...style } as never);

/** Render the production preview over a supplied generated set. */
const mountPreview = (
  messages: readonly UnifiedMessage[],
  style: Partial<Record<string, unknown>> = {},
) =>
  render(
    <ClassicChatPreview
      query={queryFor(style)}
      messages={messages}
      cosmetics={SAMPLE_COSMETICS}
      width={MULTICHAT_OBS_SIZE.width}
      height={MULTICHAT_OBS_SIZE.height}
    />,
  );

const frame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="MultiChat sample preview"]')!;
const preview = () => frame().contentDocument!.body;

/**
 * Generate until `count` messages satisfy `want`.
 *
 * The pool is drawn from at random, so "a painted message" is not a fixed
 * sequence number. Seeded, this is fully deterministic — but it is written as a
 * search rather than a hardcoded index so that reordering the pool does not
 * silently turn these assertions into assertions about something else.
 */
function generateUntil(
  want: (message: UnifiedMessage) => boolean,
  count: number,
  sources: PreviewSourceState = allSourcesEnabled(),
  seed = 7,
): readonly UnifiedMessage[] {
  const random = seededRandom(seed);
  const found: UnifiedMessage[] = [];
  for (let sequence = 1; sequence <= 4000 && found.length < count; sequence += 1) {
    const message = generateMessage(sequence, sources, random);
    if (want(message)) found.push(message);
  }
  expect(found, `only found ${found.length} of ${count}`).toHaveLength(count);
  return found;
}

/** The entitled identity, which is what makes a paint attach at all. */
const isPainted = (message: UnifiedMessage) => message.senderId === 'sample-paint-sender';

/* ------------------------------------------------------------------ */
/* The control surface                                                */
/* ------------------------------------------------------------------ */

describe('the picker offers one control per supported fixture source', () => {
  /* Mounted alone: these assert the control surface, and the generator's own
     wiring is asserted separately below. */
  const noop = () => {};

  const mountPicker = (sources: PreviewSourceState = allSourcesEnabled()) =>
    render(
      <ClassicPreviewBadgePicker
        sources={sources}
        onToggleSource={noop}
        onEnableAll={noop}
        onDisableAll={noop}
        onRandomize={noop}
        onReset={noop}
      />,
    );

  afterEach(cleanup);

  it('renders a checkbox for every source and nothing beyond them', () => {
    mountPicker();
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('.preview-feed-chips input[type="checkbox"]'),
    );
    expect(boxes).toHaveLength(PREVIEW_SOURCES.length);
    expect(boxes.map((box) => box.id)).toEqual(
      PREVIEW_SOURCES.map((source) => `preview-source-${source}`),
    );
  });

  it('labels each source with its own recognizable name', () => {
    mountPicker();
    for (const source of PREVIEW_SOURCES) {
      const label = document.querySelector(`label[for="preview-source-${source}"]`);
      expect(label?.textContent, source).toBe(PREVIEW_SOURCE_LABEL[source]);
    }
    /* Distinct labels, so the picker cannot claim the same thing twice. */
    const labels = new Set(PREVIEW_SOURCES.map((source) => PREVIEW_SOURCE_LABEL[source]));
    expect(labels.size).toBe(PREVIEW_SOURCES.length);
  });

  it('describes every source, naming the setting that gates it where one does', () => {
    mountPicker();
    for (const source of PREVIEW_SOURCES) {
      const box = document.getElementById(`preview-source-${source}`)!;
      const described = box.getAttribute('aria-describedby')!;
      const hint = document.getElementById(described);
      expect(hint?.textContent, source).toBe(PREVIEW_SOURCE_HINT[source]);
    }
    /* The three that are gated say so, because a chip that looks broken while a
       setting is off is the confusion this text exists to prevent. */
    expect(PREVIEW_SOURCE_HINT.sevenTVCosmetics).toContain('7TV cosmetics');
    expect(PREVIEW_SOURCE_HINT.sevenTVPaints).toContain('7TV cosmetics');
    expect(PREVIEW_SOURCE_HINT.bttvEmotes).toContain('7TV emotes');
  });

  it('shows the enabled state on the control itself, not only in styling', () => {
    const mixed = { ...allSourcesEnabled(), twitchBadges: false };
    mountPicker(mixed);
    const on = document.getElementById('preview-source-kickBadges') as HTMLInputElement;
    const off = document.getElementById('preview-source-twitchBadges') as HTMLInputElement;
    /* Native checkbox state, so assistive technology reads it without help. */
    expect(on.checked).toBe(true);
    expect(off.checked).toBe(false);
    /* And a visible difference, for everyone else. */
    expect(document.querySelector('label[for="preview-source-kickBadges"]')!.className).toContain('on');
    expect(document.querySelector('label[for="preview-source-twitchBadges"]')!.className).not.toContain('on');
  });

  it('offers the four bulk actions as real buttons', () => {
    mountPicker();
    for (const name of ['Enable all', 'Disable all', 'Randomize badges', 'Reset badge selection']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName, name).toBe('BUTTON');
      /* type=button, or each of these would submit the enclosing form. */
      expect(button.getAttribute('type'), name).toBe('button');
    }
  });

  it('claims no source the renderer does not implement', () => {
    /* The honesty guard. Animated paints are the specific temptation: the spec
       allows them only if the renderer supports them, and `buildPaintStyle`
       implements LINEAR_GRADIENT, RADIAL_GRADIENT and URL with no animated
       path — so nothing here may advertise one. */
    const surface = [
      ...PREVIEW_SOURCES.map((source) => PREVIEW_SOURCE_LABEL[source]),
      ...PREVIEW_SOURCES.map((source) => PREVIEW_SOURCE_HINT[source]),
    ].join(' ');
    expect(surface).not.toMatch(/animated/i);
    expect(surface).not.toMatch(/\banimation\b/i);
  });
});

/* ------------------------------------------------------------------ */
/* Bulk actions                                                       */
/* ------------------------------------------------------------------ */

describe('the bulk source actions', () => {
  it('enables every source', () => {
    const all = allSourcesEnabled();
    expect(PREVIEW_SOURCES.every((source) => all[source])).toBe(true);
  });

  it('disables every source', () => {
    const none = noSourcesEnabled();
    expect(PREVIEW_SOURCES.every((source) => !none[source])).toBe(true);
  });

  it('leaves the feed able to draw with every source off', () => {
    /* Disable all must not mean an empty feed: the plain lines need no source,
       which is what keeps the preview alive rather than freezing it. */
    const message = generateMessage(1, noSourcesEnabled(), seededRandom(3));
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.badges).toEqual([]);
  });

  it('randomizes to a genuine subset, never to nothing', () => {
    /* Over many seeds: at least one seed must differ from all-on, and no seed may
       produce an empty selection. Asserted across the range rather than for one
       draw, because a single draw proves neither property. */
    const draws = Array.from({ length: 40 }, (_, seed) => randomSources(seededRandom(seed + 1)));
    expect(draws.some((draw) => PREVIEW_SOURCES.some((source) => !draw[source]))).toBe(true);
    for (const draw of draws) {
      expect(PREVIEW_SOURCES.some((source) => draw[source])).toBe(true);
    }
  });

  it('resets to every source on', () => {
    /* Reset is defined as returning to the default, and the default is all-on —
       so the two must not drift apart. */
    expect(allSourcesEnabled()).toEqual(
      PREVIEW_SOURCES.reduce<PreviewSourceState>(
        (acc, source) => ({ ...acc, [source]: true }),
        {} as PreviewSourceState,
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Sources reach the renderer                                         */
/* ------------------------------------------------------------------ */

describe('an enabled source changes what the renderer draws', () => {
  afterEach(cleanup);

  it('draws badge art for a badged fixture through the production badge renderer', () => {
    const badged = generateUntil((m) => (m.badges?.length ?? 0) > 0, 3);
    mountPreview(badged);
    /* .ck-badge-img is emitted by renderBadges and by nothing else here, so its
       presence is evidence the real resolver ran rather than that a fixture
       carried a picture. */
    expect(preview().querySelectorAll('img.ck-badge-img').length).toBeGreaterThan(0);
  });

  it('draws TikTok badge art wide, as the renderer classifies pre-resolved art', () => {
    const tiktok = generateUntil(
      (m) => m.platform === 'tiktok' && (m.badges?.length ?? 0) > 0,
      1,
    );
    mountPreview(tiktok);
    /* ck-badge-wide is the renderer's own decision about a url-carrying badge. */
    expect(preview().querySelector('img.ck-badge-wide')).toBeTruthy();
  });

  it('draws the FFZ room-badge override from its own art rather than the stock badge', () => {
    const ffz = generateUntil(
      (m) => (m.badges ?? []).some((badge) => badge.url?.startsWith('data:image/svg+xml')),
      1,
    );
    mountPreview(ffz);
    const art = Array.from(preview().querySelectorAll<HTMLImageElement>('img.ck-badge-img'));
    const overridden = art.filter((img) => img.getAttribute('src')?.startsWith('data:image/svg+xml'));
    expect(overridden.length).toBeGreaterThan(0);
    /* Local art, so the preview makes no request for a badge. */
    for (const img of art) {
      expect(img.getAttribute('src') ?? '').not.toMatch(/^https?:\/\//);
    }
  });

  it('applies no badge art when a fixture carries no badges', () => {
    /* The negative half: with every source off the pool is plain lines, so the
       badge assertions above are about the sources rather than about the
       renderer drawing badges unconditionally. */
    const plain = generateUntil(() => true, 6, noSourcesEnabled());
    expect(plain.every((message) => (message.badges?.length ?? 0) === 0)).toBe(true);
    mountPreview(plain);
    expect(preview().querySelectorAll('img.ck-badge-img')).toHaveLength(0);
  });

  it('holds back an entry whose source is off and offers it when the source is on', () => {
    /* One source, isolated. A painted entry requires sevenTVPaints, so turning
       just that one off must remove it from the pool entirely. */
    const off: PreviewSourceState = { ...allSourcesEnabled(), sevenTVPaints: false, sevenTVCosmetics: false };
    const random = seededRandom(11);
    const drawn: UnifiedMessage[] = [];
    for (let sequence = 1; sequence <= 400; sequence += 1) {
      drawn.push(generateMessage(sequence, off, random));
    }
    expect(drawn.some(isPainted)).toBe(false);
    /* And with it on, the same search finds one. */
    expect(generateUntil(isPainted, 1)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* 7TV paints, through production logic                               */
/* ------------------------------------------------------------------ */

describe('7TV paints render through the production paint builder', () => {
  afterEach(cleanup);

  /** The painted name node inside the frame, found by the fixture's username. */
  const paintedName = (message: UnifiedMessage) =>
    within(preview()).getByText(`${message.username}:`);

  it('paints a generated name with a real gradient background', () => {
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: true });
    const name = paintedName(painted);
    /* The gradient is buildPaintStyle's output over the fixture paint: a
       LINEAR_GRADIENT at 90deg with three decoded rgba stops. Asserted as the
       renderer's own shape rather than compared against a string built here,
       which would be the separate CSS approximation the spec forbids. */
    expect(name.style.background).toContain('linear-gradient');
    expect(name.style.background).toContain('90deg');
    expect(name.style.background).toMatch(/rgba?\(/);
  });

  it('carries the paint shadow as a drop-shadow filter when shadows are on', () => {
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: true, paintShadows: true });
    expect(paintedName(painted).style.filter).toContain('drop-shadow');
  });

  it('drops the shadow but keeps the paint when paintShadows is off', () => {
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: true, paintShadows: false });
    const name = paintedName(painted);
    expect(name.style.filter).toBe('');
    /* The setting removes shadows, not paints — the distinction the production
       builder makes by returning an empty filter rather than no background. */
    expect(name.style.background).toContain('linear-gradient');
  });

  it('detaches the paint entirely when 7TV cosmetics are off', () => {
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: false });
    const name = paintedName(painted);
    expect(name.style.background).toBe('');
    /* The name is still legible, on its fallback colour. */
    expect(name.style.color).not.toBe('');
  });

  it('attaches the 7TV badge alongside the paint, from the same entitlement', () => {
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: true });
    const badge = preview().querySelector<HTMLImageElement>('img[alt="7tv badge"]');
    expect(badge).toBeTruthy();
    cleanup();
    mountPreview([painted], { sevenTVCosmeticsEnabled: false });
    expect(preview().querySelector('img[alt="7tv badge"]')).toBeNull();
  });

  it('FALLBACK: hides a badge whose art fails to load, keeping the message', () => {
    /* The runtime net, exercised through the real renderer. The fixture art is
       valid, so this forces the failure the way a dead live CDN would — by
       firing the image's own error event — and asserts the handler the renderer
       attached hides that one badge and nothing else. */
    resetAssetErrorLog();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: true });
    const badge = preview().querySelector<HTMLImageElement>('img[alt="7tv badge"]')!;
    expect(badge).toBeTruthy();

    badge.dispatchEvent(new (preview().ownerDocument.defaultView as any).Event('error'));

    /* The badge is hidden with no layout box, and the painted name it sat beside
       is still on screen — only the failed image left the flow. */
    expect(badge.style.display).toBe('none');
    expect(badge.getAttribute('data-asset-failed')).toBe('true');
    expect(within(preview()).getByText(`${painted.username}:`)).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
    resetAssetErrorLog();
  });

  it("paints a generated name and a fixture name by the very same code path", () => {
    /* Both must share one renderer. If the generated message were painted by a
       different mechanism, one of these two would drift and this comparison is
       what would notice. */
    const [painted] = generateUntil(isPainted, 1);
    mountPreview([painted], { sevenTVCosmeticsEnabled: true });
    const generated = paintedName(painted).style.background;
    cleanup();
    /* The built-in fixtures, unmodified — 'paintedname' is the sample chatter the
       same entitlement names, so this is the fixture half of the comparison. */
    mountPreview(sampleMessages(), { sevenTVCosmeticsEnabled: true });
    const fixture = within(preview()).getByText('paintedname:').style.background;
    expect(generated).toBe(fixture);
    expect(generated).not.toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* The chat settings stay the authority                               */
/* ------------------------------------------------------------------ */

describe('the chat settings remain the authority over what draws', () => {
  afterEach(cleanup);

  it('keeps Preview Data platform marks as icons without changing the serialized setting', () => {
    const generated = generateUntil(() => true, 4, allSourcesEnabled());
    for (const mode of ['icon', 'dot', 'label', 'none'] as const) {
      mountPreview(generated, { sourceTag: mode });
      expect(preview().querySelectorAll('[data-source-tag="icon"]').length, mode).toBeGreaterThan(0);
      expect(preview().querySelectorAll('[data-source-tag="dot"], [data-source-tag="label"]')).toHaveLength(0);
      cleanup();
    }
  });

  it('swaps third-party emotes in generated text only while emotes are on', () => {
    /* A BTTV entry's text carries the emote words; the swap itself is the
       production loader's, so the count is what moves. */
    const emoted = generateUntil((m) => /OMEGALUL|KEKW/.test(m.text), 2);
    mountPreview(emoted, { sevenTVEmotesEnabled: true });
    const withEmotes = preview().querySelectorAll('img.ck-emote').length;
    cleanup();
    mountPreview(emoted, { sevenTVEmotesEnabled: false });
    const withoutEmotes = preview().querySelectorAll('img.ck-emote').length;
    expect(withEmotes).toBeGreaterThan(withoutEmotes);
    /* The word survives as text either way. */
    expect(preview().textContent).toMatch(/OMEGALUL|KEKW/);
  });

  it('gates the BTTV and FFZ emote tokens on the same sevenTVEmotesEnabled setting', () => {
    /* PROVIDER-TOGGLE HONESTY. There is no BTTV or FFZ setting in this repo:
       loadTwitchEmotes merges FFZ, BTTV and 7TV into one list and
       buildParsedMessage gates that whole list on sevenTVEmotesEnabled. So the
       BTTV token (catJAM) and the FFZ token (PepeLaugh) must swap to images only
       when that one setting is on, exactly as the 7TV tokens do — asserted here
       rather than assumed. */
    for (const token of [PREVIEW_EMOTE_TOKENS.bttv, PREVIEW_EMOTE_TOKENS.ffz]) {
      const carrier = generateUntil((m) => m.text.includes(token), 1);
      mountPreview(carrier, { sevenTVEmotesEnabled: true });
      const swapped = preview().querySelectorAll('img.ck-emote').length;
      cleanup();
      mountPreview(carrier, { sevenTVEmotesEnabled: false });
      const plain = preview().querySelectorAll('img.ck-emote').length;
      expect(swapped, token).toBeGreaterThan(plain);
      /* Off, the token is still readable as text — nothing is silently dropped. */
      expect(preview().textContent, token).toContain(token);
      cleanup();
    }
  });

  it('has only the intentional community-badge visibility setting, not a global badge switch', () => {
    /* The catalog intentionally exposes one badge-related control: community
       badges can be hidden while native platform badges remain visible. There is
       still no global showBadges switch, so the preview picker must not imply it
       can suppress every badge source. */
    const keys = MULTICHAT_CATALOG.map((setting) => String(setting.key));
    expect(keys).not.toContain('showBadges');
    expect(keys.filter((key) => /badge/i.test(key))).toEqual(['showCommunityBadges']);
    const community = MULTICHAT_CATALOG.find(
      (setting) => setting.key === 'showCommunityBadges',
    );
    expect(community?.type).toBe('toggle');
    expect(community?.description).toMatch(/third-party/i);
    expect(community?.description).toMatch(/native platform badges/i);
    expect(community?.description).toMatch(/unaffected/i);
  });
});

/* ------------------------------------------------------------------ */
/* Wired into the generator, and serialized nowhere                   */
/* ------------------------------------------------------------------ */

describe('the final generator removes manual badge source selection', () => {
  it('shows no badge source picker or bulk source actions', () => {
    render(<ClassicGenerator />);
    expect(screen.queryByText('Preview badges & cosmetics')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Randomize badges' })).toBeNull();
  });
});

describe.skip('retired picker inside the generator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  /** The generated chat URL, which is the thing that must not move. */
  const chatUrl = () =>
    within(document.querySelector<HTMLElement>('.panel-chat-output')!)
      .getByLabelText('Generated MultiChat overlay URL').textContent ?? '';

  const settle = () => act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10));

  it('appears on the bare generator, inside the chat card', () => {
    render(<ClassicGenerator />);
    const card = document.querySelector('.panel-chat-output')!;
    expect(card.querySelector('.preview-feed-sources')).toBeTruthy();
    expect(card.querySelectorAll('.preview-feed-chips input[type="checkbox"]')).toHaveLength(
      PREVIEW_SOURCES.length,
    );
  });

  it('toggles a source without touching the generated URL', () => {
    render(<ClassicGenerator />);
    settle();
    const before = chatUrl();
    expect(before.length).toBeGreaterThan(0);
    const box = document.getElementById('preview-source-twitchBadges') as HTMLInputElement;
    act(() => void fireEvent.click(box));
    expect(box.checked).toBe(false);
    settle();
    expect(chatUrl()).toBe(before);
  });

  it('serializes no source state into the URL under any bulk action', () => {
    render(<ClassicGenerator />);
    settle();
    const before = chatUrl();
    for (const name of ['Disable all', 'Randomize badges', 'Enable all', 'Reset badge selection']) {
      act(() => void fireEvent.click(screen.getByRole('button', { name })));
      settle();
      expect(chatUrl(), name).toBe(before);
    }
    /* And no preview vocabulary leaked into the query, whatever its value.
       Two source names are deliberately excluded from this scan: the query
       genuinely carries `sevenTVCosmeticsEnabled` and `sevenTVEmotesEnabled`,
       which are real chat settings whose names the chips echo. Scanning for the
       bare source keys would match those and fail on correct output, so the two
       overlapping keys are checked as exact parameters instead. */
    const overlapping: readonly PreviewSource[] = ['sevenTVCosmetics', 'bttvEmotes'];
    for (const source of PREVIEW_SOURCES) {
      if (overlapping.includes(source)) continue;
      expect(before, source).not.toContain(source);
    }
    const params = new URLSearchParams(before.split('?')[1] ?? '');
    for (const source of PREVIEW_SOURCES) expect(params.has(source), source).toBe(false);
    expect(before).not.toMatch(/fixture|sim-/i);
  });

  it('writes no source state into the saved draft', () => {
    render(<ClassicGenerator />);
    settle();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Disable all' })));
    settle();
    /* Read directly rather than through a spy: spying on sessionStorage schedules
       a jsdom timer of its own, which fake timers then have to step over. */
    const draft = window.sessionStorage.getItem(workspaceDraftKey('multichat')) ?? '';
    for (const source of PREVIEW_SOURCES) expect(draft).not.toContain(source);
  });

  it('reports the enabled count once rather than announcing every chip', () => {
    render(<ClassicGenerator />);
    const feed = document.querySelector('.preview-chat-feed')!;
    const status = feed.querySelector('.preview-feed-status[role="status"]')!;
    expect(status.textContent).toContain(`${PREVIEW_SOURCES.length} of ${PREVIEW_SOURCES.length}`);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Disable all' })));
    /* One live region for the chat feed, carrying one summary line — nine separate
       announcements while someone works through the picker would be noise rather
       than information. The picker itself contributes no live region of its own,
       which is the part that matters; the generator has others for unrelated
       things, so they are not counted.

       Scoped to the chat feed rather than to the document: the Viewer counter card
       is a second preview control surface with a status line of its own, and its
       existence is not a regression in this one. */
    expect(feed.querySelectorAll('.preview-feed-status[role="status"]')).toHaveLength(1);
    expect(
      document.querySelector('.preview-feed-sources')!.querySelectorAll(
        '[role="status"], [role="alert"], [aria-live]',
      ),
    ).toHaveLength(0);
    expect(status.textContent).toContain(`0 of ${PREVIEW_SOURCES.length}`);
  });

  it('is operable from the keyboard, by native control semantics', () => {
    render(<ClassicGenerator />);
    const box = document.getElementById('preview-source-kickBadges') as HTMLInputElement;
    /* A real checkbox with a real label: focusable, space-toggleable, and
       announced without aria-pressed. Nothing here is a div listening for
       clicks, which is the failure this asserts against. */
    expect(box.tagName).toBe('INPUT');
    expect(box.type).toBe('checkbox');
    expect(box.disabled).toBe(false);
    expect(document.querySelector('label[for="preview-source-kickBadges"]')).toBeTruthy();
    act(() => void box.focus());
    expect(document.activeElement).toBe(box);
  });

  it('opens no request when the picker is used', () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      seen.push(String(url));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));
    vi.stubGlobal('WebSocket', class {
      constructor(url: string) { seen.push(`ws:${url}`); }
      close() {}
      addEventListener() {}
    });
    render(<ClassicGenerator />);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Randomize badges' })));
    settle();
    expect(seen).toEqual([]);
    vi.unstubAllGlobals();
  });
});
