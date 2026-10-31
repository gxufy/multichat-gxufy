/* Runtime safety net for badge and emote images that fail to load.
 *
 * Only the failed image is hidden. Logging is session-deduplicated and uses a
 * bounded source label that cannot expose credentials, query strings, fragments,
 * or data-URI payloads.
 *
 * Browser-safe: no server-only imports, secrets, retries, or network work.
 */
import type React from 'react';

const loggedUrls = new Set<string>();
const MAX_LOGGED_SOURCE_LENGTH = 200;

function boundedLabel(value: string): string {
  return value.length > MAX_LOGGED_SOURCE_LENGTH
    ? `${value.slice(0, MAX_LOGGED_SOURCE_LENGTH - 3)}...`
    : value;
}

function describeSource(src: string): string {
  if (src.startsWith('data:')) {
    const mime = /^data:([a-z0-9.+/-]{1,64})/i.exec(src)?.[1];
    return mime ? `data:${mime},<data omitted>` : 'data:<data omitted>';
  }
  if (src.startsWith('blob:')) return '<blob URL omitted>';

  const absoluteRemote = /^https?:/i.test(src);
  const protocolRelative = src.startsWith('//');
  if (absoluteRemote || protocolRelative) {
    try {
      const url = new URL(protocolRelative ? `https:${src}` : src);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '<unsupported remote source>';
      return boundedLabel(`${url.protocol}//${url.hostname}${url.pathname}`);
    } catch {
      return '<unparseable remote source>';
    }
  }

  if (!src) return '<empty source>';
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /[\u0000-\u001f\u007f]/.test(src)) {
    return '<unsupported source>';
  }
  // App-relative paths stay useful; query and fragment data never does.
  return boundedLabel(src.split(/[?#]/, 1)[0] || '<empty local source>');
}

/** `onError` for badge and emote images. */
export function handleAssetError(event: React.SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;

  // Detach first so a repeatedly failing source cannot create a retry/log loop.
  img.onerror = null;
  img.style.display = 'none';
  img.setAttribute('data-asset-failed', 'true');

  const label = describeSource(img.getAttribute('src') ?? '');
  if (!loggedUrls.has(label)) {
    loggedUrls.add(label);
    console.warn(`[overlay] hiding image that failed to load: ${label}`);
  }
}

/** Try one provider-supplied still image before applying the normal hide path. */
export function handleAssetErrorWithFallback(
  event: React.SyntheticEvent<HTMLImageElement>,
): void {
  const img = event.currentTarget;
  const fallback = img.getAttribute('data-fallback-src');
  if (fallback) {
    img.removeAttribute('data-fallback-src');
    img.setAttribute('data-asset-fallback-attempted', 'true');
    img.src = fallback;
    return;
  }
  handleAssetError(event);
}

/** Test-only reset for the session-scoped warning de-duplication set. */
export function resetAssetErrorLog(): void {
  loggedUrls.clear();
}
