/* What the Viewer Counter preview is, and what it is not.
 *
 * With no channel it is the production renderer over fixtures. Once a channel
 * is configured it becomes the native live Counter preview after the existing
 * debounce. The native preview receives the exact generated /counter URL as
 * configuration, but it never navigates an iframe to that URL; polling happens
 * in the parent document so content blockers cannot suppress the preview by
 * blocking a nested /counter navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';

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

const mount = () => render(<ClassicGenerator />);

const samples = () =>
  document.querySelector<HTMLElement>('[data-testid="counter-fixture-preview"]');

const livePreview = () =>
  document.querySelector<HTMLElement>('[data-testid="counter-live-preview"]');

const liveUrl = () => livePreview()?.getAttribute('data-overlay-url') ?? '';

const counterUrl = () =>
  document
    .querySelector('.panel-counter-output')!
    .querySelector<HTMLElement>('[aria-label="Generated viewer counter URL"]')
    ?.textContent ?? '';

const settle = (ms = PREVIEW_DEBOUNCE_MS + 10) =>
  act(() => void vi.advanceTimersByTime(ms));

const typeChannel = (platform: string, value: string) =>
  fireEvent.change(document.getElementById(`channel-${platform}`)!, {
    target: { value },
  });

const counterPreviews = () => {
  const panel = document.querySelector('.panel-counter-output')!;
  return [
    ...panel.querySelectorAll('[data-testid="counter-fixture-preview"]'),
    ...panel.querySelectorAll('[data-testid="counter-live-preview"]'),
  ];
};

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('with no channel configured', () => {
  it('shows the sample preview', () => {
    mount();
    expect(samples()).not.toBeNull();
  });

  it('mounts no live preview after the debounce', () => {
    mount();
    settle();
    expect(livePreview()).toBeNull();
  });

  it('keeps the sample count editor and rotation controls available', () => {
    mount();
    expect(document.getElementById('sample-count-twitch')).not.toBeNull();
    expect(document.getElementById('counter-sim-enabled')).not.toBeNull();
  });

  it('marks the samples as preview data', () => {
    mount();
    const panel = document.querySelector('.panel-counter-output')!;
    expect(panel.textContent).toContain('Preview Data');
  });
});

describe('once a channel is configured', () => {
  it('stops showing sample data in the same tick', () => {
    mount();
    typeChannel('twitch', 'silky');
    expect(samples()).toBeNull();
  });

  it('mounts no live preview until the debounce has elapsed', () => {
    mount();
    typeChannel('twitch', 'silky');
    act(() => void vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 20));
    expect(livePreview()).toBeNull();
  });

  it('mounts the native live preview after the debounce', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    expect(livePreview()).not.toBeNull();
  });

  it('hands the native preview exactly the URL Copy and Open use', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    expect(liveUrl()).toBe(counterUrl());
  });

  it('does not navigate a remote Counter iframe', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    expect(
      document.querySelector('iframe[src*="/counter"]'),
    ).toBeNull();
  });

  it('is the only counter preview on screen', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    expect(counterPreviews()).toHaveLength(1);
    expect(samples()).toBeNull();
  });
});

describe('the preview depends on no message from an embedded overlay', () => {
  it('is visible with no message ever received', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    expect(livePreview()).not.toBeNull();
    expect(livePreview()!.closest('[data-live-ready]')).toBeNull();
  });

  it('stays present across an appearance change', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    const first = liveUrl();

    fireEvent.click(document.getElementById('vc-combined')!);
    settle();

    expect(livePreview()).not.toBeNull();
    expect(liveUrl()).toBe(counterUrl());
    expect(liveUrl()).not.toBe(first);
    expect(counterPreviews()).toHaveLength(1);
  });

  it('shows no loading placeholder over the live preview', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    const panel = document.querySelector('.panel-counter-output')!;
    expect(panel.textContent).not.toContain('Loading live');
    expect(panel.querySelector('.preview-loading')).toBeNull();
    expect(panel.querySelector('.preview-swap')).toBeNull();
  });
});

describe('channel changes', () => {
  it('updates the live configuration after the debounce, not every keystroke', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    const first = liveUrl();

    typeChannel('kick', 'cuffem');
    expect(liveUrl()).toBe(first);

    settle();
    expect(liveUrl()).not.toBe(first);
    expect(liveUrl()).toBe(counterUrl());
  });

  it('serves both platforms through one native preview configuration', () => {
    mount();
    typeChannel('twitch', 'silky');
    typeChannel('kick', 'cuffem');
    settle();

    expect(counterPreviews()).toHaveLength(1);
    expect(liveUrl()).toBe(counterUrl());
    expect(liveUrl()).toContain('silky');
    expect(liveUrl()).toContain('cuffem');
  });

  it('removes the live preview immediately when the last channel is cleared', () => {
    mount();
    typeChannel('twitch', 'silky');
    settle();
    expect(livePreview()).not.toBeNull();

    typeChannel('twitch', '');
    expect(livePreview()).toBeNull();
    expect(samples()).not.toBeNull();
  });
});
