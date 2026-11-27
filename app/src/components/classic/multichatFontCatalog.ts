/* The font picker's logic: font catalog, search ranking, recent fonts in
   localStorage. The generator's font picker (FontPicker.svelte) uses it. */
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

export const PRESET_TOKEN_PREFIX = 'preset:';

export type MultichatFontSelection = {
  font: string;
  googleFont: string;
};

export type FontChoice = {
  token: string;
  label: string;
  kind: 'preset' | 'google' | 'custom';
  presetValue?: string;
};

export function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function presetToken(value: string): string {
  return `${PRESET_TOKEN_PREFIX}${value}`;
}

export function matchRank(value: string, query: string): number | null {
  if (!query) return 0;
  const normalized = normalizedSearch(value);
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  return normalized.includes(query) ? 2 : null;
}

export function optionMatchRank(option: SettingOption, query: string): number | null {
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

export function choiceIdentity(choice: FontChoice): string {
  return normalizedSearch(choice.label);
}

export function presetChoice(option: SettingOption): FontChoice {
  return {
    token: presetToken(option.value),
    label: option.label,
    kind: 'preset',
    presetValue: option.value,
  };
}

export function googleChoice(family: string): FontChoice {
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

export function choiceFromToken(
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

export function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function writeRecentMultichatFonts(tokens: readonly string[]): void {
  try {
    browserLocalStorage()?.setItem(
      MULTICHAT_RECENT_FONTS_STORAGE_KEY,
      JSON.stringify(tokens.slice(0, MULTICHAT_RECENT_FONTS_LIMIT)),
    );
  } catch {
    /* A blocked/full localStorage is a preference failure, not a generator failure. */
  }
}

export function deduplicateChoices(choices: readonly FontChoice[]): FontChoice[] {
  const identities = new Set<string>();
  return choices.filter((choice) => {
    const identity = choiceIdentity(choice);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}
