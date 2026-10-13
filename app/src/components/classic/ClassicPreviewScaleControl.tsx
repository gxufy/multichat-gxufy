/* The preview-only zoom control.
 *
 * WHAT IT IS NOT. It is not a text size. `textSize` is a real MultiChat setting
 * that ships in the generated URL and changes what OBS draws; this changes only
 * how large the *preview surface* is rendered in the generator, and nothing it
 * does reaches a query string, a saved draft, or the overlay. The two are
 * genuinely different things and are deliberately not connected: someone judging
 * whether their chosen text size reads well at a glance needs to see more than
 * three lines of it, and shrinking the real setting to achieve that would change
 * the thing being judged.
 *
 * WHY 75% IS THE DEFAULT. The canonical chat source is 680×280. At full size that
 * fits very few lines in the card, so the preview said little about density,
 * about how a long backlog reads, or about what the filters actually removed.
 * Three quarters roughly doubles what fits while staying legible, so it is the
 * more useful default — and Reset returns here rather than to 100%, because this
 * is the setting's home rather than a departure from it.
 *
 * Radios rather than a slider: four discrete steps are a choice among named
 * options, and a native radio group announces "2 of 4" and moves under the arrow
 * keys with no scripting. A range input would announce a number nobody chose.
 */
import {
  PREVIEW_SCALES,
  PREVIEW_SCALE_DEFAULT,
  type PreviewScale,
} from './IsolatedPreviewFrame';

export default function ClassicPreviewScaleControl({
  scale,
  onScaleChange,
}: {
  scale: PreviewScale;
  onScaleChange: (next: PreviewScale) => void;
}) {
  return (
    <fieldset
      className="classic-seg preview-feed-seg preview-scale"
      aria-describedby="preview-scale-help"
    >
      <legend>Preview scale</legend>
      <div className="classic-seg-row">
        {PREVIEW_SCALES.map((option) => (
          <span className="classic-seg-item" key={option}>
            <input
              type="radio"
              id={`preview-scale-${option}`}
              name="preview-scale"
              value={option}
              checked={scale === option}
              onChange={() => onScaleChange(option)}
            />
            <label
              htmlFor={`preview-scale-${option}`}
              className={`classic-seg-label${scale === option ? ' on' : ''}`}
            >
              {option}%
            </label>
          </span>
        ))}
      </div>
      <p className="sr-only" id="preview-scale-help">
        Zooms this preview only. The overlay and its URL are unchanged.
      </p>
      <div className="preview-feed-actions">
        <button
          type="button"
          className="classic-conn-btn"
          onClick={() => onScaleChange(PREVIEW_SCALE_DEFAULT)}
          /* Nothing to do at the default, and saying so is more useful than a
             button that looks live and changes nothing. */
          disabled={scale === PREVIEW_SCALE_DEFAULT}
        >
          Reset scale to {PREVIEW_SCALE_DEFAULT}%
        </button>
      </div>
    </fieldset>
  );
}
