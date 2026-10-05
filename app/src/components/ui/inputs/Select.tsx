/* Workspace select — a native <select>, so the mobile picker and keyboard
 * behaviour come from the platform rather than being reimplemented.
 */
import type { SettingOption } from '@/lib/tools/settingTypes';

export default function Select({
  id,
  value,
  options,
  onChange,
  describedBy,
}: {
  id: string;
  value: string;
  options: readonly SettingOption[];
  onChange: (next: string) => void;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
      className="w-32 shrink-0 rounded-md border border-ws-border bg-ws-control px-2 py-1.5 text-sm text-ws-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ws-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ws-surface"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
