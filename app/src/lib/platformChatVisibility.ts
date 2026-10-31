import type { Platform } from './types';

export type PlatformTaggedMessage = {
  platform?: Platform;
};

export type PlatformChatStores<T extends PlatformTaggedMessage> = {
  /** Canonical messages retained by the overlay runtime. */
  backing: readonly T[];
  /** Rows waiting for the next browser-paint presentation flush. */
  pending: readonly T[];
  /** Rows already handed to ChatOverlay / currently eligible to be on screen. */
  presented: readonly T[];
};

export type PurgedPlatformChatStores<T extends PlatformTaggedMessage> = {
  backing: T[];
  pending: T[];
  presented: T[];
};

/**
 * Remove one platform from every chat-presentation layer in one synchronous step.
 *
 * Platform `off` commands are runtime visibility controls, not connector stops:
 * the connector remains alive so its own moderator/broadcaster can issue the
 * matching `on` command later. That means hiding cannot rely only on filtering the
 * canonical backing array. A row can already exist in the presented cache or be
 * waiting in the next-paint ingress queue, and either cache can otherwise keep/re-add
 * the supposedly hidden platform after the command runs.
 */
export function purgePlatformChat<T extends PlatformTaggedMessage>(
  stores: PlatformChatStores<T>,
  platform: Platform,
): PurgedPlatformChatStores<T> {
  const keep = (message: T) => message.platform !== platform;
  return {
    backing: stores.backing.filter(keep),
    pending: stores.pending.filter(keep),
    presented: stores.presented.filter(keep),
  };
}

const DOM_HIDDEN_ATTR = 'data-gx-runtime-platform-hidden';
const DOM_PREVIOUS_DISPLAY_ATTR = 'data-gx-runtime-previous-display';
const PLATFORM_MARKER_ATTR = 'data-chat-platform';
const hiddenDomPlatforms = new Set<Platform>();
let observer: MutationObserver | null = null;
let observedContainer: HTMLElement | null = null;

function platformFromRow(row: HTMLElement): Platform | null {
  const marker = row.querySelector<HTMLElement>(`[${PLATFORM_MARKER_ATTR}]`);
  const platform = marker?.getAttribute(PLATFORM_MARKER_ATTR) ?? '';
  return platform === 'kick' || platform === 'twitch' || platform === 'youtube' || platform === 'tiktok'
    ? platform
    : null;
}

function hideRow(row: HTMLElement, platform: Platform): void {
  if (row.getAttribute(DOM_HIDDEN_ATTR) === platform && row.style.display === 'none') return;
  if (!row.hasAttribute(DOM_HIDDEN_ATTR)) {
    row.setAttribute(DOM_PREVIOUS_DISPLAY_ATTR, row.style.display || '');
  }
  row.setAttribute(DOM_HIDDEN_ATTR, platform);
  row.style.setProperty('display', 'none', 'important');
}

function restoreRow(row: HTMLElement, platform: Platform): void {
  if (row.getAttribute(DOM_HIDDEN_ATTR) !== platform) return;
  const previousDisplay = row.getAttribute(DOM_PREVIOUS_DISPLAY_ATTR) ?? '';
  row.style.removeProperty('display');
  if (previousDisplay) row.style.display = previousDisplay;
  row.removeAttribute(DOM_HIDDEN_ATTR);
  row.removeAttribute(DOM_PREVIOUS_DISPLAY_ATTR);
}

function applyDomVisibility(root: ParentNode = document): void {
  const rows = root.querySelectorAll<HTMLElement>('.gx-message-row');
  for (const row of rows) {
    const platform = platformFromRow(row);
    if (!platform) continue;
    if (hiddenDomPlatforms.has(platform)) hideRow(row, platform);
    else restoreRow(row, platform);
  }
}

function ensureObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const container = document.getElementById('chat_container');
  if (!container) return;
  if (observer && observedContainer === container) return;
  observer?.disconnect();
  observedContainer = container;
  observer = new MutationObserver(() => applyDomVisibility(container));
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });
}

/**
 * Immediate visual guard for the runtime `kickoff`/`twitchoff`/`youtubeoff`/
 * `tiktokoff` commands.
 *
 * The overlay's canonical runtime still owns the real filtering and connector
 * behavior. This layer exists because OBS/Chromium may delay the React/rAF
 * reconciliation that removes an already-presented row. Hiding the tagged DOM row
 * in the same command turn makes the command visibly immediate, while the existing
 * backing-state filter prevents future messages from being added.
 */
export function setPlatformChatDomVisible(platform: Platform, visible: boolean): void {
  if (typeof document === 'undefined') return;
  if (visible) hiddenDomPlatforms.delete(platform);
  else hiddenDomPlatforms.add(platform);
  ensureObserver();
  applyDomVisibility(document);
  if (hiddenDomPlatforms.size === 0) {
    observer?.disconnect();
    observer = null;
    observedContainer = null;
  }
}

/** Test-only reset so one jsdom case cannot leak hidden platforms into another. */
export function resetPlatformChatDomVisibility(): void {
  if (typeof document !== 'undefined') {
    for (const platform of ['kick', 'twitch', 'youtube', 'tiktok'] as const) {
      hiddenDomPlatforms.delete(platform);
      applyDomVisibility(document);
    }
  } else {
    hiddenDomPlatforms.clear();
  }
  observer?.disconnect();
  observer = null;
  observedContainer = null;
}
