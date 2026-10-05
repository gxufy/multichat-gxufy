/* Multiple-choice field: native checkboxes in a labelled group.
 *
 * Real `<input type="checkbox">` elements, each with its own `<label htmlFor>`,
 * so keyboard operation and screen-reader naming come from the platform.
 *
 * Emitted values are derived by filtering `options`, which makes them both
 * deduplicated and ordered by declaration rather than by click order. An empty
 * selection is a legal value, not a reset.
 */
import type { SettingOption } from '@/lib/tools/settingTypes';

export default function MultiSelect({
  id,
  legend,
  value,
  options,
  onChange,
  disabled = false,
  unavailable,
  describedBy,
}: {
  /** Prefix for per-option input ids. */
  id: string;
  /** Accessible name for the group. */
  legend: string;
  value: readonly string[];
  options: readonly SettingOption[];
  onChange: (next: readonly string[]) => void;
  disabled?: boolean;
  /**
   * Option values that cannot currently be chosen.
   *
   * Per-option, so the rest of the group stays usable — unlike `disabled`, which
   * makes the whole fieldset inert. The reason is rendered by the caller and
   * linked through `describedBy`, so this is never a colour-only signal.
   */
  unavailable?: readonly string[];
  describedBy?: string;
}) {
  const selected = new Set(value);
  const blocked = new Set(unavailable ?? []);

  return (
    <fieldset
      id={id}
      disabled={disabled}
      aria-describedby={describedBy}
      className="min-w-0 shrink-0 disabled:opacity-50"
    >
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1.5">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const checked = selected.has(option.value);
          /* An unavailable option is only blocked while unchecked. If it is
             somehow still checked, it stays operable so the user can clear it
             rather than being stuck with a selection they cannot remove. */
          const optionDisabled = disabled || (blocked.has(option.value) && !checked);
          return (
            <div key={option.value} className="flex items-center gap-1.5">
              <input
                id={optionId}
                type="checkbox"
                checked={checked}
                disabled={optionDisabled}
                onChange={() => {
                  const next = new Set(selected);
                  if (checked) next.delete(option.value);
                  else next.add(option.value);
                  onChange(
                    options
                      .map((candidate) => candidate.value)
                      .filter((candidate) => next.has(candidate)),
                  );
                }}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border-ws-border bg-ws-control text-ws-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ws-ring disabled:cursor-not-allowed"
              />
              <label
                htmlFor={optionId}
                className={
                  optionDisabled
                    ? 'cursor-not-allowed text-xs text-ws-muted'
                    : 'cursor-pointer text-xs text-ws-text'
                }
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
