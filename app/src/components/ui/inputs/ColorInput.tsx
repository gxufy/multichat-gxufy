/* Colour field: a native swatch plus the literal text value.
 *
 * The text box is authoritative. Whatever is typed is emitted verbatim — no
 * case folding, no shorthand expansion, no validation. An intermediate string
 * like '#ab' is a legal keystroke, so nothing here may throw on it.
 *
 * The swatch is a convenience only. Browsers force `<input type="color">` to a
 * six-digit lowercase hex, so it is fed a parsed hex when the text happens to
 * be one and left at a neutral value otherwise; it never rewrites the text on
 * its own.
 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Expand '#abc' to '#aabbcc' for the swatch only — never for the value. */
function swatchValue(value: string): string {
  if (!HEX.test(value)) return '#000000';
  if (value.length === 7) return value.toLowerCase();
  const [, r, g, b] = value.toLowerCase();
  return `#${r}${r}${g}${g}${b}${b}`;
}

export default function ColorInput({
  id,
  value,
  onChange,
  allowTransparent = false,
  disabled = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  allowTransparent?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const isTransparent = value === 'transparent';

  return (
    <div className="flex shrink-0 items-center gap-2">
      <input
        type="color"
        aria-label="Colour swatch"
        tabIndex={-1}
        value={swatchValue(value)}
        disabled={disabled || isTransparent}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-ws-border bg-ws-control p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        placeholder={allowTransparent ? '#ffffff or transparent' : '#ffffff'}
        onChange={(event) => onChange(event.target.value)}
        className="w-28 shrink-0 rounded-md border border-ws-border bg-ws-control px-2 py-1.5 font-mono text-sm text-ws-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ws-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
