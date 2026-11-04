/* OverlayPreviewFrame debounce and teardown, with fake timers.
 *
 * Chat URLs still navigate a real iframe. Counter URLs deliberately do not:
 * they are handed to LiveCounterPreview after the same debounce so content
 * blockers cannot suppress a nested /counter navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import OverlayPreviewFrame, {
  PREVIEW_DEBOUNCE_MS,
} from '@/components/workspace/OverlayPreviewFrame';

vi.mock('@/components/workspace/LiveCounterPreview', () => ({
  default: ({ url, height }: { url: string; height: number }) => (
    <div
      data-testid="mock-live-counter"
      data-overlay-url={url}
      data-preview-height={String(height)}
    />
  ),
}));

const CHAT_TITLE = 'Live chat overlay preview';
const COUNTER_TITLE = 'Live viewer counter preview';

function renderFrame(
  url: string,
  configured: boolean,
  title = COUNTER_TITLE,
  height = 80,
) {
  return render(
    <OverlayPreviewFrame
      url={url}
      configured={configured}
      title={title}
      height={height}
    />,
  );
}

const iframe = () => document.querySelector('iframe');
const nativeCounter = () =>
  document.querySelector('[data-testid="mock-live-counter"]');

function settle(ms = PREVIEW_DEBOUNCE_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('unconfigured', () => {
  it('renders no live preview at all', () => {
    renderFrame('http://localhost/counter?combined=true', false);
    expect(iframe()).toBeNull();
    expect(nativeCounter()).toBeNull();
  });

  it('still renders nothing after the debounce elapses', () => {
    renderFrame('http://localhost/counter?combined=true', false);
    settle(PREVIEW_DEBOUNCE_MS * 4);
    expect(iframe()).toBeNull();
    expect(nativeCounter()).toBeNull();
  });
});

describe('counter routing', () => {
  it('waits the full debounce before mounting the native Counter preview', () => {
    const url = 'http://localhost/counter?twitch=a';
    renderFrame(url, true);
    expect(nativeCounter()).toBeNull();

    settle(PREVIEW_DEBOUNCE_MS - 1);
    expect(nativeCounter()).toBeNull();

    settle(1);
    expect(nativeCounter()?.getAttribute('data-overlay-url')).toBe(url);
    expect(iframe()).toBeNull();
  });

  it('rapid changes cancel earlier pending Counter URLs', () => {
    const { rerender } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );

    for (const name of ['ab', 'abc', 'abcd']) {
      settle(PREVIEW_DEBOUNCE_MS - 50);
      expect(nativeCounter()).toBeNull();
      rerender(
        <OverlayPreviewFrame
          url={`http://localhost/counter?twitch=${name}`}
          configured
          title={COUNTER_TITLE}
          height={80}
        />,
      );
    }

    settle();
    expect(nativeCounter()?.getAttribute('data-overlay-url')).toBe(
      'http://localhost/counter?twitch=abcd',
    );
  });

  it('passes an appearance change to the native preview after debounce', () => {
    const { rerender } = renderFrame(
      'http://localhost/counter?twitch=a&bg=true',
      true,
    );
    settle();
    expect(nativeCounter()?.getAttribute('data-overlay-url')).toContain('bg=true');

    rerender(
      <OverlayPreviewFrame
        url="http://localhost/counter?twitch=a&bg=false"
        configured
        title={COUNTER_TITLE}
        height={80}
      />,
    );
    settle();
    expect(nativeCounter()?.getAttribute('data-overlay-url')).toContain('bg=false');
  });

  it('passes the requested height without creating a remote iframe', () => {
    renderFrame('http://localhost/counter?twitch=a', true, COUNTER_TITLE, 80);
    settle();
    expect(nativeCounter()?.getAttribute('data-preview-height')).toBe('80');
    expect(iframe()).toBeNull();
  });
});

describe('chat routing', () => {
  it('keeps the exact generated chat URL in a real iframe', () => {
    const url = 'http://localhost/multichat?twitch=a';
    renderFrame(url, true, CHAT_TITLE, 280);
    settle();

    expect(iframe()?.getAttribute('src')).toBe(url);
    expect(nativeCounter()).toBeNull();
  });

  it('keeps the chat iframe transparent, borderless and at the requested height', () => {
    renderFrame(
      'http://localhost/multichat?twitch=a',
      true,
      CHAT_TITLE,
      280,
    );
    settle();

    const frame = iframe() as HTMLIFrameElement;
    const inline = frame.getAttribute('style') ?? '';
    expect(frame.getAttribute('title')).toBe(CHAT_TITLE);
    expect(frame.getAttribute('scrolling')).toBe('no');
    expect(inline).toContain('background: transparent');
    expect(inline).toContain('overflow: hidden');
    expect(frame.style.height).toBe('280px');
    expect(frame.style.display).toBe('block');
  });

  it('uses no polling interval of its own for chat', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const randomSpy = vi.spyOn(Math, 'random');

    const { rerender } = renderFrame(
      'http://localhost/multichat?twitch=a',
      true,
      CHAT_TITLE,
    );
    settle();

    rerender(
      <OverlayPreviewFrame
        url="http://localhost/multichat?twitch=ab"
        configured
        title={CHAT_TITLE}
        height={80}
      />,
    );
    settle();

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });
});

describe('clearing configuration', () => {
  it('removes a native Counter preview immediately', () => {
    const { rerender } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );
    settle();
    expect(nativeCounter()).not.toBeNull();

    rerender(
      <OverlayPreviewFrame
        url="http://localhost/counter?combined=true"
        configured={false}
        title={COUNTER_TITLE}
        height={80}
      />,
    );

    expect(nativeCounter()).toBeNull();
  });

  it('no delayed timeout restores a cleared preview', () => {
    const { rerender } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );
    settle();

    rerender(
      <OverlayPreviewFrame
        url="http://localhost/counter?combined=true"
        configured={false}
        title={COUNTER_TITLE}
        height={80}
      />,
    );
    settle(PREVIEW_DEBOUNCE_MS * 5);
    expect(nativeCounter()).toBeNull();
  });

  it('never mounts a channel-less preview when configuration flips mid-debounce', () => {
    const { rerender } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );
    settle(PREVIEW_DEBOUNCE_MS - 10);

    rerender(
      <OverlayPreviewFrame
        url="http://localhost/counter?combined=true"
        configured={false}
        title={COUNTER_TITLE}
        height={80}
      />,
    );
    settle(PREVIEW_DEBOUNCE_MS * 3);
    expect(nativeCounter()).toBeNull();
  });
});

describe('teardown', () => {
  it('clears the pending timeout on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('leaves no preview behind after unmount', () => {
    const { unmount } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );
    settle();
    expect(nativeCounter()).not.toBeNull();
    unmount();
    expect(nativeCounter()).toBeNull();
  });

  it('does not mount after unmount even if the timer would have fired', () => {
    const { unmount } = renderFrame(
      'http://localhost/counter?twitch=a',
      true,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 3);
    });
    expect(nativeCounter()).toBeNull();
  });
});
