/* Setting descriptor types for the generator workspace.
 *
 * A tool describes its non-channel controls as data — a flat catalog of
 * descriptors — and the workspace renders them generically. Adding a control
 * means adding a catalog entry, not writing markup.
 *
 * Six control types are modelled: `toggle` and `select` (used today by the
 * Viewer Counter) plus `text`, `color`, `number`, and `multiselect`, added for
 * MultiChat's channel names, colours, fade duration, and pinned-platform set.
 * Each variant describes a control generically: no tool-specific field names,
 * no CSV or bitmask encoding, no serialization. Encoding stays in each tool's
 * own config module.
 *
 * Browser-safe — no server-only imports, no secrets.
 */

/** Fields every descriptor carries, whatever its control type. */
type SettingBase<C> = {
  /** Stable identifier, unique within a catalog. Also the config field name. */
  key: keyof C & string;
  /** Overlay query parameter this setting serializes to. */
  param: string;
  /** Visible control label. Must be a plain string — it is rendered as text. */
  label: string;
  /** Optional one-line helper text shown under the label. */
  description?: string;
  /**
   * Kept out of the default control list until explicitly revealed.
   *
   * Supported by the type so a later tool can park legacy or debug parameters
   * somewhere addressable. The Viewer Counter catalog sets this on nothing,
   * and the workspace renders no reveal affordance while no setting uses it.
   */
  hidden?: boolean;
  /**
   * Renders the control non-interactive. A static property only: the catalog
   * declares it, nothing recomputes it per render. Contextual enabling (OAuth
   * state, sibling values) is not modelled here.
   */
  disabled?: boolean;
  /** Why the control is disabled. Announced with the control when present. */
  disabledReason?: string;
};

/** A single choice in a select control. */
export type SettingOption<V extends string = string> = {
  value: V;
  label: string;
};

/**
 * Whether one option is currently selectable, and why not.
 *
 * Separate from the descriptor's static `disabled`, which the catalog declares
 * once. This is computed per render from workspace runtime state, so a control
 * can become available while the page is open. Nothing here names a platform, an
 * OAuth provider, or a tool: the workspace asks a tool whether an option is
 * available and renders the answer.
 */
export type OptionAvailability = {
  readonly available: boolean;
  /**
   * Why the option cannot be chosen. Required in spirit whenever `available` is
   * false — an option greyed out with no reason is a dead end — and rendered as
   * text associated with the control, not as a colour change alone.
   */
  readonly reason?: string;
};

/**
 * A tool's answer for each of a setting's options.
 *
 * Keyed by option value. A value absent from the map is available: the common
 * case stays free of boilerplate, and only genuinely gated options are listed.
 */
export type SettingAvailability = Readonly<Record<string, OptionAvailability>>;

/** Availability for every setting a tool gates, keyed by setting key. */
export type CatalogAvailability = Readonly<Record<string, SettingAvailability>>;

/** Whether an option is selectable, defaulting to yes. */
export function optionAvailable(
  availability: SettingAvailability | undefined,
  value: string,
): OptionAvailability {
  return availability?.[value] ?? { available: true };
}

/** Boolean control. */
export type ToggleSetting<C> = SettingBase<C> & {
  type: 'toggle';
  /** Must equal the tool's authoritative default for this field. */
  default: boolean;
};

/** Fixed-choice control. */
export type SelectSetting<C> = SettingBase<C> & {
  type: 'select';
  /** Allowed values, in display order. */
  options: readonly SettingOption[];
  /** Must equal the tool's authoritative default, and appear in `options`. */
  default: string;
};

/** Free-text control. Edits a plain string; no parsing, no validation. */
export type TextSetting<C> = SettingBase<C> & {
  type: 'text';
  /** Must equal the tool's authoritative default for this field. */
  default: string;
  /** Hint shown in the empty field. Never a value. */
  placeholder?: string;
  /** Native input length cap, when the field has a real one. */
  maxLength?: number;
};

/**
 * Colour control. Edits an opaque CSS colour string — the value is passed
 * through exactly as typed, with no case folding, shorthand expansion, or
 * normalization. Tools that need a canonical form do it at serialization time.
 */
export type ColorSetting<C> = SettingBase<C> & {
  type: 'color';
  /** Must equal the tool's authoritative default for this field. */
  default: string;
  /** Permits the exact string `transparent` in addition to a colour. */
  allowTransparent?: boolean;
};

/** Numeric control. Emits finite numbers only. */
export type NumberSetting<C> = SettingBase<C> & {
  type: 'number';
  /** Must equal the tool's authoritative default for this field. */
  default: number;
  min?: number;
  max?: number;
  step?: number;
  /** Displayed beside the field ('ms', 'px'). Never part of the value. */
  unit?: string;
};

/**
 * Multiple-choice control. The value is the selected subset, deduplicated and
 * ordered by `options`, never by click order. Encoding that subset (CSV, repeated
 * params, bitmask) is the tool's job, not this control's.
 */
export type MultiSelectSetting<C> = SettingBase<C> & {
  type: 'multiselect';
  /** Allowed values, in display order. */
  options: readonly SettingOption[];
  /** Must equal the tool's authoritative default. Empty is valid. */
  default: readonly string[];
};

/** Any descriptor in a catalog. */
export type Setting<C> =
  | ToggleSetting<C>
  | SelectSetting<C>
  | TextSetting<C>
  | ColorSetting<C>
  | NumberSetting<C>
  | MultiSelectSetting<C>;

/** Every value shape a control can hold or emit. */
export type SettingValue = boolean | string | number | readonly string[];

/** The value type a given descriptor holds, taken from its own default. */
export type SettingValueFor<T extends { default: SettingValue }> = T['default'];

/** A tool's full control catalog, in display order. */
export type SettingCatalog<C> = readonly Setting<C>[];

/** Descriptors the generator shows without an explicit reveal. */
export function visibleSettings<C>(catalog: SettingCatalog<C>): Setting<C>[] {
  return catalog.filter((setting) => !setting.hidden);
}

/* ------------------------------------------------------------------ */
/* Catalog lookup                                                      */
/* ------------------------------------------------------------------ */

/*
 * The Classic generator lays its controls out by hand — the two-column
 * arrangement is part of its visual identity, so the markup is written rather
 * than generated from the catalog's order. But the *content* of a control still
 * comes from the catalog: its label, its options, its description, its default.
 *
 * These accessors are what make that true rather than aspirational. A control
 * asks the catalog for its descriptor by key and gets the declared variant back;
 * a key that does not exist, or exists with a different control type, throws at
 * module scope rather than rendering a mislabelled control. So the catalog stays
 * the single description of what MultiChat and the Counter can be configured to
 * do, and a hand-written layout cannot silently drift from it.
 */

/** One descriptor by key. Throws when the catalog has no such setting. */
export function findSetting<C>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
): Setting<C> {
  const found = catalog.find((setting) => setting.key === key);
  if (!found) throw new Error(`No catalog setting named ${key}`);
  return found;
}

/** Narrow a lookup to one control type, or throw naming both types. */
function ofType<C, T extends Setting<C>['type']>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
  type: T,
): Extract<Setting<C>, { type: T }> {
  const setting = findSetting(catalog, key);
  if (setting.type !== type) {
    throw new Error(`Catalog setting ${key} is a ${setting.type}, not a ${type}`);
  }
  return setting as Extract<Setting<C>, { type: T }>;
}

export function toggleSetting<C>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
): ToggleSetting<C> {
  return ofType(catalog, key, 'toggle');
}

export function selectSetting<C>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
): SelectSetting<C> {
  return ofType(catalog, key, 'select');
}

export function textSetting<C>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
): TextSetting<C> {
  return ofType(catalog, key, 'text');
}

export function colorSetting<C>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
): ColorSetting<C> {
  return ofType(catalog, key, 'color');
}

export function multiSelectSetting<C>(
  catalog: SettingCatalog<C>,
  key: keyof C & string,
): MultiSelectSetting<C> {
  return ofType(catalog, key, 'multiselect');
}

/** Build option lists from a readonly enum tuple, labelled by a formatter. */
export function optionsFrom<V extends string>(
  values: readonly V[],
  label: (value: V) => string,
): readonly SettingOption<V>[] {
  return values.map((value) => ({ value, label: label(value) }));
}

/** Sentence-case a lowercase enum member for display ('live-unknown' → 'Live unknown'). */
export function titleCase(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
