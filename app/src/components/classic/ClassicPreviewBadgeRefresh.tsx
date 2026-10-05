
import type { BadgeLibraryStatus, PreviewBadgeLibraryState } from './usePreviewBadgeLibrary';

/** The button face for each status. Idle and success both invite a refresh; a
    load in flight is disabled; a failure invites a retry. */
function buttonLabel(status: BadgeLibraryStatus): string {
  switch (status) {
    case 'loading':
      return 'Loading badges…';
    case 'error':
    case 'partial':
      return 'Retry Load Badges';
    case 'success':
      return 'Reload Badges';
    case 'idle':
    default:
      return 'Load Badges';
  }
}

/** The one-line status sentence. */
function statusMessage(
  status: BadgeLibraryStatus,
  count: number,
  failedProviders: readonly string[],
): string {
  switch (status) {
    case 'loading':
      return 'Loading Twitch, Kick, 7TV, and FFZ preview badges…';
    case 'success':
      return `Preview badges loaded — ${count} available.`;
    case 'partial':
      return `Loaded ${count} preview badges. Retry ${failedProviders.join(', ')}.`;
    case 'error':
      return 'Could not refresh badges. The ones already shown are unchanged.';
    case 'idle':
    default:
      return `${count} local preview badges ready.`;
  }
}

export default function ClassicPreviewBadgeRefresh({
  library,
}: {
  /** The library hook's state. Owned by the generator, passed straight down. */
  library: PreviewBadgeLibraryState;
}) {
  const { count, status, failedProviders, load } = library;
  const busy = status === 'loading';

  return (
    <div className="preview-badge-refresh">
      <button
        type="button"
        className="classic-conn-btn"
        onClick={load}
        disabled={busy}
      >
        {buttonLabel(status)}
      </button>
      {/* One polite live region, scoped here. role="status" is an implicit
          aria-live=polite; the explicit attribute is kept for jsdom, which does
          not always map the role. */}
      <span
        className="preview-badge-status"
        role="status"
        aria-live="polite"
        data-status={status}
      >
        {statusMessage(status, count, failedProviders)}
      </span>
    </div>
  );
}
