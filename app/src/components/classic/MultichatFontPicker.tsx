import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  customGoogleFontFamily,
  googleFontValue,
  normalizeGoogleFontFamily,
} from '@/lib/overlayFonts';
import { GOOGLE_FONT_FAMILIES } from '@/lib/googleFontFamilies';
import type { SettingOption } from '@/lib/tools/settingTypes';

export const MULTICHAT_RECENT_FONTS_STORAGE_KEY =
  'gxufy:multichat:recent-fonts:v1';
export const MULTICHAT_RECENT_FONTS_LIMIT = 5;

const PRESET_TOKEN_PREFIX = 'preset:';

export type MultichatFontSelection = {
  font: string;
  googleFont: string;
};

type FontChoice = {
  token: string;
  label: string;
  kind: 'preset' | 'google' | 'custom';
  presetValue?: string;
};

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function presetToken(value: string): string {
  return `${PRESET_TOKEN_PREFIX}${value}`;
}

function matchRank(value: string, query: string): number | null {
  if (!query) return 0;
  const normalized = normalizedSearch(value);
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  return normalized.includes(query) ? 2 : null;
}

function optionMatchRank(option: SettingOption, query: string): number | null {
  if (!query) return 0;
  const labelRank = matchRank(option.label, query);
  const valueRank = matchRank(option.value, query);
  if (labelRank === null) return valueRank;
  if (valueRank === null) return labelRank;
  return Math.min(labelRank, valueRank);
}

/** Exact, starts-with, contains, then alphabetical. */
export function filterMultichatFontOptions(
  options: readonly SettingOption[],
  rawQuery: string,
  limit = Number.POSITIVE_INFINITY,
): SettingOption[] {
  const query = normalizedSearch(rawQuery);
  return options
    .map((option) => ({ option, rank: optionMatchRank(option, query) }))
    .filter((entry): entry is { option: SettingOption; rank: number } => (
      entry.rank !== null
    ))
    .sort((a, b) => (
      a.rank - b.rank
      || a.option.label.localeCompare(b.option.label, undefined, { sensitivity: 'base' })
    ))
    .slice(0, Math.max(0, limit))
    .map(({ option }) => option);
}

/** Local family metadata search; this never loads or requests a font. */
export function filterGoogleFontFamilies(
  families: readonly string[],
  rawQuery: string,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const query = normalizedSearch(rawQuery);
  if (!query) return [...families];

  return families
    .map((family) => ({ family, rank: matchRank(family, query) }))
    .filter((entry): entry is { family: string; rank: number } => (
      entry.rank !== null
    ))
    .sort((a, b) => (
      a.rank - b.rank
      || a.family.localeCompare(b.family, undefined, { sensitivity: 'base' })
    ))
    .slice(0, Math.max(0, limit))
    .map(({ family }) => family);
}

function choiceIdentity(choice: FontChoice): string {
  return normalizedSearch(choice.label);
}

function presetChoice(option: SettingOption): FontChoice {
  return {
    token: presetToken(option.value),
    label: option.label,
    kind: 'preset',
    presetValue: option.value,
  };
}

function googleChoice(family: string): FontChoice {
  return {
    token: googleFontValue(family)!,
    label: family,
    kind: 'google',
  };
}

/**
 * The 135-family source order, with duplicate GXUFY presets substituted
 * so selecting Open Sans/Roboto/etc. keeps the legacy `font=` serialization.
 * GXUFY-only local presets follow the shared catalog instead of disappearing.
 */
export function buildMultichatFontCatalog(
  options: readonly SettingOption[],
): FontChoice[] {
  const presetByLabel = new Map(
    options.map((option) => [normalizedSearch(option.label), option]),
  );
  const included = new Set<string>();
  const catalog = GOOGLE_FONT_FAMILIES.map((family) => {
    const identity = normalizedSearch(family);
    included.add(identity);
    const option = presetByLabel.get(identity);
    return option ? presetChoice(option) : googleChoice(family);
  });

  for (const option of options) {
    const identity = normalizedSearch(option.label);
    if (included.has(identity)) continue;
    included.add(identity);
    catalog.push(presetChoice(option));
  }
  return catalog;
}

function choiceFromToken(
  token: string,
  options: readonly SettingOption[],
): FontChoice | null {
  if (token.startsWith(PRESET_TOKEN_PREFIX)) {
    const storedValue = token.slice(PRESET_TOKEN_PREFIX.length);
    const option = options.find(
      ({ value }) => normalizedSearch(value) === normalizedSearch(storedValue),
    );
    return option ? presetChoice(option) : null;
  }

  const family = customGoogleFontFamily(token);
  return family
    ? { token: googleFontValue(family)!, label: family, kind: 'custom' }
    : null;
}

/** Read only safe current preset/custom tokens, bounded and deduplicated. */
export function readRecentMultichatFonts(
  storage: Pick<Storage, 'getItem'> | null,
  options: readonly SettingOption[],
): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(MULTICHAT_RECENT_FONTS_STORAGE_KEY) ?? '[]',
    );
    if (!Array.isArray(parsed)) return [];

    const recent: string[] = [];
    const identities = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== 'string') continue;
      const choice = choiceFromToken(value, options);
      if (!choice) continue;
      const identity = choiceIdentity(choice);
      if (identities.has(identity)) continue;
      identities.add(identity);
      recent.push(choice.token);
      if (recent.length === MULTICHAT_RECENT_FONTS_LIMIT) break;
    }
    return recent;
  } catch {
    return [];
  }
}

/** Most-recent-first insertion with case-insensitive display-name deduplication. */
export function addRecentMultichatFont(
  recentTokens: readonly string[],
  choice: FontChoice,
  options: readonly SettingOption[],
): string[] {
  const identity = choiceIdentity(choice);
  const remaining = recentTokens.filter((token) => {
    const recentChoice = choiceFromToken(token, options);
    return recentChoice && choiceIdentity(recentChoice) !== identity;
  });
  return [choice.token, ...remaining].slice(0, MULTICHAT_RECENT_FONTS_LIMIT);
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeRecentMultichatFonts(tokens: readonly string[]): void {
  try {
    browserLocalStorage()?.setItem(
      MULTICHAT_RECENT_FONTS_STORAGE_KEY,
      JSON.stringify(tokens.slice(0, MULTICHAT_RECENT_FONTS_LIMIT)),
    );
  } catch {
    /* A blocked/full localStorage is a preference failure, not a generator failure. */
  }
}

function deduplicateChoices(choices: readonly FontChoice[]): FontChoice[] {
  const identities = new Set<string>();
  return choices.filter((choice) => {
    const identity = choiceIdentity(choice);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

export default function MultichatFontPicker({
  id,
  customInputId,
  showCustomInput = false,
  label,
  description,
  options,
  presetFont,
  customFont,
  fontFamilies,
  onChange,
}: {
  id: string;
  customInputId: string;
  showCustomInput?: boolean;
  label: string;
  description?: string;
  options: readonly SettingOption[];
  presetFont: string;
  customFont: string;
  fontFamilies: Readonly<Record<string, string>>;
  onChange: (selection: MultichatFontSelection) => void;
}) {
  const selectedChoice = useMemo<FontChoice>(() => {
    const family = normalizeGoogleFontFamily(customFont);
    if (family) {
      return { token: googleFontValue(family)!, label: family, kind: 'custom' };
    }
    const option = options.find(({ value }) => value === presetFont) ?? options[0];
    return option
      ? presetChoice(option)
      : {
          token: presetToken(presetFont),
          label: presetFont,
          kind: 'preset',
          presetValue: presetFont,
        };
  }, [customFont, options, presetFont]);

  const catalog = useMemo(() => buildMultichatFontCatalog(options), [options]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentTokens, setRecentTokens] = useState<string[]>(() => (
    readRecentMultichatFonts(browserLocalStorage(), options)
  ));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const keyboardNavigationRef = useRef(false);

  const descriptionId = description ? `${id}-description` : undefined;
  const listboxId = `${id}-options`;
  const normalizedQuery = normalizedSearch(query);

  const recentChoices = useMemo(() => recentTokens
    .map((token) => choiceFromToken(token, options))
    .filter((choice): choice is FontChoice => choice !== null), [options, recentTokens]);

  const choices = useMemo<FontChoice[]>(() => {
    if (!normalizedQuery) {
      return deduplicateChoices([selectedChoice, ...recentChoices, ...catalog]);
    }

    const matches = catalog
      .map((choice) => ({ choice, rank: matchRank(choice.label, normalizedQuery) }))
      .filter((entry): entry is { choice: FontChoice; rank: number } => (
        entry.rank !== null
      ))
      .sort((a, b) => (
        a.rank - b.rank
        || a.choice.label.localeCompare(
          b.choice.label,
          undefined,
          { sensitivity: 'base' },
        )
      ))
      .map(({ choice }) => choice);

    if (matches.length) return matches;
    const family = normalizeGoogleFontFamily(query);
    return family
      ? [{ token: googleFontValue(family)!, label: family, kind: 'custom' }]
      : [];
  }, [catalog, normalizedQuery, query, recentChoices, selectedChoice]);

  useEffect(() => {
    writeRecentMultichatFonts(recentTokens);
  }, [recentTokens]);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        setActiveIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !keyboardNavigationRef.current || activeIndex < 0) return;
    keyboardNavigationRef.current = false;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const rememberChoice = useCallback((choice: FontChoice) => {
    setRecentTokens((current) => addRecentMultichatFont(current, choice, options));
  }, [options]);

  const selectChoice = useCallback((choice: FontChoice) => {
    if (choice.kind === 'preset') {
      onChange({ font: choice.presetValue!, googleFont: '' });
    } else {
      const family = normalizeGoogleFontFamily(choice.label);
      if (!family) return;
      onChange({ font: presetFont, googleFont: family });
    }
    rememberChoice(choice);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }, [onChange, presetFont, rememberChoice]);

  const openMenu = () => {
    setQuery('');
    setOpen(true);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) event.preventDefault();
      setQuery('');
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'Tab') {
      setQuery('');
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      keyboardNavigationRef.current = true;
      if (!open) {
        openMenu();
        return;
      }
      if (!choices.length) return;
      setActiveIndex((current) => {
        if (event.key === 'ArrowDown') {
          return current < choices.length - 1 ? current + 1 : 0;
        }
        return current > 0 ? current - 1 : choices.length - 1;
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const choice = choices[activeIndex] ?? choices[0];
      if (choice) {
        selectChoice(choice);
      } else {
        setQuery('');
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  };

  const selectedFontFamily = selectedChoice.kind === 'preset'
    ? fontFamilies[selectedChoice.presetValue ?? '']
    : undefined;
  const statusText = open
    ? choices.length
      ? `${choices.length} font option${choices.length === 1 ? '' : 's'} available.`
      : 'No matching fonts.'
    : '';

  return (
    <div className="classic-field font-picker-field">
      <label htmlFor={id}>{label}</label>
      {description ? (
        <span id={descriptionId} className="sr-only">{description}</span>
      ) : null}
      <div
        className="font-picker-control"
        ref={rootRef}
      >
        <input
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={
            open && choices[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
          }
          aria-describedby={descriptionId}
          autoComplete="off"
          placeholder={open ? 'Search fonts' : undefined}
          value={open ? query : selectedChoice.label}
          style={!open && selectedFontFamily
            ? { fontFamily: selectedFontFamily }
            : undefined}
          onFocus={() => {
            if (!open) openMenu();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />

        {open ? (
          <div
            id={listboxId}
            className="font-picker-options"
            role="listbox"
            aria-label="Font options"
          >
            {choices.map((choice, index) => {
              const current = choice.token === selectedChoice.token;
              return (
                <button
                  id={`${listboxId}-${index}`}
                  key={choice.token}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  type="button"
                  role="option"
                  aria-selected={current}
                  data-active={activeIndex === index ? 'true' : undefined}
                  data-current={current ? 'true' : undefined}
                  className="font-picker-option"
                  tabIndex={-1}
                  style={choice.kind === 'preset' && choice.presetValue
                    ? { fontFamily: fontFamilies[choice.presetValue] }
                    : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectChoice(choice)}
                >
                  <span>{choice.kind === 'custom' ? `Use “${choice.label}”` : choice.label}</span>
                  {current ? <span className="font-picker-current">Selected</span> : null}
                </button>
              );
            })}

            {!choices.length ? (
              <p className="font-picker-empty">No matching fonts</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {showCustomInput ? (
        <div className="font-picker-custom-field">
          <label htmlFor={customInputId}>Custom Google Font</label>
          <span id={`${customInputId}-description`} className="sr-only">
            Optional Google Fonts family name. Overrides the preset font above.
          </span>
          <input
            id={customInputId}
            type="text"
            value={customFont}
            placeholder="Press Start 2P"
            aria-describedby={`${customInputId}-description`}
            maxLength={80}
            onChange={(event) => onChange({
              font: presetFont,
              googleFont: event.target.value,
            })}
          />
        </div>
      ) : (
        /* The counter keeps the same authoritative field without adding new UI. */
        <input id={customInputId} type="hidden" value={customFont} readOnly />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>
    </div>
  );
}
