import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ClassicBadgeOrderVisibility from '@/components/classic/ClassicBadgeOrderVisibility';
import { MULTICHAT_BADGE_PROVIDERS } from '@/lib/badgeLayout';

function providerOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-badge-provider]'))
    .map((node) => node.getAttribute('data-badge-provider') ?? '');
}

describe('Classic badge order and visibility control', () => {
  it('reflects parent state and resets when the parent value changes', () => {
    const onChange = vi.fn();
    const view = render(
      <ClassicBadgeOrderVisibility value="7tv,!ffz,platform" onChange={onChange} />,
    );

    expect(providerOrder(view.container).slice(0, 3)).toEqual(['7tv', 'ffz', 'platform']);
    expect(screen.getByRole('button', { name: 'Show FFZ badges' }).getAttribute('aria-pressed'))
      .toBe('false');

    view.rerender(<ClassicBadgeOrderVisibility value="" onChange={onChange} />);
    expect(providerOrder(view.container)).toEqual([...MULTICHAT_BADGE_PROVIDERS]);
    expect(screen.getByRole('button', { name: 'Hide FFZ badges' }).getAttribute('aria-pressed'))
      .toBe('true');
  });

  it('emits serialized visibility and order changes through badgeLayout', () => {
    const onChange = vi.fn();
    const view = render(<ClassicBadgeOrderVisibility value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide FFZ badges' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe('badgeLayout');
    expect(String(onChange.mock.calls[0]?.[1])).toContain('!ffz');

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Move UChat right' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const encoded = String(onChange.mock.calls[0]?.[1]);
    expect(encoded.indexOf('chatterino')).toBeLessThan(encoded.indexOf('uchat'));
    expect(providerOrder(view.container)[0]).toBe('platform');
  });
});
