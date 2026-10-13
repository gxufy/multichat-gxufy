/* No generated Counter URL may contain the literal string 'undefined'. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { PREVIEW_DEBOUNCE_MS } from '@/components/workspace/OverlayPreviewFrame';
import { buildViewerCounterQuery } from '@/lib/viewerCounterConfig';

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

const EVIDENCE =
  'kick=iceposeidon&combined=undefined&icons=undefined&bg=undefined' +
  '&textShadow=small&stroke=none&align=undefined';

function expectNoUndefined(url: string, label: string) {
  expect(url, `${label}: =undefined`).not.toContain('=undefined');
  expect(url, `${label}: undefined&`).not.toContain('undefined&');
  expect(url, `${label}: ?undefined`).not.toContain('?undefined');
  expect(url, `${label}: bare word`).not.toContain('undefined');
}

const mount = () => render(<ClassicGenerator />);
const counterPanel = () => {
  const panel = document.querySelector('.panel-counter-output');
  expect(panel, 'counter output panel is missing').not.toBeNull();
  return within(panel as HTMLElement);
};
const counterUrl = () =>
  counterPanel().getByLabelText('Generated viewer counter URL').textContent ?? '';
const counterLiveUrl = () =>
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
});

describe('historical reproduction', () => {
  it('reproduces the old undefined string from the former direct String() path', () => {
    const params = new URLSearchParams({ kick: 'iceposeidon' });
    const partial: Record<string, unknown> = {
      textShadow: 'small',
      stroke: 'none',
    };
    params.set('combined', String(partial.combined));
    params.set('icons', String(partial.icons));
    params.set('bg', String(partial.bg));
    params.set('textShadow', partial.textShadow as string);
    params.set('stroke', partial.stroke as string);
    params.set('align', String(partial.align));
    expect(params.toString()).toBe(EVIDENCE);
  });

  it('normalizes a partial style before serialization', () => {
    const produced = buildViewerCounterQuery(
      { kick: 'iceposeidon' },
      { textShadow: 'small', stroke: 'none' },
    );
    expect(produced).not.toBe(EVIDENCE);
    expectNoUndefined(produced, 'serializer with partial style');
    expect(produced).toContain('combined=true');
    expect(produced).toContain('icons=true');
    expect(produced).toContain('bg=false');
    /* Explicit valid partial values remain explicit. */
    expect(produced).toContain('textShadow=small');
  });

  it('an entirely empty style receives all current defaults', () => {
    expect(buildViewerCounterQuery({ kick: 'iceposeidon' }, {})).toBe(
      'kick=iceposeidon&combined=true&icons=true&bg=false&textShadow=large&stroke=none',
    );
  });
});

describe('Classic counter URL lifecycle', () => {
  it('is clean before and after entering a channel', () => {
    mount();
    expectNoUndefined(counterUrl(), 'initial');
    typeChannel('kick', 'iceposeidon');
    expectNoUndefined(counterUrl(), 'configured');
    expect(counterUrl()).toContain('kick=iceposeidon');
  });

  it('stays clean at every keystroke', () => {
    mount();
    const name = 'iceposeidon';
    for (let i = 1; i <= name.length; i++) {
      typeChannel('kick', name.slice(0, i));
      expectNoUndefined(counterUrl(), `keystroke ${i}`);
    }
  });

  it('passes the same clean URL to the native preview after debounce', () => {
    mount();
    typeChannel('kick', 'iceposeidon');
    settle();
    expectNoUndefined(counterLiveUrl(), 'native preview');
    expect(counterLiveUrl()).toBe(counterUrl());
    expect(document.querySelector('iframe[src*="/counter"]')).toBeNull();
  });

  it('stays clean while every counter control is changed', () => {
    mount();
    typeChannel('kick', 'iceposeidon');
    const settings = document.querySelector('.panel-counter-settings') as HTMLElement;

    for (const el of Array.from(
      settings.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )) {
      fireEvent.click(el);
      expectNoUndefined(counterUrl(), `toggle ${el.id}`);
    }
    for (const radio of Array.from(
      settings.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    )) {
      fireEvent.click(radio);
      expectNoUndefined(counterUrl(), `radio ${radio.id}`);
    }
  });
});

describe('Copy and Open', () => {
  it('copies the exact clean URL', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mount();
    typeChannel('kick', 'iceposeidon');
    fireEvent.click(counterPanel().getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(counterUrl());
    expectNoUndefined(writeText.mock.calls[0][0] as string, 'clipboard');
  });

  it('opens the exact clean URL', () => {
    mount();
    typeChannel('kick', 'iceposeidon');
    const href = counterPanel().getByRole('link', { name: 'Open' }).getAttribute('href') ?? '';
    expect(href).toBe(counterUrl());
    expectNoUndefined(href, 'Open href');
  });
});
