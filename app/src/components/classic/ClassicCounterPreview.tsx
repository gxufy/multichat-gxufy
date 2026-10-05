/* The generator's built-in counter preview: the production renderer over fixtures.
 *
 * This is NOT a second counter renderer. It mounts
 * `components/ViewerCounterDisplay` — the same component pages/counter.tsx
 * mounts — and hands it `PlatformStatuses`, the same shape the live overlay
 * folds `/api/viewers` results into. Every counter setting therefore behaves
 * here exactly as it will in OBS: combined and separate modes, icons,
 * alignment, the pill background, the shadow, the outline, and the rolling
 * number's own formatting included.
 *
 * The configuration is not mapped from generator state by hand. State is
 * serialized by the tool's own serializer and parsed back through
 * `parseViewerCounterConfig` — the identical round trip pages/counter.tsx
 * performs on a real URL. A hand-written mapping would be a second reading of
 * the same six parameters and would drift; this cannot.
 *
 * WHAT IT DOES NOT DO. No fetch of /api/viewers, no polling, no pin polling, no
 * timers of its own beyond the rolling number's own animation frames. It is a
 * pure function of (query string, counts): mount it and it paints. A live
 * preview of a channel nobody has typed yet is correctly empty, and an empty
 * frame shows nothing about styling.
 *
 * The renderer runs inside `IsolatedPreviewFrame`, not in the generator
 * document. `ViewerCounterDisplay` is milder than `ChatOverlay` — it sets no
 * html/body reset — but it still emits a global `@font-face` and a global
 * `@keyframes vcIn` through `next/head`, and those belong to the overlay, not
 * to the generator. Framing it also gives the counter the same guaranteed
 * containment the chat preview has: whatever a six-digit count or a future
 * style option does to the layout, it cannot reach past the frame's edge.
 *
 * The counts never reach a generated URL. They are not serialized, not written
 * to the draft, and not part of `counterQuery`; this component only reads it.
 */
import { useMemo } from 'react';
import ViewerCounterDisplay from '@/components/overlay/ViewerCounterDisplay';
import IsolatedPreviewFrame from '@/components/classic/IsolatedPreviewFrame';
import {
  parseViewerCounterConfig,
  type PlatformStatuses,
} from '@/lib/viewerCounterConfig';

/** Parse a serialized query string into the config the overlay expects. */
function styleFromQuery(query: string) {
  const raw = Object.fromEntries(new URLSearchParams(query).entries());
  return parseViewerCounterConfig(raw).style;
}

export default function ClassicCounterPreview({
  query,
  statuses,
  width,
  height,
}: {
  /** The counter query string, from the tool's own serializer. */
  query: string;
  /** Sample statuses to render. */
  statuses: PlatformStatuses;
  /** Canonical OBS width the tool declares, for the frame's aspect ratio. */
  width: number;
  /** Canonical OBS height the tool declares, for the frame's aspect ratio. */
  height: number;
}) {
  const style = useMemo(() => styleFromQuery(query), [query]);

  return (
    /* Labelled, as the live iframe is labelled by its title. Without this a
       screen reader reads four invented numbers with nothing saying they are
       samples rather than a real audience. A group rather than a region: a
       labelled grouping inside the preview, not a landmark worth its own entry
       in the landmark list. The frame carries its own title too, so the group
       label says what the numbers *are* and the title says what the frame is. */
    <div
      role="group"
      aria-label="Preview data — sample viewer counts, not live numbers"
      data-testid="counter-fixture-preview"
    >
      <IsolatedPreviewFrame
        title="Viewer Counter sample preview"
        width={width}
        height={height}
        testId="counter-preview-frame"
      >
        {/* Byte-for-byte the inset pages/counter.tsx puts around the renderer,
            so the pills sit exactly where OBS will show them rather than flush
            against the frame's edge. It lives inside the portalled subtree, so
            it is the overlay page's own inset reproduced within the frame
            document rather than a generator style reaching into it. */}
        <div style={{ padding: 8, boxSizing: 'border-box', width: '100%' }}>
          <ViewerCounterDisplay statuses={statuses} style={style} />
        </div>
      </IsolatedPreviewFrame>
    </div>
  );
}
