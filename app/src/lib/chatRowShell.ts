/*
 * The chat row's outer box: how a row fades out, collapses after a moderator
 * delete, and is inset (web/src/lib/overlay/chat/MessageRow.svelte).
 */
import type { ParsedMessage } from './kick';
import { MESSAGE_FADE_TRANSITION_MS, MOD_DELETE_COLLAPSE_MS } from './messageFadeScheduler';

const EXIT_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EXIT_TRANSITION = [
  `grid-template-rows ${MESSAGE_FADE_TRANSITION_MS}ms ${EXIT_EASING}`,
  `opacity ${MESSAGE_FADE_TRANSITION_MS}ms ${EXIT_EASING}`,
  `transform ${MESSAGE_FADE_TRANSITION_MS}ms ${EXIT_EASING}`,
].join(', ');

/** The `.gx-message-row` style (React-style object, in its attribute order). */
export function messageRowStyle(msg: Pick<ParsedMessage, 'kind' | 'deleted'>, fading: boolean, messageShadowFilter: string) {
  /* Deleted by a moderator: the content is hidden at once (see the inner style)
     and only the empty space closes, quickly, so the rows above glide down. */
  const deleted = Boolean(msg.deleted);
  const collapsed = fading || deleted;
  const rowTransition = deleted && !fading
    ? `grid-template-rows ${MOD_DELETE_COLLAPSE_MS}ms ${EXIT_EASING}`
    : EXIT_TRANSITION;
  return {
    /* The full-width container gives ordinary rows an effective 12px left /
       4px right inset. System rows compensate on the right so their
       already-approved visual bounds do not move. */
    margin: msg.kind === 'system' ? '0 30px 0 10px' : '0 -6px 0 2px',
    display: 'grid',
    gridTemplateRows: collapsed ? '0fr' : '1fr',
    opacity: fading ? 0 : 1,
    transform: fading ? 'translate3d(0, -6px, 0)' : undefined,
    transformOrigin: 'top center',
    transition: rowTransition,
    willChange: fading
      ? 'grid-template-rows, opacity, transform'
      : deleted ? 'grid-template-rows' : undefined,
    ...(messageShadowFilter ? { filter: messageShadowFilter } : {}),
  };
}

/**
 * The `.gx-message-row-inner` style: a deleted row shows nothing from the
 * moment it is deleted. The Hype Train row lets its level-up confetti fly out
 * over the chat (it never fades or collapses).
 */
export function messageRowInnerStyle(deleted: boolean, hypeTrain = false) {
  return { minHeight: 0, overflow: hypeTrain ? 'visible' : 'hidden', ...(deleted ? { visibility: 'hidden' as const } : {}) };
}
