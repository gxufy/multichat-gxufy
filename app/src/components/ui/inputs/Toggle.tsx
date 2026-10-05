/* Workspace toggle — a real checkbox styled as a switch.
 *
 * Kept as an <input type="checkbox"> rather than a div-with-role so keyboard
 * activation, focus, and screen-reader semantics come from the platform.
 * Tailwind only; no effect on any overlay stylesheet.
 */

export default function Toggle({
  id,
  checked,
  onChange,
  describedBy,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** id of a description element, when the setting has helper text. */
  describedBy?: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="peer h-6 w-11 cursor-pointer appearance-none rounded-full bg-ws-control transition-colors checked:bg-ws-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ws-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ws-surface"
      />
      {/* Purely decorative knob; the checkbox above owns all interaction.
          `motion-reduce:transition-none` because this is the only element in the
          workspace that actually moves — it still jumps to the checked position,
          so the state stays legible without the slide. The colour transitions
          elsewhere are deliberately left alone: a fade is not motion, and
          removing them would lose feedback without helping anyone. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1 h-4 w-4 rounded-full bg-white transition-transform motion-reduce:transition-none peer-checked:translate-x-5"
      />
    </span>
  );
}
