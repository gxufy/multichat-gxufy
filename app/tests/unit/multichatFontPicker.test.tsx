import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MultichatFontPicker, {
  MULTICHAT_RECENT_FONTS_LIMIT,
  MULTICHAT_RECENT_FONTS_STORAGE_KEY,
  buildMultichatFontCatalog,
  filterGoogleFontFamilies,
  type MultichatFontSelection,
} from '@/components/classic/MultichatFontPicker';
import { GOOGLE_FONT_FAMILIES } from '@/lib/googleFontFamilies';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';
import type { SettingOption } from '@/lib/tools/settingTypes';

const OPTIONS: readonly SettingOption[] = [
  { value: 'alp', label: 'Alp' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'alpine', label: 'Alpine' },
  { value: 'baloo', label: 'Baloo Tammudu 2' },
  { value: 'calp', label: 'Calp' },
  { value: 'comfortaa', label: 'Comfortaa' },
  { value: 'dancing', label: 'Dancing Script' },
  { value: 'geist', label: 'Geist' },
  { value: 'impact', label: 'Impact' },
  { value: 'lato', label: 'Lato' },
  { value: 'noto', label: 'Noto Sans JP' },
  { value: 'opensans', label: 'Open Sans' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'scalpel', label: 'Scalpel' },
  { value: 'segoe', label: 'Segoe UI' },
];

function Harness({
  options = OPTIONS,
  initial = { font: 'opensans', googleFont: '' },
}: {
  options?: readonly SettingOption[];
  initial?: MultichatFontSelection;
}) {
  const [selection, setSelection] = useState(initial);
  return (
    <>
      <MultichatFontPicker
        id="mc-font"
        customInputId="mc-googleFont"
        showCustomInput
        label="Font"
        description="Search presets or enter a Google Font family."
        options={options}
        presetFont={selection.font}
        customFont={selection.googleFont}
        fontFamilies={{}}
        onChange={setSelection}
      />
      <output aria-label="Selected font">
        {selection.font}|{selection.googleFont}
      </output>
    </>
  );
}

function input(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Font' }) as HTMLInputElement;
}

function customInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Custom Google Font' }) as HTMLInputElement;
}

function storedRecent(): string[] {
  return JSON.parse(
    window.localStorage.getItem(MULTICHAT_RECENT_FONTS_STORAGE_KEY) ?? '[]',
  ) as string[];
}

function selectByMouse(label: string): void {
  fireEvent.change(input(), { target: { value: label } });
  fireEvent.click(screen.getByRole('option', { name: label }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MultichatFontPicker search', () => {
  it('opens the complete catalog on focus and highlights the current font', () => {
    render(<Harness />);
    expect(document.getElementById('mc-font-description')?.className).toBe('sr-only');
    expect(document.querySelector('.typography-help')).toBeNull();
    fireEvent.focus(input());

    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(
      buildMultichatFontCatalog(OPTIONS).length,
    );
    expect(screen.getAllByRole('option').length).toBeGreaterThan(130);
    expect(screen.getByRole('option', { name: 'Acme' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Black Ops One' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Unbounded' })).not.toBeNull();
    expect(screen.getByRole('option', { name: /Open Sans/ }).getAttribute('aria-selected'))
      .toBe('true');
    expect(screen.getAllByRole('option')[0].textContent).toContain('Open Sans');
  });

  it('uses the exact 135-family static Google catalog', () => {
    expect(GOOGLE_FONT_FAMILIES).toHaveLength(135);
    expect(GOOGLE_FONT_FAMILIES.slice(0, 5)).toEqual([
      'ABeeZee',
      'Acme',
      'Alegreya',
      'Alegreya Sans',
      'Alfa Slab One',
    ]);
    expect(GOOGLE_FONT_FAMILIES.slice(-5)).toEqual([
      'Varela Round',
      'Vollkorn',
      'Work Sans',
      'Yanone Kaffeesatz',
      'Zilla Slab',
    ]);

    const fontSetting = MULTICHAT_CATALOG.find(({ key }) => key === 'font');
    if (!fontSetting || fontSetting.type !== 'select') {
      throw new Error('MultiChat font setting is missing');
    }
    /* 135 Google font families plus Baloo Tammudu, Segoe UI, Impact, Alsina,
       and Geist. Shared family names retain their GXUFY preset tokens. */
    expect(buildMultichatFontCatalog(fontSetting.options)).toHaveLength(140);
  });

  it('filters case-insensitively by exact, starts-with, contains, then alphabetically', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'ALP' } });

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Alp',
      'Alpha',
      'Alpine',
      'Calp',
      'Scalpel',
    ]);
  });

  it('shows a stable no-result state for an unsafe unmatched value', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'Bad/Font' } });

    const listbox = screen.getByRole('listbox', { name: 'Font options' });
    expect(within(listbox).queryAllByRole('option')).toHaveLength(0);
    expect(within(listbox).getByText('No matching fonts')).not.toBeNull();
  });

  it('ranks Google family metadata by exact, starts-with, contains, then alphabetically', () => {
    expect(filterGoogleFontFamilies(
      ['Beta Sans', 'Sans Serif', 'Alpha Sans', 'Sans'],
      'sAnS',
    )).toEqual(['Sans', 'Sans Serif', 'Alpha Sans', 'Beta Sans']);
  });

  it('finds partial Google family names case-insensitively', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'mOnT' } });

    expect(screen.getByRole('option', { name: 'Montserrat' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Montserrat Alternates' })).not.toBeNull();
  });

  it('suppresses a Google duplicate when the family is already a preset', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'roboto' } });

    expect(screen.getAllByRole('option', { name: 'Roboto' })).toHaveLength(1);
  });

  it('does not request fonts or make network calls while opening and searching', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<Harness />);

    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'mont' } });
    expect(screen.getByRole('option', { name: 'Montserrat' })).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('option', { name: 'Montserrat' }));
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|Montserrat');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('MultichatFontPicker selection and keyboard behavior', () => {
  it('selects a preset with the mouse and records it as recent', () => {
    render(<Harness />);
    selectByMouse('Lato');

    expect(screen.getByLabelText('Selected font').textContent).toBe('lato|');
    expect(input().value).toBe('Lato');
    expect(storedRecent()).toEqual(['preset:lato']);
  });

  it('keeps the selected family visible across a parent rerender', () => {
    const view = render(<Harness />);
    selectByMouse('Montserrat');
    expect(input().value).toBe('Montserrat');

    view.rerender(<Harness options={[...OPTIONS]} />);
    expect(input().value).toBe('Montserrat');
    fireEvent.focus(input());
    expect(screen.getAllByRole('option')[0].textContent).toContain('Montserrat');
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('supports ArrowDown, ArrowUp, Enter, and Escape', () => {
    render(<Harness />);

    fireEvent.change(input(), { target: { value: 'alp' } });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('data-active'))
      .toBe('true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByLabelText('Selected font').textContent).toBe('alpha|');

    fireEvent.change(input(), { target: { value: 'alp' } });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: 'Scalpel' }).getAttribute('data-active'))
      .toBe('true');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input().value).toBe('Alpha');
  });

  it('closes when the user clicks outside', () => {
    render(<Harness />);
    fireEvent.focus(input());
    expect(screen.getByRole('listbox')).not.toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays open for wheel, scrollbar track, and thumb-drag interactions', () => {
    render(<Harness />);
    fireEvent.focus(input());
    const listbox = screen.getByRole('listbox');

    fireEvent.wheel(listbox, { deltaY: 120 });
    expect(screen.getByRole('listbox')).not.toBeNull();
    fireEvent.scroll(listbox, { target: { scrollTop: 120 } });
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|');

    /* A track click is an internal pointer interaction. */
    fireEvent.pointerDown(listbox, { clientX: 425, clientY: 180 });
    fireEvent.pointerUp(listbox, { clientX: 425, clientY: 180 });
    expect(screen.getByRole('listbox')).not.toBeNull();

    /* Native scrollbar blur can have no relatedTarget. The listbox is inside the
       outside-pointer boundary, and release outside is not a new outside press. */
    fireEvent.pointerDown(listbox, { clientX: 425, clientY: 30 });
    fireEvent.mouseDown(listbox);
    fireEvent.pointerMove(document.body, { clientX: 425, clientY: 500 });
    fireEvent.pointerUp(document);
    fireEvent.mouseUp(document);
    fireEvent.blur(input(), { relatedTarget: null });
    expect(screen.getByRole('listbox')).not.toBeNull();
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1].getAttribute('data-active')).toBe('true');

    fireEvent.click(screen.getByRole('option', { name: 'Acme' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|Acme');
  });
});

describe('MultichatFontPicker recent fonts', () => {
  it('keeps five most-recent fonts, newest first, and moves an existing font up', () => {
    render(<Harness />);
    for (const font of ['Alp', 'Baloo Tammudu 2', 'Comfortaa', 'Geist', 'Impact', 'Lato']) {
      selectByMouse(font);
    }

    expect(storedRecent()).toEqual([
      'preset:lato',
      'preset:impact',
      'preset:geist',
      'preset:comfortaa',
      'preset:baloo',
    ]);
    expect(storedRecent()).toHaveLength(MULTICHAT_RECENT_FONTS_LIMIT);

    selectByMouse('Comfortaa');
    expect(storedRecent()).toEqual([
      'preset:comfortaa',
      'preset:lato',
      'preset:impact',
      'preset:geist',
      'preset:baloo',
    ]);

    fireEvent.focus(input());
    expect(screen.getAllByRole('option').slice(0, 5).map((option) => (
      option.textContent?.replace('Selected', '')
    ))).toEqual(['Comfortaa', 'Lato', 'Impact', 'Geist', 'Baloo Tammudu 2']);
  });

  it('deduplicates custom fonts case-insensitively', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'Press Start 2P' } });
    fireEvent.click(screen.getByRole('option', { name: 'Press Start 2P' }));
    fireEvent.change(input(), { target: { value: 'press start 2p' } });
    fireEvent.click(screen.getByRole('option', { name: /press start 2p/i }));

    expect(storedRecent()).toEqual(['google:Press Start 2P']);
  });

  it('ignores malformed storage and survives storage write failures', () => {
    window.localStorage.setItem(MULTICHAT_RECENT_FONTS_STORAGE_KEY, '{broken');
    render(<Harness />);
    fireEvent.focus(input());
    expect(screen.getAllByRole('option')).toHaveLength(
      buildMultichatFontCatalog(OPTIONS).length,
    );

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => selectByMouse('Lato')).not.toThrow();
    expect(screen.getByLabelText('Selected font').textContent).toBe('lato|');
  });
});

describe('MultichatFontPicker custom Google Fonts', () => {
  it('keeps the override description accessible without visible helper copy', () => {
    render(<Harness />);
    expect(customInput().placeholder).toBe('Press Start 2P');
    expect(customInput().getAttribute('aria-describedby')).toBe('mc-googleFont-description');
    expect(document.getElementById('mc-googleFont-description')?.textContent).toBe(
      'Optional Google Fonts family name. Overrides the preset font above.',
    );
    expect(document.getElementById('mc-googleFont-description')?.className).toBe('sr-only');
    expect(document.querySelector('.typography-help')).toBeNull();
  });

  it('applies and clears the visible custom override without changing the preset', () => {
    render(<Harness />);
    fireEvent.change(customInput(), { target: { value: 'Press Start 2P' } });
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|Press Start 2P');

    fireEvent.change(customInput(), { target: { value: '' } });
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|');
    expect(input().value).toBe('Open Sans');
  });

  it('commits an arbitrary safe custom family and includes it in recent fonts', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'Pixel   Party Font' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(screen.getByLabelText('Selected font').textContent)
      .toBe('opensans|Pixel Party Font');
    expect(input().value).toBe('Pixel Party Font');
    expect(storedRecent()).toEqual(['google:Pixel Party Font']);
  });

  it('selects a Google result with the mouse through the custom-font path', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'Noto Sans' } });

    expect(screen.getByRole('option', { name: 'Noto Sans JP' })).not.toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Noto Sans' }));
    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|Noto Sans');
    expect(storedRecent()).toEqual(['google:Noto Sans']);
  });

  it('selects a Google result with the keyboard and records it as recent', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'mont' } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|Montserrat');
    expect(input().value).toBe('Montserrat');
    expect(storedRecent()).toEqual(['google:Montserrat']);
  });

  it('rejects an unsafe custom family and leaves the selected font unchanged', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "Bad'; color:red" } });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(screen.getByLabelText('Selected font').textContent).toBe('opensans|');
    expect(input().value).toBe('Open Sans');
    expect(storedRecent()).toEqual([]);
  });
});
