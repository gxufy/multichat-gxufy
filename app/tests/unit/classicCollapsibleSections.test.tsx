import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import ClassicCollapsibleSection, {
  CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY,
  browserLocalStorage,
  defaultCollapsedSections,
  readCollapsedSections,
  writeCollapsedSections,
  type ClassicCollapsibleSectionId,
} from '@/components/classic/ClassicCollapsibleSection';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function SectionHarness() {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = (_sectionId: ClassicCollapsibleSectionId) => {
    setCollapsed((current) => !current);
  };
  return (
    <ClassicCollapsibleSection
      sectionId="chat-messages"
      title="Messages"
      collapsed={collapsed}
      onToggle={toggle}
    >
      <label htmlFor="test-value">Value</label>
      <input id="test-value" defaultValue="preserved" />
    </ClassicCollapsibleSection>
  );
}

function panel(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  expect(element, `${selector} is missing`).not.toBeNull();
  return element as HTMLElement;
}

function chatUrl(): string {
  return within(panel('.panel-chat-output'))
    .getByLabelText('Generated MultiChat overlay URL').textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassicCollapsibleSection accessibility and state', () => {
  it('uses an accessible native button and hides only the mounted body', () => {
    render(<SectionHarness />);
    const toggle = screen.getByRole('button', { name: 'Messages' });
    const input = screen.getByLabelText('Value') as HTMLInputElement;

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('chat-messages-body');
    expect(screen.getByRole('region', { name: 'Messages' })).not.toBeNull();
    expect(input.value).toBe('preserved');

    fireEvent.click(toggle, { detail: 0 });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('chat-messages-body')?.hidden).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Value' })).toBeNull();
    expect(document.getElementById('test-value')).toBe(input);

    fireEvent.click(toggle, { detail: 0 });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Value')).toBe(input);
    expect(input.value).toBe('preserved');
  });
});

describe('collapsed-section preference validation', () => {
  it('defaults Extras open while Filters and Commands & help remain collapsed', () => {
    expect([...defaultCollapsedSections()]).toEqual([
      'chat-filters', 'chat-commands',
    ]);
    expect([...readCollapsedSections(null)])
      .toEqual(['chat-filters', 'chat-commands']);
  });

  it('fails safely for malformed or unavailable storage', () => {
    const malformed = { getItem: () => '{broken' };
    const unavailable = { getItem: () => { throw new DOMException('blocked'); } };
    const blockedWrite = { setItem: () => { throw new DOMException('blocked'); } };

    expect([...readCollapsedSections(malformed)])
      .toEqual(['chat-filters', 'chat-commands']);
    expect([...readCollapsedSections(unavailable)])
      .toEqual(['chat-filters', 'chat-commands']);
    expect(() => writeCollapsedSections(
      blockedWrite,
      new Set<ClassicCollapsibleSectionId>(['chat-text']),
    )).not.toThrow();
  });

  it('survives browsers that deny access to localStorage itself', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(browserLocalStorage()).toBeNull();
    expect(() => render(<ClassicGenerator />)).not.toThrow();
    getter.mockRestore();
  });

  it('ignores unknown ids and persists only known collapsed ids', () => {
    const stored = JSON.stringify(['unknown-section', 'chat-text', 'counter-layout']);
    const collapsed = readCollapsedSections({ getItem: () => stored });
    expect([...collapsed]).toEqual(['chat-text', 'counter-layout']);

    const setItem = vi.fn();
    writeCollapsedSections(
      { setItem },
      new Set(['chat-text', 'unknown-section'] as ClassicCollapsibleSectionId[]),
    );
    expect(setItem).toHaveBeenCalledWith(
      CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(['chat-text']),
    );
  });
});

describe('ClassicGenerator collapsed settings integration', () => {
  it('starts frequent groups and Extras open while Filters and Commands stay collapsed', () => {
    render(<ClassicGenerator />);

    for (const title of [
      'Text',
      'Appearance',
      'Emotes & Badges',
      'Messages',
      'Events',
      'Extras',
      'Typography',
      'Layout',
      'Display',
    ]) {
      expect(screen.getByRole('button', { name: title }).getAttribute('aria-expanded'))
        .toBe('true');
    }
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded'))
      .toBe('false');
    expect(screen.getByRole('button', { name: 'Commands & help' }).getAttribute('aria-expanded'))
      .toBe('false');
    expect(document.getElementById('channel-kick')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Your channels' })).toBeNull();
  });

  it('preserves settings and generated URLs across collapse and expand', () => {
    render(<ClassicGenerator />);
    const kick = document.getElementById('channel-kick') as HTMLInputElement;
    fireEvent.change(kick, { target: { value: 'gxufy' } });
    const bold = document.getElementById('mc-msgBold') as HTMLInputElement;
    fireEvent.click(bold);
    expect(screen.getByRole('button', { name: 'Messages' }).getAttribute('aria-expanded'))
      .toBe('true');
    const urlBeforeCollapse = chatUrl();
    const messages = screen.getByRole('button', { name: 'Messages' });

    fireEvent.click(messages);
    expect(bold.checked).toBe(false);
    expect(chatUrl()).toBe(urlBeforeCollapse);
    fireEvent.click(messages);
    expect((document.getElementById('mc-msgBold') as HTMLInputElement)).toBe(bold);
    expect(bold.checked).toBe(false);
    expect(chatUrl()).toBe(urlBeforeCollapse);
  });

  it('persists layout on remount and ignores unknown stored ids', () => {
    window.localStorage.setItem(
      CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(['chat-text', 'unknown-section']),
    );
    const first = render(<ClassicGenerator />);
    expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-expanded'))
      .toBe('false');
    expect(screen.getByRole('button', { name: 'Extras' }).getAttribute('aria-expanded'))
      .toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commands & help' }));
    expect(JSON.parse(
      window.localStorage.getItem(CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY) ?? '[]',
    )).toEqual(['chat-text', 'chat-events', 'chat-commands']);

    first.unmount();
    render(<ClassicGenerator />);
    expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-expanded'))
      .toBe('false');
    expect(screen.getByRole('button', { name: 'Events' }).getAttribute('aria-expanded'))
      .toBe('false');
    expect(screen.getByRole('button', { name: 'Commands & help' }).getAttribute('aria-expanded'))
      .toBe('false');
  });

  it('ignores a stale closed Advanced preference and persists a new Extras choice', () => {
    window.localStorage.setItem(
      CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(['chat-advanced']),
    );
    render(<ClassicGenerator />);
    const extras = screen.getByRole('button', { name: 'Extras' });
    expect(extras.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('mc-sharedChatEnabled')).not.toBeNull();

    fireEvent.click(extras);
    expect(extras.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(
      window.localStorage.getItem(CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY) ?? '[]',
    )).toEqual(['chat-extras']);
  });

  it('lets an existing persisted open preference override the collapsed default', () => {
    window.localStorage.setItem(CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY, '[]');
    render(<ClassicGenerator />);
    expect(screen.getByRole('button', { name: 'Commands & help' }).getAttribute('aria-expanded'))
      .toBe('true');
  });

  it('keeps layout preferences independent from settings reset and URLs', () => {
    render(<ClassicGenerator />);
    const initialUrl = chatUrl();
    const text = screen.getByRole('button', { name: 'Text' });
    const commands = screen.getByRole('button', { name: 'Commands & help' });
    fireEvent.click(text);
    fireEvent.click(commands);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Chat Settings to Default' }));

    expect(text.getAttribute('aria-expanded')).toBe('false');
    expect(commands.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('chat-commands-body')?.hidden).toBe(false);
    expect(chatUrl()).toBe(initialUrl);
    expect(JSON.parse(
      window.localStorage.getItem(CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY) ?? '[]',
    )).toEqual(['chat-text', 'chat-filters']);
  });
});
