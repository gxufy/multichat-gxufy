/* Workspace button.
 *
 * Always a real <button>, so Enter and Space work and focus order is natural.
 * `disabled` is used only for genuinely unavailable actions; validation
 * feedback is surfaced as an inline live-region message by the caller, never
 * by silently disabling with no explanation.
 */
import type { ReactNode } from 'react';

export default function Button({
  onClick,
  children,
  variant = 'secondary',
  disabled,
  describedBy,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  describedBy?: string;
  title?: string;
}) {
  const palette =
    variant === 'primary'
      ? 'bg-ws-accent text-white hover:bg-ws-accent-hover border-transparent'
      : 'bg-ws-control text-ws-text hover:bg-ws-control-hover border-ws-border';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-describedby={describedBy}
      className={`shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ws-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ws-surface disabled:cursor-not-allowed disabled:opacity-50 ${palette}`}
    >
      {children}
    </button>
  );
}
