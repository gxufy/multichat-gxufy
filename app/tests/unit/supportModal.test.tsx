// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => function SupportCheckoutStub(props: { variant?: string }) {
    return <p data-variant={props.variant}>checkout</p>;
  },
}));

import ClassicSectionNav from '@/components/classic/ClassicSectionNav';
import SupportModal from '@/components/support/SupportModal';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Support in the MultiChat section bar', () => {
  it('shows a Support button only when given a handler', () => {
    const { unmount } = render(<ClassicSectionNav />);
    expect(screen.queryByRole('button', { name: 'Support' })).toBeNull();
    unmount();
    const onSupport = vi.fn();
    render(<ClassicSectionNav onSupport={onSupport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Support' }));
    expect(onSupport).toHaveBeenCalledTimes(1);
  });
});

describe('support popup', () => {
  it('opens as a modal dialog with the checkout, locks page scroll, and closes on Esc', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(<SupportModal open checkoutReady onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Support Gxufy' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('checkout').getAttribute('data-variant')).toBe('modal');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SupportModal open={false} checkoutReady onClose={onClose} />);
    expect(document.querySelector('.support-modal')?.getAttribute('data-state')).toBe('closing');
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes from the close button and from a click outside', () => {
    const onClose = vi.fn();
    render(<SupportModal open checkoutReady={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.mouseDown(document.querySelector('.support-modal-frame')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
