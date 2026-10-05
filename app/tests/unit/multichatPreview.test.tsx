/* Built-in MultiChat Preview Data regression coverage.
 *
 * Fixtures render through the production message renderer without connecting to
 * live chat. Native pin presentation is retired: the historical pin fixture now
 * remains an ordinary message even if legacy pin fields are supplied to the
 * serializer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import ClassicChatPreview from '@/components/classic/ClassicChatPreview';
import { multichatTool } from '@/features/multichat/config';
import { MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
import {
  SAMPLE_ALL_MESSAGES,
  SAMPLE_COSMETICS,
  SAMPLE_GROUPS,
  SAMPLE_MESSAGES,
  SAMPLE_PIN_BY,
  sampleAllMessages,
  sampleMessages,
  samplePlatforms,
} from '@/features/multichat/samples';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const queryFor = (style: Partial<Record<string, unknown>> = {}) =>
  multichatTool.serialize({}, { ...multichatTool.defaults, ...style } as never);

function mountWith(all = false, style: Partial<Record<string, unknown>> = {}) {
  return render(
    <ClassicChatPreview
      query={queryFor(style)}
      messages={all ? sampleAllMessages() : sampleMessages()}
      cosmetics={SAMPLE_COSMETICS}
      width={MULTICHAT_OBS_SIZE.width}
      height={MULTICHAT_OBS_SIZE.height}
    />,
  );
}

const frame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="MultiChat sample preview"]')!;
const preview = () => frame().contentDocument!.body;
const rows = () => preview().querySelectorAll('#chat_container .ck-body');
const previewText = () => preview().textContent ?? '';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('Preview Data fixtures', () => {
  it('renders the default showcase immediately', () => {
    mountWith();
    expect(rows()).toHaveLength(SAMPLE_MESSAGES.length);
    expect(rows().length).toBeGreaterThan(0);
  });

  it('covers all four chat platforms in the default showcase', () => {
    expect(samplePlatforms().sort()).toEqual(['kick', 'tiktok', 'twitch', 'youtube']);
    mountWith();
    const text = previewText();
    expect(text).toContain('emotefiend');
    expect(text).toContain('purplereign');
    expect(text).toContain('RedButtonRadio');
    expect(text).toContain('tiktokmod');
  });

  it('keeps every fixture capability group represented in the full catalog', () => {
    const groups = new Set(SAMPLE_ALL_MESSAGES.map((sample) => sample.group));
    for (const group of SAMPLE_GROUPS) expect(groups.has(group)).toBe(true);
  });

  it('renders production badges, emotes, mentions, and Unicode content', () => {
    mountWith(true);
    expect(preview().querySelectorAll('img.ck-badge-img').length).toBeGreaterThan(0);
    expect(preview().querySelectorAll('img.ck-emote').length).toBeGreaterThan(0);
    expect(preview().querySelector('.ck-body strong')?.textContent).toContain('@');
    const text = previewText();
    expect(text).toContain('ありがとう');
    expect(text).toContain('شكرا');
  });

  it('keeps the isolation iframe local instead of navigating to /multichat', () => {
    mountWith();
    expect(frame().getAttribute('src')).toBeNull();
    expect(frame().getAttribute('srcdoc')).toBeNull();
  });
});

describe('retired pin behavior in Preview Data', () => {
  it('does not serialize legacy pin fields', () => {
    const query = queryFor({ showPinEnabled: true, pinPlatforms: ['twitch'] });
    expect(query).not.toContain('showPinEnabled');
    expect(query).not.toContain('pinPlatforms');
  });

  it('renders the historical pin fixture as an ordinary row with no pin banner', () => {
    mountWith(true, { showPinEnabled: true, pinPlatforms: ['twitch'] });
    expect(rows()).toHaveLength(SAMPLE_ALL_MESSAGES.length);
    expect(previewText()).toContain('read the pinned message before asking');
    expect(previewText()).not.toContain(`Pinned by ${SAMPLE_PIN_BY}`);
    expect(previewText()).not.toContain('Pinned Message');
  });
});

describe('generator Preview Data surface', () => {
  it('labels built-in chat fixtures as Preview Data', () => {
    render(<ClassicGenerator />);
    const chat = document.querySelector('.panel-chat-output') as HTMLElement;
    expect(within(chat).getAllByText('Preview Data').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('group', { name: /sample chat messages, not a live stream/i }),
    ).toBeTruthy();
  });

  it('contains no reachable pin or Twitch pin-connection control', () => {
    render(<ClassicGenerator />);
    expect(document.getElementById('mc-showPinEnabled')).toBeNull();
    expect(document.getElementById('mc-pinPlatforms-twitch')).toBeNull();
    expect(document.querySelector('.classic-conn')).toBeNull();
  });
});

describe('Preview Data opens no live chat connection', () => {
  it('ClassicChatPreview itself creates no socket, EventSource, or fetch', () => {
    const seen: string[] = [];
    vi.stubGlobal('WebSocket', class {
      constructor(url: string) { seen.push(`ws:${url}`); }
      close() {}
      addEventListener() {}
    });
    vi.stubGlobal('EventSource', class {
      constructor(url: string) { seen.push(`sse:${url}`); }
      close() {}
      addEventListener() {}
    });
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      seen.push(`fetch:${String(url)}`);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));

    mountWith();
    expect(seen).toEqual([]);
  });
});
