/**
 * Which 7TV emote file to download, and how much room to keep for it.
 *
 * 7TV serves every emote at 1x/2x/3x/4x (32/64/96/128 px tall). The overlay
 * draws emotes about 1.7 lines tall, so a medium chat needs roughly 58 px:
 * 2x is already sharp, and 4x would download up to several times the bytes
 * before the emote can appear. The overlay reports how tall it draws emotes
 * and this picks the smallest file that is at least that tall on screen.
 *
 * The chosen file's width and height also go on the <img>, so the browser
 * keeps the emote's exact space before the image arrives and the line never
 * widens (or re-wraps) when it loads.
 */

export type SevenTVEmoteFile = { name: string; width: number; height: number };

/** Default until an overlay reports its size: medium text, 1x emote scale. */
const DEFAULT_TARGET_PX = 58;

let targetPx = DEFAULT_TARGET_PX;

/** Called by the overlay with the on-screen emote height in CSS pixels. */
export function setSevenTVEmoteTargetHeight(px: number): void {
  if (Number.isFinite(px) && px > 0) targetPx = px;
}

export function resetSevenTVEmoteTargetHeightForTests(): void {
  targetPx = DEFAULT_TARGET_PX;
}

function screenScale(): number {
  if (typeof window === 'undefined') return 1;
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 2) : 1;
}

/** Smallest file at least as tall as the emote is drawn; otherwise the largest. */
export function pickSevenTVEmoteFile(
  files: readonly SevenTVEmoteFile[],
  drawnPx = targetPx,
): SevenTVEmoteFile | null {
  if (!files.length) return null;
  const sorted = [...files].sort((a, b) => a.height - b.height);
  const need = drawnPx * screenScale();
  return sorted.find((file) => file.height >= need * 0.97) ?? sorted[sorted.length - 1];
}

export type SevenTVEmoteSource = { src: string; width?: number; height?: number };

export function sevenTVEmoteSource(emote: {
  image: string;
  width?: number;
  height?: number;
  host?: string;
  files?: readonly SevenTVEmoteFile[];
}): SevenTVEmoteSource {
  const file = emote.host && emote.files ? pickSevenTVEmoteFile(emote.files) : null;
  if (file && emote.host) {
    return {
      src: `${emote.host}/${encodeURIComponent(file.name)}`,
      width: file.width,
      height: file.height,
    };
  }
  return {
    src: emote.image,
    width: emote.width && emote.width > 0 ? emote.width : undefined,
    height: emote.height && emote.height > 0 ? emote.height : undefined,
  };
}
