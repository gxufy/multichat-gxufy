/* The live chat preview feed controls, inside the Chat overlay card.
 *
 * Preview controls, exactly like the composer beneath them: they change what the
 * preview shows and nothing else. Nothing here is serialized into the overlay
 * URL, written to the saved draft, or sent to any provider — and none of it
 * touches the twenty-four chat settings, which remain the authority on how a
 * message is drawn.
 *
 * Run state only: the switch, Pause, Reset and the speed band. The badge and
 * cosmetic picker is a separate component passed in as `children`, because the
 * two answer different questions — this one is *whether the fixtures move*, and
 * that one is *which fixtures they are*. It renders inside this frame so both
 * read as one control over one preview, and its summary arrives as
 * `statusDetail` so there is a single live region for the pair rather than two
 * competing announcements.
 *
 * Compact by design: this sits in a card that already holds a preview, a
 * composer, a URL and two buttons, so it is three short rows rather than a panel.
 * A taller control would push the chat settings card off the first screen, which
 * is the layout this page was approved with.
 */
import type { ReactNode } from 'react';
import {
  PREVIEW_SPEEDS,
  type PreviewSpeed,
} from '@/features/multichat/previewSimulator';

/** Visible names for the three speeds, in the order the band widens. */
const SPEED_LABEL: Record<PreviewSpeed, string> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};

export default function ClassicPreviewFeedControls({
  enabled,
  paused,
  speed,
  running,
  messageCount,
  statusDetail,
  onEnabledChange,
  onTogglePaused,
  onSpeedChange,
  onReset,
  segControls,
  children,
}: {
  enabled: boolean;
  paused: boolean;
  speed: PreviewSpeed;
  /** True while a message is actually scheduled. False when the tab is hidden. */
  running: boolean;
  /** How many simulated messages are currently in the preview. */
  messageCount: number;
  /** Appended to the running sentence — the badge picker's own summary. */
  statusDetail?: string;
  onEnabledChange: (next: boolean) => void;
  onTogglePaused: () => void;
  onSpeedChange: (next: PreviewSpeed) => void;
  onReset: () => void;
  /** A second segmented control set beside the speed band — the preview scale.
      The two are the card's short enum controls, so they share one wrapping row
      rather than stacking, which is what shortens this control block. */
  segControls?: ReactNode;
  /** The badge and cosmetic picker, rendered between the segments and the status
      line. Full width of its own, because nine source chips do not pair. */
  children?: ReactNode;
}) {
  /* `preview-chat-feed` carries no styling of its own — it names which of the two
     preview control surfaces this is, so a test asserting "this feed has exactly
     one live region" can say which feed it means. Without it the only available
     selector is page-wide, and the Viewer counter card's own status line counts
     against the chat feed's total. */
  return (
    <div className="preview-feed preview-chat-feed">
      <div className="preview-feed-row">
        {/* The Classic pill switch, same markup as every catalog toggle. */}
        <div className="toggle-wrap">
          <label htmlFor="preview-feed-enabled">Live preview feed</label>
          <span className="toggle">
            <input
              id="preview-feed-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
            />
            <span className="toggle-slider" aria-hidden="true" />
          </span>
        </div>

        <button
          type="button"
          className="classic-conn-btn"
          onClick={onTogglePaused}
          disabled={!enabled}
          aria-pressed={paused}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        <button type="button" className="classic-conn-btn" onClick={onReset}>
          Reset feed
        </button>
      </div>

      {/* Speed and scale sit in one wrapping row — both are short named enums, so
          pairing them keeps the control block two rows shorter than stacking. On a
          narrow card they wrap to one per line, losing nothing. */}
      <div className="preview-feed-segs">
        <fieldset className="classic-seg preview-feed-seg">
          <legend>Feed speed</legend>
          <div className="classic-seg-row">
            {PREVIEW_SPEEDS.map((option) => (
              <span className="classic-seg-item" key={option}>
                <input
                  type="radio"
                  id={`preview-feed-speed-${option}`}
                  name="preview-feed-speed"
                  value={option}
                  checked={speed === option}
                  onChange={() => onSpeedChange(option)}
                />
                <label
                  htmlFor={`preview-feed-speed-${option}`}
                  className={`classic-seg-label${speed === option ? ' on' : ''}`}
                >
                  {SPEED_LABEL[option]}
                </label>
              </span>
            ))}
          </div>
        </fieldset>

        {segControls}
      </div>

      {children}

      {/* One live region for the feed, and deliberately not one per message:
          announcing every fake line would make the page unusable with a screen
          reader. It states the run state and the count, which is what changes
          meaningfully — and it is polite, so it waits for a pause in speech.

          `statusDetail` is carried in the off sentence as well as the running one.
          Off is the default now, and the source picker is live in that state — it
          decides what the next generated message will draw from — so a summary that
          only spoke while the feed ran would be silent exactly when someone is most
          likely to be setting it up. */}
      <p className="preview-feed-status" role="status">
        {!enabled
          ? `Live preview feed off.${statusDetail ? ` ${statusDetail}` : ''}`
          : paused
            ? `Live preview feed paused. ${messageCount} simulated messages.`
            : running
              ? `Live preview feed running.${statusDetail ? ` ${statusDetail}` : ''}`
              : 'Live preview feed paused while the tab is in the background.'}
      </p>
    </div>
  );
}
