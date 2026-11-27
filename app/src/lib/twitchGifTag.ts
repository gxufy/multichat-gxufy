/* Reading Twitch's native GIF tag off an IRC message. Its own module, so the
   Twitch connector and the generator import it without pulling in the
   renderer; twitchGif.tsx re-exports it. */
import { isSafeRemoteMediaUrl } from './remoteMediaUrl';
import type { TwitchGifAsset } from './types';

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
