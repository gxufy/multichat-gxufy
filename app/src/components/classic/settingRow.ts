/* Helpers for one generator settings row (Setting.svelte). */
import {
  optionAvailable,
  type Setting,
  type SettingAvailability,
  type SettingValue,
} from '@/lib/tools/settingTypes';

/** How a numeric text setting is drawn when the caller asks for a slider. */
export type SettingRange = {
  min: number;
  max: number;
  step: number;
  /** Suffix shown beside the current value. Never part of the value. */
  unit?: string;
  /**
   * Label for the button that restores `''`.
   *
   * Blank is a real value on these settings — it suppresses the parameter — and
   * a slider cannot express it, so the button is the only way back. Without it,
   * moving the slider once would permanently commit the parameter.
   */
  blankLabel: string;
};

/** Read a value as a string list, falling back when state disagrees. */
export function asStringList(
  value: SettingValue,
  fallback: readonly string[],
): readonly string[] {
  if (typeof value !== 'object' || value === null) return fallback;
  return value;
}

/** Distinct reasons for currently-gated options, deduplicated. */
export function unavailableReasons<C>(
  setting: Setting<C>,
  availability: SettingAvailability | undefined,
): string[] {
  if (!availability) return [];
  if (setting.type !== 'multiselect' && setting.type !== 'select') return [];

  const reasons: string[] = [];
  for (const option of setting.options) {
    const state = optionAvailable(availability, option.value);
    if (state.available) continue;
    if (state.reason && !reasons.includes(state.reason)) reasons.push(state.reason);
  }
  return reasons;
}
