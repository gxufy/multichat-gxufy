import React from 'react';
import { handleAssetError } from './render/imageFallback';
import { normalizeTwitchGifSize } from './twitchGifConfig';

export { DEFAULT_TWITCH_GIF_SIZE_PX } from './twitchGifConfig';

/**
 * Twitch's GIF tag can contain provider metadata before the actual asset URL.
 * Extract only an HTTPS URL and reject anything that cannot be parsed safely.
 */
export function parseTwitchGifTag(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const match = raw.match(/https:\/\/[^\s]+/i);
  if (!match) return undefined;
  try {
    const url = new URL(match[0]);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The render node used when Twitch marks a chat line as a native GIF message.
 * Width remains natural but can never escape the overlay viewport.
 */
export function renderTwitchGif(url: string, size: number): React.ReactNode {
  const px = normalizeTwitchGifSize(size);
  return (
    <img
      key="twitch-native-gif"
      className="ck-twitch-gif"
      src={url}
      alt="GIF"
      draggable={false}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleAssetError}
      style={{
        display: 'inline-block',
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        maxHeight: `${px}px`,
        objectFit: 'contain',
        verticalAlign: 'middle',
      }}
    />
  );
}
