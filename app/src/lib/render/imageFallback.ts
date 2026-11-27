/* Runtime safety net for badge and emote images that fail to load.
 *
 * Only the failed image is hidden. Logging is session-deduplicated and uses a
 * bounded source label that cannot expose credentials, query strings, fragments,
 * or data-URI payloads.
 *
 * Browser-safe: no server-only imports, secrets, retries, or network work.
 */
/** What the handlers read: the failed image (a DOM event bound to the image). */
type ImageEvent = { currentTarget: HTMLImageElement } | { readonly currentTarget: EventTarget | null };

const imageOf = (event: ImageEvent) => event.currentTarget as HTMLImageElement;

const loggedUrls = new Set<string>();
const MAX_LOGGED_SOURCE_LENGTH = 200;

/*
 * Image addresses that failed to load recently (this page, bounded). Rows drawn
 * later leave known-broken badge art out (renderCore's badgeImg), so a new
 * message or a redrawn row never shows the broken art's space for a moment
 * and then jumps when the art fails again. An entry expires, so a source that
 * failed once on a network blip is tried again later.
 */
const failedImages = new Map<string, number>();
const MAX_FAILED_IMAGES = 500;
export const FAILED_IMAGE_MEMORY_MS = 10 * 60_000;

function rememberFailedImage(src: string | null): void {
  if (!src) return;
  failedImages.delete(src);
  if (failedImages.size >= MAX_FAILED_IMAGES) {
    const oldest = failedImages.keys().next().value;
    if (oldest !== undefined) failedImages.delete(oldest);
  }
  failedImages.set(src, Date.now());
}

/** Whether this image address failed to load in the last FAILED_IMAGE_MEMORY_MS. */
export function imageKnownToFail(src: string | undefined, now = Date.now()): boolean {
  if (!src) return false;
  const at = failedImages.get(src);
  if (at === undefined) return false;
  if (now - at < FAILED_IMAGE_MEMORY_MS) return true;
  failedImages.delete(src);
  return false;
}

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
export function handleAssetError(event: ImageEvent): void {
  const img = imageOf(event);

  // Detach first so a repeatedly failing source cannot create a retry/log loop.
  img.onerror = null;
  img.style.display = 'none';
  img.setAttribute('data-asset-failed', 'true');
  rememberFailedImage(img.getAttribute('src'));

  const label = describeSource(img.getAttribute('src') ?? '');
  if (!loggedUrls.has(label)) {
    loggedUrls.add(label);
    console.warn(`[overlay] hiding image that failed to load: ${label}`);
  }
}

/** Try one provider-supplied still image before applying the normal hide path. */
export function handleAssetErrorWithFallback(
  event: ImageEvent,
): void {
  const img = imageOf(event);
  const fallback = img.getAttribute('data-fallback-src');
  if (fallback) {
    rememberFailedImage(img.getAttribute('src'));
    img.removeAttribute('data-fallback-src');
    img.setAttribute('data-asset-fallback-attempted', 'true');
    img.src = fallback;
    return;
  }
  handleAssetError(event);
}

/** For emoji images (Twemoji): a failed one becomes its own character again. */
export function replaceImageWithAltText(event: ImageEvent): void {
  const img = imageOf(event);
  const parent = img.parentNode;
  if (parent) parent.replaceChild(document.createTextNode(img.alt), img);
}

/** A failed image only stops being displayed (avatars, Shared Chat source art). */
export function hideImageOnly(event: ImageEvent): void {
  imageOf(event).style.display = 'none';
}

/** Test-only reset for the session-scoped warning de-duplication set. */
export function resetAssetErrorLog(): void {
  loggedUrls.clear();
  failedImages.clear();
}
