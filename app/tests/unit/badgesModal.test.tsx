// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => function BadgesDashboardStub(props: { variant?: string; signInNext?: string }) {
    return <p data-variant={props.variant} data-next={props.signInNext}>badges panel</p>;
  },
}));

import ClassicSectionNav from '@/components/classic/ClassicSectionNav';
import BadgesModal, { BADGES_POPUP_RETURN } from '@/components/badges/BadgesModal';
import { signInHref } from '@/components/badges/BadgesDashboard';
import { safeNextPath } from '@/lib/server/session';

afterEach(() => {
  cleanup();
});

describe('Badges in the generator section bar', () => {
  it('shows a Badges button beside Support only when given a handler', () => {
    const { unmount } = render(<ClassicSectionNav onSupport={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Badges' })).toBeNull();
    unmount();
    const onBadges = vi.fn();
    render(<ClassicSectionNav onSupport={() => {}} onBadges={onBadges} />);
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Badges', 'Support']);
    fireEvent.click(screen.getByRole('button', { name: 'Badges' }));
    expect(onBadges).toHaveBeenCalledTimes(1);
  });
});

describe('badges popup', () => {
  it('opens the badges panel in popup mode, returning to the generator after sign-in', () => {
    const onClose = vi.fn();
    render(<BadgesModal open onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Your FlossChat badges' }).getAttribute('aria-modal')).toBe('true');
    const panel = screen.getByText('badges panel');
    expect(panel.getAttribute('data-variant')).toBe('modal');
    expect(panel.getAttribute('data-next')).toBe('/multichat?badges=1');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the return path survives the server\'s same-site check', () => {
    expect(safeNextPath(BADGES_POPUP_RETURN)).toBe('/multichat?badges=1');
    expect(signInHref(BADGES_POPUP_RETURN)).toBe('/api/auth/twitch/login?next=%2Fmultichat%3Fbadges%3D1');
  });
});
