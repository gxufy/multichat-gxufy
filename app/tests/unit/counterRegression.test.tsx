/* Viewer Counter regression coverage while it shares the Classic generator with
 * MultiChat. The Counter remains an independent tool: no Twitch connection,
 * no pin state, no chat parameters, and the same /counter serializer everywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';
import { counterTool } from '@/features/counter/config';
import { COUNTER_CATALOG } from '@/features/counter/settings';
import {
  DEFAULT_STYLE,
  buildViewerCounterQuery,
  type ViewerPlatform,
} from '@/lib/viewerCounterConfig';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/workspace/LiveCounterPreview', () => ({
  default: ({ url, height }: { url: string; height: number }) => (
    <div
      data-testid="counter-live-preview"
      data-overlay-url={url}
      data-preview-height={String(height)}
    />
  ),
}));

const BASE = 'http://localhost:3000';
const expectedUrl = (
  channels: Partial<Record<ViewerPlatform, string>>,
  style = DEFAULT_STYLE,
) => `${BASE}/counter?${buildViewerCounterQuery(channels, style)}`;

const mount = () => render(<ClassicGenerator />);
const panel = (selector: string) => {
  const el = document.querySelector(selector);
  expect(el, `${selector} is missing`).not.toBeNull();
  return el as HTMLElement;
};
const counterUrl = () =>
  within(panel('.panel-counter-output')).getByLabelText('Generated viewer counter URL')
    .textContent ?? '';
const livePreviewUrl = () =>
  document.querySelector('[data-testid="counter-live-preview"]')
    ?.getAttribute('data-overlay-url') ?? '';
const settle = () => act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 10));
const typeChannel = (platform: string, value: string) =>
  fireEvent.change(document.getElementById(`channel-${platform}`)!, {
    target: { value },
  });

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('descriptor boundary', () => {
  it('declares no runtime or URL context', () => {
    expect(counterTool.runtime).toBeUndefined();
    expect(counterTool.context).toBeUndefined();
  });

  it('has twelve visible settings plus the hidden custom-font mirror', () => {
    expect(COUNTER_CATALOG).toHaveLength(13);
    expect(COUNTER_CATALOG.filter((setting) => !setting.hidden)).toHaveLength(12);
    for (const setting of COUNTER_CATALOG) {
      expect(setting.disabled).toBeUndefined();
      expect(String(setting.key)).not.toMatch(/pin/i);
    }
  });
});

describe('rendered counter panels', () => {
  it('contain no Twitch connection surface', () => {
    mount();
    for (const region of ['.panel-counter-output', '.panel-counter-settings']) {
      const scope = within(panel(region));
      expect(scope.queryByText(/^Connect$/)).toBeNull();
      expect(scope.queryByText(/^Disconnect$/)).toBeNull();
      expect(scope.queryByText('Use connected channel')).toBeNull();
      expect(panel(region).querySelector('.classic-conn')).toBeNull();
    }
  });

  it('renders every counter catalog setting exactly once', () => {
    mount();
    const settings = panel('.panel-counter-settings');
    expect(settings.querySelectorAll('.classic-field')).toHaveLength(12);
    for (const setting of COUNTER_CATALOG) {
      expect(settings.querySelector(`#vc-${String(setting.key)}`)).not.toBeNull();
    }
  });
});

describe('URL identity with the counter serializer', () => {
  it('matches for defaults with one channel', () => {
    mount();
    typeChannel('twitch', 'somechannel');
    expect(counterUrl()).toBe(expectedUrl({ twitch: 'somechannel' }));
  });

  it('matches for all four channels in serializer order', () => {
    mount();
    for (const [platform, value] of [
      ['twitch', 'a'],
      ['youtube', 'b'],
      ['kick', 'c'],
      ['tiktok', 'd'],
    ] as const) {
      typeChannel(platform, value);
    }
    expect(counterUrl()).toBe(
      expectedUrl({ twitch: 'a', youtube: 'b', kick: 'c', tiktok: 'd' }),
    );
  });

  it('matches after a counter setting changes', () => {
    mount();
    typeChannel('twitch', 'somechannel');
    fireEvent.click(document.getElementById('vc-combined')!);
    expect(counterUrl()).toBe(
      expectedUrl({ twitch: 'somechannel' }, { ...DEFAULT_STYLE, combined: false }),
    );
  });

  it('serializes a custom Google font only into the counter URL', () => {
    mount();
    typeChannel('twitch', 'somechannel');
    fireEvent.change(document.getElementById('vc-font')!, {
      target: { value: 'Press Start 2P' },
    });
    fireEvent.click(within(panel('.panel-counter-settings')).getByRole(
      'option',
      { name: 'Press Start 2P' },
    ));
    expect(counterUrl()).toContain('font=google%3APress+Start+2P');
  });

  it('keeps counter Typography changes out of the chat URL', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const before = within(panel('.panel-chat-output'))
      .getByLabelText('Generated MultiChat overlay URL').textContent;
    fireEvent.change(document.getElementById('vc-fontWeight')!, {
      target: { value: '500' },
    });
    fireEvent.click(document.getElementById('vc-textTransform-uppercase')!);
    fireEvent.click(document.getElementById('vc-fontItalic')!);
    expect(within(panel('.panel-chat-output'))
      .getByLabelText('Generated MultiChat overlay URL').textContent).toBe(before);
    expect(counterUrl()).toContain('counterFontWeight=500');
    expect(counterUrl()).toContain('counterTextTransform=uppercase');
    expect(counterUrl()).toContain('counterFontItalic=true');
  });

  it('uses the current background-off and large-shadow defaults', () => {
    mount();
    typeChannel('kick', 'somechannel');
    expect(counterUrl()).toContain('bg=false');
    expect(counterUrl()).toContain('textShadow=large');
  });

  it('never carries a fragment or any pin parameter', () => {
    mount();
    typeChannel('twitch', 'somechannel');
    expect(counterUrl()).not.toContain('#');
    expect(counterUrl()).not.toMatch(/pin/i);
  });

  it('is unaffected by chat-only styling', () => {
    mount();
    typeChannel('kick', 'somechannel');
    const before = counterUrl();
    fireEvent.click(document.getElementById('mc-showCommunityBadges')!);
    fireEvent.click(document.getElementById('mc-msgBold')!);
    expect(counterUrl()).toBe(before);
  });

  it('hands the exact displayed URL to the native live preview', () => {
    mount();
    typeChannel('twitch', 'somechannel');
    settle();
    expect(livePreviewUrl()).toBe(counterUrl());
    expect(document.querySelector('iframe[src*="/counter"]')).toBeNull();
  });
});

describe('no pin polling', () => {
  const pinCalls = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/twitch/pins'));

  it('issues no Twitch pin request across the generator lifecycle', () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { unmount } = mount();
    typeChannel('twitch', 'somechannel');
    settle();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(pinCalls(fetchSpy)).toEqual([]);

    unmount();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(pinCalls(fetchSpy)).toEqual([]);
  });
});
