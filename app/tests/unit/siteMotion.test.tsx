// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ClassicCollapsibleSection from '@/components/classic/ClassicCollapsibleSection';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { GENERATOR_MOTION_CSS, MOTION_BASE_CSS } from '@/components/site/motion';
import { MULTICHAT_OBS_RECOMMENDED } from '@/features/multichat/obs';
import { counterTool } from '@/features/counter/config';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/workspace/LiveCounterPreview', () => ({ default: () => <div /> }));

function Section({ collapsed }: { collapsed: boolean }) {
  return (
    <ClassicCollapsibleSection sectionId="chat-text" title="Text" collapsed={collapsed} onToggle={() => {}}>
      <p>Body</p>
    </ClassicCollapsibleSection>
  );
}

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

describe('collapsible motion', () => {
  it('without the Web Animations API, hides and shows instantly as before', () => {
    const { rerender } = render(<Section collapsed={false} />);
    const body = document.getElementById('chat-text-body')!;
    expect(body.hidden).toBe(false);
    rerender(<Section collapsed />);
    expect(body.hidden).toBe(true);
    rerender(<Section collapsed={false} />);
    expect(body.hidden).toBe(false);
  });

  it('animates the collapse, then hides the region when the animation ends', () => {
    const animations: { onfinish: (() => void) | null; oncancel: (() => void) | null; cancel: () => void }[] = [];
    HTMLElement.prototype.animate = vi.fn(() => {
      const animation = { onfinish: null, oncancel: null, cancel: vi.fn() };
      animations.push(animation);
      return animation as unknown as Animation;
    });
    const { rerender } = render(<Section collapsed={false} />);
    const body = document.getElementById('chat-text-body')!;
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();

    rerender(<Section collapsed />);
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(1);
    expect(body.hidden).toBe(false);
    expect(body.inert).toBe(true);
    act(() => animations[0]!.onfinish!());
    expect(body.hidden).toBe(true);
    expect(body.inert).toBe(false);

    rerender(<Section collapsed={false} />);
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(2);
    expect(body.hidden).toBe(false);
  });
});

describe('collapsible motion in a background tab', () => {
  it('finishes a paused collapse so the region never stays half-open', () => {
    vi.useFakeTimers();
    try {
      const animation = {
        onfinish: null as (() => void) | null,
        oncancel: null as (() => void) | null,
        playState: 'running',
        cancel: vi.fn(),
        finish: vi.fn(() => { animation.playState = 'finished'; animation.onfinish?.(); }),
      };
      HTMLElement.prototype.animate = vi.fn(() => animation as unknown as Animation);
      const { rerender } = render(<Section collapsed={false} />);
      const body = document.getElementById('chat-text-body')!;
      rerender(<Section collapsed />);
      expect(body.hidden).toBe(false);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(animation.finish).toHaveBeenCalled();
      expect(body.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('motion styles', () => {
  it('honour reduced motion', () => {
    expect(GENERATOR_MOTION_CSS).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(GENERATOR_MOTION_CSS).toContain(MOTION_BASE_CSS);
    /* Every animation and press effect lives inside the no-preference block. */
    const outside = GENERATOR_MOTION_CSS.replace(MOTION_BASE_CSS, '').split('@media (prefers-reduced-motion: no-preference)')[0];
    expect(outside).not.toMatch(/animation:|:active/);
  });

  it('entrance animations leave no transform behind (dropdowns stay on top)', () => {
    expect(GENERATOR_MOTION_CSS).not.toMatch(/animation:[^;]*\bboth\b/);
    expect(GENERATOR_MOTION_CSS).not.toMatch(/animation:[^;]*\bforwards\b/);
  });
});

describe('OBS setup', () => {
  it('shows one card per browser source with its size and a copy button', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ClassicGenerator />);
    const obs = within(document.getElementById('obs-setup')!);
    const chat = within(obs.getByRole('article', { name: 'FlossChat' }));
    const counter = within(obs.getByRole('article', { name: 'FlossCounter' }));
    expect(chat.getByText(`${MULTICHAT_OBS_RECOMMENDED.width} × ${MULTICHAT_OBS_RECOMMENDED.height}`, { selector: '.obs-size' })).toBeTruthy();
    expect(counter.getByText(`${counterTool.obs.width} × ${counterTool.obs.height}`, { selector: '.obs-size' })).toBeTruthy();

    fireEvent.click(chat.getByRole('button', { name: 'Copy chat URL' }));
    const chatUrl = document.querySelector('[aria-label="Generated FlossChat overlay URL"]')!.textContent;
    expect(writeText).toHaveBeenLastCalledWith(chatUrl);
    fireEvent.click(counter.getByRole('button', { name: 'Copy counter URL' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('✓ Copied').length).toBeGreaterThan(0);
  });
});
