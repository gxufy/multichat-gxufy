/* OverlayPreviewFrame — live-overlay preview routing.
 *
 * Chat still embeds the exact generated overlay URL in an iframe. The Viewer
 * Counter is different: common content blockers can block a nested /counter
 * navigation even while the same URL works as a top-level OBS/browser source.
 * Counter URLs therefore render through LiveCounterPreview, which polls in the
 * parent document and mounts the production counter renderer inside a local
 * isolated frame. That keeps the visual result identical without making the
 * counter overlay URL itself a nested network navigation.
 *
 * Incoming URLs change on every keystroke in a channel field, so both paths are
 * debounced and only switch once typing has paused.
 */
import { useEffect, useState } from 'react';
import LiveCounterPreview from './LiveCounterPreview';

/** How long the incoming URL must hold still before the preview updates. */
export const PREVIEW_DEBOUNCE_MS = 350;

function isCounterUrl(url: string): boolean {
  try {
    return new URL(url).pathname === '/counter';
  } catch {
    return false;
  }
}

export default function OverlayPreviewFrame({
  url,
  configured,
  title,
  height,
}: {
  /** The generated overlay URL — identical to the one Copy provides. */
  url: string;
  /** Whether the tool has enough valid channel input to render. */
  configured: boolean;
  /** Accessible iframe/preview title. */
  title: string;
  /** Fixed viewport height in pixels. */
  height: number;
}) {
  /* The last settled URL, or null when there is nothing valid to show.
     Deliberately never seeded from `url`: at mount `url` is the channel-less
     default, and using it would let a live preview start the instant a first
     character makes `configured` true, before the debounce has run. */
  const [settledUrl, setSettledUrl] = useState<string | null>(null);

  useEffect(() => {
    /* Only a configured URL is ever settled, so no channel-less URL can reach
       either the chat iframe or the native Counter poller. */
    const next = configured ? url : null;
    const timeout = setTimeout(() => setSettledUrl(next), PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [url, configured]);

  if (!configured || settledUrl === null) return null;

  if (isCounterUrl(settledUrl)) {
    return <LiveCounterPreview url={settledUrl} height={height} />;
  }

  return (
    <iframe
      src={settledUrl}
      title={title}
      scrolling="no"
      style={{
        display: 'block',
        width: '100%',
        height,
        border: 'none',
        background: 'transparent',
        overflow: 'hidden',
      }}
    />
  );
}
