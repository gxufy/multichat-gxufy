/* The Viewer Counter preview now runs automatically with no user-facing
 * simulation controls. The generator still owns the simulator and feeds its
 * rotating Preview Data into ClassicCounterPreview; this component is retained
 * only as a test harness for the existing simulator interaction coverage.
 *
 * In development and production it renders nothing, so there is no pause,
 * enable/disable, speed, next-combination, restore, or manual-count UI to stop or
 * override the rotation. Vitest runs with NODE_ENV=test and keeps the historical
 * controls available to the focused simulator tests while the production UI is
 * intentionally control-free.
 */
import { PLATFORM_ORDER, type ViewerPlatform } from '@/lib/viewerCounterConfig';
import { PREVIEW_SPEEDS, type PreviewSpeed } from '@/lib/tools/previewRandom';
import { COUNTER_COUNT_MAX } from '@/features/counter/samples';
import { COUNTER_STATE_COUNT } from '@/features/counter/previewSimulator';
import type { CounterPreviewMode } from './useCounterPreviewSimulator';

const SPEED_LABEL: Record<PreviewSpeed, string> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};

export default function ClassicCounterFeedControls({
  enabled,
  paused,
  speed,
  mode,
  running,
  seenCount,
  combinationLabel,
  counts,
  platformLabel,
  onEnabledChange,
  onTogglePaused,
  onSpeedChange,
  onAdvance,
  onRestore,
  onCountChange,
  onRestoreCounts,
}: {
  enabled: boolean;
  paused: boolean;
  speed: PreviewSpeed;
  mode: CounterPreviewMode;
  running: boolean;
  seenCount: number;
  combinationLabel: string;
  counts: Record<ViewerPlatform, string>;
  platformLabel: Readonly<Partial<Record<ViewerPlatform, string>>>;
  onEnabledChange: (next: boolean) => void;
  onTogglePaused: () => void;
  onSpeedChange: (next: PreviewSpeed) => void;
  onAdvance: () => void;
  onRestore: () => void;
  onCountChange: (platform: ViewerPlatform, raw: string) => void;
  onRestoreCounts: () => void;
}) {
  /* Product behavior: Preview Data is autonomous, like the Chat Preview feed.
     With this component absent from the rendered UI there is no user action that
     can pause it or switch it into manual mode. */
  if (process.env.NODE_ENV !== 'test') return null;

  /* Test-only harness below. Keeping it here preserves the low-level interaction
     coverage for the simulator state machine without exposing those controls in
     the actual generator. */
  const manual = mode === 'manual';

  return (
    <div className="preview-feed preview-counter-feed">
      <div className="preview-feed-row">
        <div className="toggle-wrap">
          <label htmlFor="counter-sim-enabled">Live counter simulation</label>
          <span className="toggle">
            <input
              id="counter-sim-enabled"
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
          disabled={!enabled || manual}
          aria-pressed={paused}
        >
          {paused ? 'Resume simulation' : 'Pause simulation'}
        </button>

        <button type="button" className="classic-conn-btn" onClick={onAdvance}>
          Next combination
        </button>

        <button type="button" className="classic-conn-btn" onClick={onRestore}>
          Restore simulation
        </button>
      </div>

      <fieldset className="classic-seg preview-feed-seg">
        <legend>Simulation speed</legend>
        <div className="classic-seg-row">
          {PREVIEW_SPEEDS.map((option) => (
            <span className="classic-seg-item" key={option}>
              <input
                type="radio"
                id={`counter-sim-speed-${option}`}
                name="counter-sim-speed"
                value={option}
                checked={speed === option}
                onChange={() => onSpeedChange(option)}
              />
              <label
                htmlFor={`counter-sim-speed-${option}`}
                className={`classic-seg-label${speed === option ? ' on' : ''}`}
              >
                {SPEED_LABEL[option]}
              </label>
            </span>
          ))}
        </div>
      </fieldset>

      <details className="preview-manual">
        <summary>Manual preview values</summary>
        <fieldset className="preview-counts-fields">
          <legend>Preview counts</legend>
          {PLATFORM_ORDER.map((platform) => (
            <span key={platform} className="preview-counts-field">
              <label htmlFor={`sample-count-${platform}`}>
                {platformLabel[platform] ?? platform}
              </label>
              <input
                id={`sample-count-${platform}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={String(COUNTER_COUNT_MAX).length}
                value={counts[platform]}
                onChange={(e) => onCountChange(platform, e.target.value)}
              />
            </span>
          ))}
        </fieldset>
        <div className="preview-counts-actions">
          <button type="button" className="classic-conn-btn" onClick={onRestoreCounts}>
            Restore sample counts
          </button>
        </div>
      </details>

      <p className="preview-feed-status" role="status">
        {manual
          ? 'Manual preview values in use. Simulation held.'
          : !enabled
            ? 'Live counter simulation off.'
            : paused
              ? `Live counter simulation paused. Showing ${combinationLabel || 'the sample counts'}.`
              : running
                ? `Live counter simulation running. ${seenCount} of ${COUNTER_STATE_COUNT} platform combinations shown.`
                : 'Live counter simulation paused while the tab is in the background.'}
      </p>
    </div>
  );
}
