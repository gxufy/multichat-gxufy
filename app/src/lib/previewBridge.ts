/*
 * The generator's preview bridge.
 *
 * The SvelteKit generator draws its Preview Data with the production overlay
 * renderers, in two small same-origin pages embedded as iframes, so each
 * preview is a real overlay document with the same page-wide styles OBS gets:
 *
 *   /preview-frame/chat     the chat renderer
 *   /preview-frame/viewers  the viewer-count renderer
 *
 * The site serves both (web/src/lib/generator/frames).
 *
 * The generator owns every bit of state (settings, the sample feed, cosmetics,
 * sample or live counts) and posts it to the frame; the frame only renders.
 * A frame page never connects to a chat service or polls, and it accepts
 * messages only from its parent window on its own origin.
 *
 * The frame paths avoid the word "counter": content blockers have blocked
 * nested `/counter` frames before (see LiveCounterPreview).
 *
 * Plain module, imported by both apps.
 */
import type { MessageCosmetics } from './messageCosmetics';
import type { UnifiedMessage } from './types';
import type { PlatformStatuses } from './viewerCounterConfig';

export const PREVIEW_FRAME_PATHS = {
  chat: '/preview-frame/chat',
  viewers: '/preview-frame/viewers',
} as const;

export type PreviewFrameKind = keyof typeof PREVIEW_FRAME_PATHS;

/** Frame → generator, once the frame listens. The generator then sends everything. */
export const PREVIEW_FRAME_READY = 'flosschat-preview:ready';

/** Generator → chat frame. Any field left out keeps its last value. */
export type ChatPreviewUpdate = {
  type: 'flosschat-preview:chat';
  query?: string;
  messages?: readonly UnifiedMessage[];
  cosmetics?: MessageCosmetics;
};

/** Generator → viewers frame. Any field left out keeps its last value. */
export type ViewersPreviewUpdate = {
  type: 'flosschat-preview:viewers';
  query?: string;
  statuses?: PlatformStatuses;
};

export type PreviewFrameReady = { type: typeof PREVIEW_FRAME_READY; kind: PreviewFrameKind };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPreviewFrameReady(value: unknown, kind: PreviewFrameKind): value is PreviewFrameReady {
  return isRecord(value) && value.type === PREVIEW_FRAME_READY && value.kind === kind;
}

export function isChatPreviewUpdate(value: unknown): value is ChatPreviewUpdate {
  if (!isRecord(value) || value.type !== 'flosschat-preview:chat') return false;
  if (value.query !== undefined && typeof value.query !== 'string') return false;
  if (value.messages !== undefined && !Array.isArray(value.messages)) return false;
  if (value.cosmetics !== undefined && !isRecord(value.cosmetics)) return false;
  return true;
}

export function isViewersPreviewUpdate(value: unknown): value is ViewersPreviewUpdate {
  if (!isRecord(value) || value.type !== 'flosschat-preview:viewers') return false;
  if (value.query !== undefined && typeof value.query !== 'string') return false;
  if (value.statuses !== undefined && !isRecord(value.statuses)) return false;
  return true;
}

/**
 * Whether a message event really comes from this frame's parent on the same
 * origin. Everything else (other windows, other sites, extensions) is ignored.
 */
export function fromSameOriginParent(event: Pick<MessageEvent, 'origin' | 'source'>, win: Window): boolean {
  return event.origin === win.location.origin && event.source !== null && event.source === win.parent && win.parent !== win;
}
