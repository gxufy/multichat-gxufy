/* One catalog setting, rendered in the Classic generator's visual language.
 *
 * This is the Classic counterpart to components/workspace/SettingRow: same
 * catalog descriptors, same availability gating, same accessibility wiring —
 * different markup. The workspace row is a Tailwind label-left/control-right
 * strip; Classic rows are `.form_row.left` (visually label-left/control-right), `.toggle-wrap`
 * pills, and chip groups, which is a large part of what the page looks like.
 *
 * Two things it deliberately does not do:
 *
 *   - Invent labels, options, defaults, or descriptions. Everything rendered
 *     comes off the descriptor, so adding a setting to a catalog is enough and
 *     the Classic page cannot describe a control the overlay does not have.
 *   - Assume a single instance per page. Every id is built from a caller-supplied
 *     prefix, because MultiChat and the Viewer Counter both have `stroke` and
 *     `textShadow`, and they are now on the same page. Unprefixed ids would give
 *     two inputs the same id and point one label at the wrong control.
 *
 * PRESENTATION IS THE CALLER'S, VALUES ARE THE CATALOG'S
 *
 * A `select` can be drawn as a dropdown or as a segmented pill row, and a numeric
 * `text` setting as a field or as a slider. Which one is a layout decision, so it
 * is a prop here rather than a catalog field: the catalogs stay a description of
 * what the overlay can be configured to do, not of how this page looks. Either
 * presentation emits the identical value — a segmented row's radios carry the
 * declared option values, and a slider stringifies its number the same way the
 * field did — so no URL changes when one is swapped for the other.
 */
import type { ReactElement } from 'react';
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
function asStringList(
  value: SettingValue,
  fallback: readonly string[],
): readonly string[] {
  if (typeof value !== 'object' || value === null) return fallback;
  return value;
}

/** Distinct reasons for currently-gated options, deduplicated. */
function unavailableReasons<C>(
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

export default function ClassicSetting<C>({
  setting,
  value,
  onChange,
  availability,
  idPrefix,
  /** Renders each option in the face it names — the font picker's whole point. */
  optionStyle,
  /** Applied to the control itself, e.g. the font picker's own preview face. */
  controlStyle,
  /** Draw a `select` as a segmented pill row instead of a dropdown. */
  segmented = false,
  /** Draw a numeric `text` setting as a slider instead of a field. */
  range,
}: {
  setting: Setting<C>;
  value: SettingValue;
  onChange: (key: keyof C & string, next: SettingValue) => void;
  availability?: SettingAvailability;
  /** Namespace for this setting's ids, e.g. 'mc' or 'vc'. */
  idPrefix: string;
  optionStyle?: (optionValue: string) => React.CSSProperties | undefined;
  controlStyle?: React.CSSProperties;
  segmented?: boolean;
  range?: SettingRange;
}) {
  const inputId = `${idPrefix}-${setting.key}`;
  const descriptionId = setting.description ? `${inputId}-desc` : undefined;
  const reasonId = setting.disabledReason ? `${inputId}-reason` : undefined;

  /* The catalog's static flags, honoured rather than assumed absent. Neither
     catalog sets either today, and the generator picks its controls by hand — but
     a control that silently ignored `disabled` would be editable while claiming
     not to be, and one that ignored `hidden` would expose a parked parameter. */
  if (setting.hidden) return null;
  const disabled = setting.disabled === true;

  const gatedReasons = unavailableReasons(setting, availability);
  const gatedId = gatedReasons.length > 0 ? `${inputId}-gated` : undefined;
  const describedBy =
    [descriptionId, reasonId, gatedId].filter(Boolean).join(' ') || undefined;

  /* Helper text and gating reasons, in the accessibility tree via
     aria-describedby rather than only visible — a greyed-out option with no
     stated reason tells the user nothing about how to enable it, and colour
     alone is not an accessible signal. */
  const help = (
    <>
      {setting.description ? (
        <p id={descriptionId} className="sr-only">
          {setting.description}
        </p>
      ) : null}
      {setting.disabledReason ? (
        <p id={reasonId} className="classic-help">
          {setting.disabledReason}
        </p>
      ) : null}
      {gatedId ? (
        <div id={gatedId}>
          {gatedReasons.map((reason) => (
            <p key={reason} className="classic-help warn">
              {reason}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );

  switch (setting.type) {
    /* Control first, then label — the Classic select row's own order. */
    case 'select':
      /* Segmented pills: a real radio group, not buttons with aria-pressed.
         Radios give arrow-key navigation, a single tab stop, and "2 of 5"
         announcements for free, all of which a button row would have to fake and
         would get wrong. Each radio's value is the declared option value, so the
         emitted string is identical to what the dropdown emitted. */
      if (segmented) {
        const current = typeof value === 'string' ? value : setting.default;
        return (
          <div className="classic-field">
            {/* The group carries the setting's own id — the same id the dropdown
                had. Nothing points a `for` at it (each radio has its own label),
                but it keeps one addressable element per setting whichever
                presentation is chosen. */}
            <fieldset
              id={inputId}
              className="classic-seg"
              aria-describedby={describedBy}
            >
              <legend>{setting.label}</legend>
              <div className="classic-seg-row">
                {setting.options.map((option) => {
                  const state = optionAvailable(availability, option.value);
                  const optionId = `${inputId}-${option.value}`;
                  const on = current === option.value;
                  return (
                    <span key={option.value} className="classic-seg-item">
                      <input
                        id={optionId}
                        type="radio"
                        /* One group per setting *and* per prefix: MultiChat and
                           the Counter both have `stroke`, and a shared name
                           would make selecting one clear the other. */
                        name={inputId}
                        value={option.value}
                        checked={on}
                        disabled={disabled || !state.available}
                        onChange={() => onChange(setting.key, option.value)}
                      />
                      <label
                        htmlFor={optionId}
                        className={`classic-seg-label${on ? ' on' : ''}`}
                        style={optionStyle?.(option.value)}
                      >
                        {option.label}
                      </label>
                    </span>
                  );
                })}
              </div>
            </fieldset>
            {help}
          </div>
        );
      }
      return (
        <div className="classic-field">
          <div className="form_row left">
            <select
              id={inputId}
              value={typeof value === 'string' ? value : setting.default}
              aria-describedby={describedBy}
              disabled={disabled}
              style={controlStyle}
              onChange={(e) => onChange(setting.key, e.target.value)}
            >
              {setting.options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={!optionAvailable(availability, option.value).available}
                  style={optionStyle?.(option.value)}
                >
                  {option.label}
                </option>
              ))}
            </select>
            <label htmlFor={inputId}>{setting.label}</label>
          </div>
          {help}
        </div>
      );

    /* The Classic pill switch, unchanged in look: a real checkbox inside a
       `.toggle` label, with the slider drawn by CSS from its :checked state. */
    case 'toggle':
      return (
        <div className="classic-field">
          <div className="toggle-wrap">
            <label htmlFor={inputId}>{setting.label}</label>
            <span className="toggle">
              <input
                id={inputId}
                type="checkbox"
                checked={typeof value === 'boolean' ? value : setting.default}
                aria-describedby={describedBy}
                disabled={disabled}
                onChange={(e) => onChange(setting.key, e.target.checked)}
              />
              <span className="toggle-slider" aria-hidden="true" />
            </span>
          </div>
          {help}
        </div>
      );

    case 'text': {
      const { maxLength } = setting;
      /* Slider, for the two settings whose value genuinely is a number on a
         range — fade seconds and emote scale. The state stays the raw string the
         serializer expects, and the number is stringified with String() so a
         slider at 30 emits '30' exactly as the field did. */
      if (range) {
        const raw = typeof value === 'string' ? value : setting.default;
        const blank = raw === '';
        const numeric = Number(raw);
        /* A blank or unparseable value still needs a thumb position. The
           midpoint would imply a value that is not set; the declared default is
           the honest choice, and the readout says "Default" rather than the
           number so the two states are never confused. */
        const fallback = Number(setting.default) || range.min;
        const shown = blank || !Number.isFinite(numeric) ? fallback : numeric;
        return (
          <div className="classic-field stacked">
            <label htmlFor={inputId}>{setting.label}</label>
            <div className="classic-range">
              <input
                id={inputId}
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={shown}
                aria-describedby={describedBy}
                disabled={disabled}
                /* aria-valuetext, because the number alone does not convey the
                   blank state a screen-reader user would otherwise miss. */
                aria-valuetext={
                  blank
                    ? `${range.blankLabel}`
                    : range.unit
                      ? `${shown} ${range.unit}`
                      : String(shown)
                }
                onChange={(e) => onChange(setting.key, String(Number(e.target.value)))}
              />
              <output htmlFor={inputId} className="classic-range-out">
                {blank ? range.blankLabel : range.unit ? `${shown}${range.unit}` : shown}
              </output>
              <button
                type="button"
                className={`classic-clear${blank ? ' on' : ''}`}
                aria-pressed={blank}
                disabled={disabled}
                onClick={() => onChange(setting.key, '')}
              >
                {range.blankLabel}
              </button>
            </div>
            {help}
          </div>
        );
      }
      return (
        <div className="classic-field stacked">
          <label htmlFor={inputId}>{setting.label}</label>
          <input
            id={inputId}
            type="text"
            value={typeof value === 'string' ? value : setting.default}
            placeholder={setting.placeholder}
            aria-describedby={describedBy}
            /* readOnly, not disabled: a disabled text field is skipped by tab
               order, so its content becomes unreadable to a keyboard user. */
            readOnly={disabled}
            onChange={(e) =>
              onChange(
                setting.key,
                maxLength === undefined
                  ? e.target.value
                  : e.target.value.slice(0, maxLength),
              )
            }
          />
          {help}
        </div>
      );
    }

    /* Colour keeps the Classic pair: a Transparent button that clears the value,
       beside a native colour input. '' is a meaningful value here — it means the
       parameter is omitted — which a colour input alone cannot express, so the
       button is the only way to get back to it. */
    case 'color': {
      const current = typeof value === 'string' ? value : setting.default;
      const clearId = `${inputId}-clear`;
      return (
        <div className="classic-field">
          <div className="toggle-wrap">
            <label htmlFor={inputId}>{setting.label}</label>
            <span className="classic-color">
              {setting.allowTransparent ? (
                <button
                  type="button"
                  id={clearId}
                  className={`classic-clear${current === '' ? ' on' : ''}`}
                  aria-pressed={current === ''}
                  disabled={disabled}
                  onClick={() => onChange(setting.key, '')}
                >
                  Transparent
                </button>
              ) : null}
              <input
                id={inputId}
                type="color"
                value={current || '#191919'}
                aria-describedby={describedBy}
                disabled={disabled}
                onChange={(e) => onChange(setting.key, e.target.value)}
              />
            </span>
          </div>
          {help}
        </div>
      );
    }

    /* Chips, but native checkboxes underneath: the group is a real fieldset with
       a legend, each input is sr-only and stays the focus target, and the visible
       chip is its label. Buttons with aria-pressed would look identical and lose
       group semantics, and per-option gating disables just the blocked chip
       rather than the whole group. */
    case 'multiselect': {
      const raw = asStringList(value, setting.default);
      /* Deduplicated and ordered by the declared options, never by click order.
         The value is serialized as CSV, so click order would make two identical
         selections produce two different overlay URLs — and a duplicate would
         appear twice in the query. */
      const selected = setting.options
        .map((option) => option.value)
        .filter((optionValue) => raw.includes(optionValue));
      return (
        <div className="classic-field">
          <fieldset className="classic-chips" aria-describedby={describedBy}>
            <legend>{setting.label}</legend>
            <div className="classic-chip-row">
              {setting.options.map((option) => {
                const state = optionAvailable(availability, option.value);
                const on = selected.includes(option.value) && state.available;
                const chipId = `${inputId}-${option.value}`;
                return (
                  <span key={option.value} className="classic-chip">
                    <input
                      id={chipId}
                      type="checkbox"
                      checked={on}
                      disabled={disabled || !state.available}
                      onChange={(e) => {
                        /* Rebuilt from the declared options rather than appended
                           to, so the emitted order is the catalog's order
                           whichever chip was clicked last. */
                        const next = new Set(selected);
                        if (e.target.checked) next.add(option.value);
                        else next.delete(option.value);
                        onChange(
                          setting.key,
                          setting.options
                            .map((o) => o.value)
                            .filter((v) => next.has(v)),
                        );
                      }}
                    />
                    <label
                      htmlFor={chipId}
                      className={`classic-chip-label${on ? ' on' : ''}`}
                      data-platform={option.value}
                    >
                      {option.label}
                    </label>
                  </span>
                );
              })}
            </div>
          </fieldset>
          {help}
        </div>
      );
    }

    case 'number':
      return (
        <div className="classic-field">
          <div className="form_row left">
            <input
              id={inputId}
              type="number"
              className="short"
              value={typeof value === 'number' ? value : setting.default}
              min={setting.min}
              max={setting.max}
              step={setting.step}
              aria-describedby={describedBy}
              disabled={disabled}
              /* An empty or partial entry ('', '-', '1e') emits nothing rather
                 than NaN or a coerced 0: Number('') is 0, which would silently
                 replace the user's value while they were still typing. */
              onChange={(e) => {
                const next = Number(e.target.value);
                if (e.target.value.trim() === '' || !Number.isFinite(next)) return;
                onChange(setting.key, next);
              }}
            />
            <label htmlFor={inputId}>
              {setting.unit ? `${setting.label} (${setting.unit})` : setting.label}
            </label>
          </div>
          {help}
        </div>
      );

    default: {
      /* Exhaustiveness: a new control type fails to compile until handled. */
      const unhandled: never = setting;
      return unhandled as unknown as ReactElement;
    }
  }
}
