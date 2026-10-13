/* CounterPreview — live preview of the /counter overlay in the existing
 * generator tab.
 *
 * Now a thin wrapper around the shared OverlayPreviewFrame so the current
 * generator and the new workspace use one preview implementation and cannot
 * drift apart. Behaviour is unchanged: the same debounce, the same
 * channel-less guard, the same title, the same fixed height, the same
 * transparent borderless non-scrolling iframe.
 */
import OverlayPreviewFrame from './workspace/OverlayPreviewFrame';

/**
 * Fixed preview viewport height. Tall enough for one pill row at the
 * counter's fixed 34 px type plus the overlay's own 8 px padding, without
 * constraining width — the counter aligns left/center/right inside it.
 */
const PREVIEW_HEIGHT = 80;

export default function CounterPreview({
  url,
  configured,
}: {
  /** The generated /counter URL — identical to the one Copy provides. */
  url: string;
  /** Whether at least one normalized platform channel is configured. */
  configured: boolean;
}) {
  return (
    <OverlayPreviewFrame
      url={url}
      configured={configured}
      title="Live viewer counter preview"
      height={PREVIEW_HEIGHT}
    />
  );
}
