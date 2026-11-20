// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ClassicSectionNav, { GENERATOR_SECTIONS, currentSection } from '@/components/classic/ClassicSectionNav';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { COUNTER_SECTION_ID } from '@/lib/multichatRouting';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/workspace/LiveCounterPreview', () => ({ default: () => <div /> }));

describe('generator section bar', () => {
  it('links to each generator section in page order', () => {
    render(<ClassicSectionNav />);
    const nav = screen.getByRole('navigation', { name: 'Generator sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Channels', '#channels'],
      ['Settings', '#settings'],
      ['Commands', '#commands'],
      ['OBS setup', '#obs-setup'],
    ]);
  });

  it('keeps the #viewer-counter deep link working outside the bar', () => {
    expect(GENERATOR_SECTIONS.map((section) => section.id)).not.toContain(COUNTER_SECTION_ID);
    render(<ClassicGenerator />);
    expect(document.getElementById(COUNTER_SECTION_ID)?.tagName).toBe('SECTION');
  });

  it('points Settings at the chat settings panel', () => {
    render(<ClassicGenerator />);
    expect(document.getElementById('settings')?.classList.contains('panel-chat-settings')).toBe(true);
  });

  it('marks the first section current before anything scrolls', () => {
    render(<ClassicSectionNav />);
    expect(screen.getByRole('link', { name: 'Channels' }).getAttribute('aria-current')).toBe('location');
  });

  it('every link has a real section in the generator, and the bar renders once', () => {
    render(<ClassicGenerator />);
    expect(screen.getAllByRole('navigation', { name: 'Generator sections' })).toHaveLength(1);
    for (const section of GENERATOR_SECTIONS) {
      const target = document.getElementById(section.id);
      expect(target?.tagName, section.id).toBe('SECTION');
    }
  });

  describe('current section', () => {
    const ids = ['channels', 'chat', 'viewer-counter', 'commands', 'obs-setup'];
    /* currentSection is generic over ids; these exercise its layout rules. */
    const tops = (map: Record<string, number>) => (id: string) => map[id];

    it('is the lowest section scrolled past the bar', () => {
      expect(currentSection(ids, tops({ channels: -900, chat: -300, 'viewer-counter': -300, commands: 400, 'obs-setup': 1200 }), 900, false)).toBe('chat');
      expect(currentSection(ids, tops({ channels: -2000, chat: -1500, 'viewer-counter': -800, commands: 40, 'obs-setup': 700 }), 900, false)).toBe('commands');
    });

    it('is the first section before anything is scrolled past', () => {
      expect(currentSection(ids, tops({ channels: 200, chat: 700, 'viewer-counter': 700, commands: 2000, 'obs-setup': 2600 }), 900, false)).toBe('channels');
    });

    it('is the last section on screen at the bottom of the page', () => {
      expect(currentSection(ids, tops({ channels: -3000, chat: -2600, 'viewer-counter': -1800, commands: 240, 'obs-setup': 520 }), 900, true)).toBe('obs-setup');
    });
  });
});
