/* Workspace text input, with its own label and inline error.
 *
 * The label is a real <label for>. When `errorMessage` is present the input is
 * marked aria-invalid and the message is linked by aria-describedby and placed
 * in a polite live region, so a rejected value is announced as well as
 * coloured.
 */

export default function TextInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  invalid,
  errorMessage,
  readOnly,
  monospace,
  describedBy,
  labelClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (next: string) => void;
  placeholder?: string;
  invalid?: boolean;
  /** Shown under the field and announced politely when present. */
  errorMessage?: string;
  readOnly?: boolean;
  monospace?: boolean;
  /** Ids of helper text owned by the caller, announced alongside the label. */
  describedBy?: string;
  /**
   * Replaces the label's own styling, keeping it a real `<label for>`.
   *
   * Used by the channel fields to render the label *as* the platform's brand
   * chip. The alternative — a decorative chip beside a normal label — duplicates
   * the platform name in the DOM, which is both redundant to a screen reader and
   * exactly what the counter's regression test rightly flags. Restyling the one
   * real label keeps a single accessible name per field.
   */
  labelClassName?: string;
}) {
  const errorId = `${id}-error`;
  const showError = Boolean(errorMessage);
  const described =
    [describedBy, showError ? errorId : undefined].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className={
          labelClassName ?? 'mb-1 block text-xs font-medium text-ws-muted'
        }
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={described}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={`w-full min-w-0 rounded-md border bg-ws-control px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ws-surface placeholder:text-ws-muted ${
          invalid
            ? 'border-ws-danger focus-visible:ring-ws-danger'
            : 'border-ws-border focus-visible:ring-ws-ring'
        } ${readOnly ? 'text-ws-muted' : 'text-ws-text'} ${
          monospace ? 'font-mono text-xs' : ''
        }`}
      />
      {/* Always rendered so the region exists before the first error. */}
      <p
        id={errorId}
        role="status"
        aria-live="polite"
        className={`mt-1 text-xs text-ws-danger ${showError ? '' : 'sr-only'}`}
      >
        {errorMessage ?? ''}
      </p>
    </div>
  );
}
