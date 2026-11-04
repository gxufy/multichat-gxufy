import React from 'react';
import { handleAssetError } from './render/imageFallback';
import { isSafeRemoteMediaUrl } from './remoteMediaUrl';
import { normalizeTwitchGifSize } from './twitchGifConfig';
import type { TwitchGifAsset } from './types';

export { DEFAULT_TWITCH_GIF_SIZE_PX } from './twitchGifConfig';

const MAX_TWITCH_GIFS_PER_MESSAGE = 32;

/** Parse Twitch's comma-separated, inclusive-code-point GIF tag entries. */
export function parseTwitchGifTag(raw: unknown, text?: string): TwitchGifAsset[] {
  if (typeof raw !== 'string' || !raw) return [];
  const textLength = text === undefined ? null : Array.from(text).length;
  const candidates: TwitchGifAsset[] = [];

  for (const entry of raw.split(',')) {
    const parts = entry.split('|');
    if (parts.length !== 3) continue;
    const range = /^(\d+)-(\d+)$/.exec(parts[0]);
    const id = parts[1].trim();
    const start = range ? Number(range[1]) : Number.NaN;
    const inclusiveEnd = range ? Number(range[2]) : Number.NaN;
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(inclusiveEnd)
      || start < 0
      || inclusiveEnd < start
      || !id
      || id.length > 128
      || !isSafeRemoteMediaUrl(parts[2])
    ) continue;
    const end = inclusiveEnd + 1;
    if (!Number.isSafeInteger(end) || (textLength !== null && end > textLength)) continue;
    candidates.push({ start, end, id, url: parts[2] });
  }

  candidates.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: TwitchGifAsset[] = [];
  for (const candidate of candidates) {
    const previous = accepted[accepted.length - 1];
    if (previous && candidate.start < previous.end) continue;
    accepted.push(candidate);
    if (accepted.length >= MAX_TWITCH_GIFS_PER_MESSAGE) break;
  }
  return accepted;
}

/**
 * The render node used when Twitch marks a chat line as a native GIF message.
 * Width remains natural but can never escape the overlay viewport.
 */
export function renderTwitchGif(url: string, size: number, key = 'twitch-native-gif'): React.ReactNode {
  if (!isSafeRemoteMediaUrl(url)) return null;
  const px = normalizeTwitchGifSize(size);
  return (
    <img
      key={key}
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
