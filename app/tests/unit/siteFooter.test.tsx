// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SiteFooter from '@/components/site/SiteFooter';

describe('shared site footer', () => {
  it('has only the Follow button and the GitHub source', () => {
    render(<SiteFooter />);
    const links = within(screen.getByRole('navigation', { name: 'Gxufy' })).getAllByRole('link');
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Follow @gxufy', 'https://guns.lol/gxufy'],
      ['Source', 'https://github.com/gxufy/multichat-gxufy'],
    ]);
    expect(links[1]!.querySelector('svg')).not.toBeNull();
    expect(document.querySelectorAll('footer a')).toHaveLength(2);
  });

  it('shows page notices', () => {
    render(<SiteFooter><p>Page notice</p></SiteFooter>);
    expect(document.querySelector('footer')!.textContent).toContain('Page notice');
  });

  it('opens external links in a new tab without an opener', () => {
    render(<SiteFooter />);
    for (const link of document.querySelectorAll('footer a[href^="https://"]')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });
});
