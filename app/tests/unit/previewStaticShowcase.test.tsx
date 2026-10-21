import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { CHAT_INTERVAL_MAX_MS } from '@/features/multichat/previewSimulator';
import { PREVIEW_ROSTER } from '@/features/multichat/previewRoster';
import { __resetPreviewIdentityClient } from '@/features/multichat/previewIdentityClient';

vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const preview = () => document.querySelector<HTMLIFrameElement>('iframe[title="MultiChat sample preview"]')!.contentDocument!.body;
const bodies = () => Array.from(preview().querySelectorAll('#chat_container .ck-body')).map((el) => el.textContent ?? '');
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const waitForGrowth = (from: number) => {
  let elapsed = 0;
  while (elapsed < CHAT_INTERVAL_MAX_MS * 2 && bodies().length <= from) {
    wait(250);
    elapsed += 250;
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  __resetPreviewIdentityClient();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the curated moving Preview Data showcase', () => {
  it('renders the exact fallback identities on first paint', () => {
    render(<ClassicGenerator />);
    expect(bodies()).toHaveLength(PREVIEW_ROSTER.length);
    for (const entry of PREVIEW_ROSTER) expect(preview().textContent ?? '').toContain(entry.displayName);
  });

  it('moves at Fast speed without a control click', () => {
    render(<ClassicGenerator />);
    waitForGrowth(PREVIEW_ROSTER.length);
    expect(bodies().length).toBeGreaterThan(PREVIEW_ROSTER.length);
  });

  it('keeps moving while the retired utility buttons stay removed', () => {
    render(<ClassicGenerator />);
    waitForGrowth(PREVIEW_ROSTER.length);
    const delivered = bodies().length;
    waitForGrowth(delivered);
    expect(bodies().length).toBeGreaterThan(delivered);
    expect(screen.queryByRole('button', { name: 'LOAD MORE BADGES' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'RESET PREVIEW' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PAUSE' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'RESET FEED' })).toBeNull();
  });
});
