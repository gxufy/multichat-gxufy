/* Preview containment: production preview renderers live inside isolated frame
 * documents so their full-page CSS cannot leak into the generator document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';
import { cleanup, render } from '@testing-library/react';
import ClassicChatPreview from '@/components/classic/ClassicChatPreview';
import ClassicCounterPreview from '@/components/classic/ClassicCounterPreview';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import IsolatedPreviewFrame from '@/components/classic/IsolatedPreviewFrame';
import { multichatTool } from '@/features/multichat/config';
import { counterTool } from '@/features/counter/config';
import { MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
import {
  SAMPLE_COSMETICS,
  SAMPLE_PIN_BY,
  sampleAllMessages,
} from '@/features/multichat/samples';
import {
  SAMPLE_COUNTER_COUNTS,
  sampleCounterStatuses,
} from '@/features/counter/samples';
import { safeParseMultichatConfig } from '@/lib/multichatConfig';
import { PLATFORM_ORDER } from '@/lib/viewerCounterConfig';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const CHAT_TITLE = 'MultiChat sample preview';
const COUNTER_TITLE = 'Viewer Counter sample preview';

const chatQuery = (style: Partial<Record<string, unknown>> = {}) =>
  multichatTool.serialize({}, { ...multichatTool.defaults, ...style } as never);
const counterQuery = (style: Partial<Record<string, unknown>> = {}) =>
  counterTool.serialize({}, { ...counterTool.defaults, ...style } as never);

const frameEl = (title: string) =>
  document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`)!;
const frameDoc = (title: string) => frameEl(title).contentDocument!;
const allCss = (doc: Document) =>
  Array.from(doc.querySelectorAll('style')).map((el) => el.textContent ?? '').join('\n');

function mountChat(style: Partial<Record<string, unknown>> = {}) {
  return render(
    <ClassicChatPreview
      query={chatQuery(style)}
      messages={sampleAllMessages()}
      cosmetics={SAMPLE_COSMETICS}
      width={MULTICHAT_OBS_SIZE.width}
      height={MULTICHAT_OBS_SIZE.height}
    />,
  );
}

function mountCounter(style: Partial<Record<string, unknown>> = {}) {
  return render(
    <ClassicCounterPreview
      query={counterQuery(style)}
      statuses={sampleCounterStatuses(SAMPLE_COUNTER_COUNTS)}
      width={counterTool.obs.width}
      height={counterTool.obs.height}
    />,
  );
}

function PageHeadManager({ children }: { children: ReactNode }) {
  const [head, setHead] = useState<ReactNode[]>([]);
  const manager = useMemo(
    () => ({
      mountedInstances: new Set<unknown>(),
      updateHead: (next: ReactNode[]) => setHead(next),
    }),
    [],
  );
  return (
    <HeadManagerContext.Provider value={manager}>
      {children}
      {createPortal(<>{head}</>, document.head)}
    </HeadManagerContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  for (const el of Array.from(document.head.querySelectorAll('style, link, base'))) {
    el.remove();
  }
});

describe('isolated preview frames', () => {
  it('uses a local non-navigating frame for chat', () => {
    mountChat();
    const frame = frameEl(CHAT_TITLE);
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toBeNull();
    expect(frame.getAttribute('srcdoc')).toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frameDoc(CHAT_TITLE).querySelector('#chat_container')).toBeTruthy();
  });

  it('uses the same isolated-frame shape for the counter', () => {
    mountCounter();
    const frame = frameEl(COUNTER_TITLE);
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toBeNull();
    expect(frame.getAttribute('srcdoc')).toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(allCss(frameDoc(COUNTER_TITLE))).toContain('vcIn');
  });

  it('keeps each tool aspect ratio on the shared frame wrapper', () => {
    render(
      <IsolatedPreviewFrame title="probe" width={2} height={1}>
        <span>probe</span>
      </IsolatedPreviewFrame>,
    );
    expect(frameEl('probe').parentElement?.getAttribute('data-preview-ratio')).toBe('2/1');
    cleanup();
    mountChat();
    expect(frameEl(CHAT_TITLE).parentElement?.getAttribute('data-preview-ratio')).toBe('680/280');
    cleanup();
    mountCounter();
    expect(frameEl(COUNTER_TITLE).parentElement?.getAttribute('data-preview-ratio')).toBe('400/80');
  });
});

describe('CSS containment', () => {
  it('puts ChatOverlay full-page CSS inside the chat frame only', () => {
    mountChat();
    const inside = allCss(frameDoc(CHAT_TITLE));
    const outside = allCss(document);
    expect(inside).toContain('#__next');
    expect(inside).toMatch(/height:\s*100vh\s*!important/);
    expect(outside).not.toContain('#__next');
    expect(outside).not.toMatch(/height:\s*100vh\s*!important/);
  });

  it('keeps counter renderer CSS inside the counter frame', () => {
    mountCounter();
    expect(allCss(frameDoc(COUNTER_TITLE))).toContain('@font-face');
    expect(allCss(document)).not.toContain('DejaVuSans-Bold');
  });

  it('adds a base href inside the isolated counter document', () => {
    mountCounter();
    expect(frameDoc(COUNTER_TITLE).querySelector('base')?.getAttribute('href'))
      .toBe(`${window.location.origin}/`);
  });

  it('positive control: unframed ChatOverlay writes its reset into the page head', () => {
    const parsed = safeParseMultichatConfig({ kick: 'someone' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    render(
      <PageHeadManager>
        <ChatOverlay
          config={parsed.data}
          messages={[]}
          fadingIds={new Set()}
          pinnedMessage={null}
          showLoader={false}
        />
      </PageHeadManager>,
    );
    expect(allCss(document)).toContain('#__next');
  });
});

describe('content containment with retired pins', () => {
  it('keeps all sample chat rows inside the chat frame', () => {
    mountChat();
    expect(frameDoc(CHAT_TITLE).querySelectorAll('#chat_container .ck-body').length)
      .toBeGreaterThan(0);
    expect(document.querySelector('#chat_container')).toBeNull();
  });

  it('keeps the historical pin fixture as an ordinary framed row', () => {
    mountChat({ showPinEnabled: true, pinPlatforms: ['twitch'] });
    const inside = frameDoc(CHAT_TITLE).body.textContent ?? '';
    const outside = document.body.textContent ?? '';
    expect(inside).toContain('read the pinned message before asking');
    expect(inside).not.toContain(`Pinned by ${SAMPLE_PIN_BY}`);
    expect(inside).not.toContain('Pinned Message');
    expect(outside).not.toContain(`Pinned by ${SAMPLE_PIN_BY}`);
  });

  it('keeps sample counter totals inside the counter frame', () => {
    mountCounter({ combined: false });
    const inside = frameDoc(COUNTER_TITLE).body.textContent ?? '';
    for (const platform of PLATFORM_ORDER) {
      expect(inside).toContain(SAMPLE_COUNTER_COUNTS[platform].toLocaleString());
    }
    expect(document.body.textContent ?? '').not.toContain(
      SAMPLE_COUNTER_COUNTS.twitch.toLocaleString(),
    );
  });
});
