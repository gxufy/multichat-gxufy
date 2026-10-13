/* Numeric field.
 *
 * Emits finite numbers only. An empty or partial entry ('', '-', '1e') parses
 * to NaN, and NaN is never emitted — the field simply reports nothing until the
 * entry is a number again, leaving the last valid value in the config.
 *
 * min/max/step are passed to the browser as ordinary constraints. Nothing here
 * clamps, rounds, or rejects beyond what the platform already does.
 */
export default function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled = false,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered as text beside the field, never folded into the value. */
  unit?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const unitId = unit ? `${id}-unit` : undefined;
  const described = [describedBy, unitId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-describedby={described}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === '') return;
          const next = Number(raw);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="w-20 shrink-0 rounded-md border border-ws-border bg-ws-control px-2 py-1.5 text-sm text-ws-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ws-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {unit ? (
        <span id={unitId} className="shrink-0 text-xs text-ws-muted">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
