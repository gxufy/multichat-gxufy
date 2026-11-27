/*
 * How the chat overlay groups arriving rows into render batches (each batch
 * slides, fades or just appears as one), and the Slide timing.
 */
import type { ParsedMessage } from './kick';
import {
  getRuntimeAnimationMode,
  runtimeEntranceAnimationEnabled,
  runtimeSlideChatFast,
} from './multichatAnimationRuntime';
import { runtimeSlideSuppressed } from './multichatPerformanceRuntime';

/**
 * Slide's move: a spring with no bounce. The rows above glide up by the new
 * batch's height quickly and ease into place: half the way in about 30 ms,
 * 90% in about 90 ms, settled in 170-250 ms. restDelta/restSpeed end it
 * within half a pixel.
 */
export const SLIDE_HEIGHT_SPRING = {
  type: 'spring' as const,
  stiffness: 1200,
  damping: 50,
  mass: 0.3,
  restDelta: 0.5,
  restSpeed: 10,
};

/**
 * Slide in auto mode follows chat speed (runtimeSlideChatFast: messages per
 * second over the last second, with separate on and off thresholds so it does
 * not flip back and forth). While chat is not fast, every batch slides as a
 * whole, except a single batch bigger than this, which appears instantly.
 */
export const SLIDE_MAX_BATCH_ROWS = 7;

/** Longest a sliding batch waits for its not-yet-loaded images before it is
 * measured (see SlideGroup). */
export const SLIDE_IMAGE_WAIT_MS = 90;

export type RenderBatch = {
  id: number;
  messageIds: string[];
  /** Entrance effects (left/right entrance, Fade); off while chat is fast. */
  animate: boolean;
  /** Slide for this batch: the whole batch slides in one spring move when it
   *  holds up to SLIDE_MAX_BATCH_ROWS messages; a bigger batch appears
   *  instantly. */
  slide: boolean;
};

export type RenderBatchTracker = { update(messages: readonly ParsedMessage[]): RenderBatch[] };

/**
 * One overlay's batches. Each update is the rows on screen now: rows seen for
 * the first time form one new batch (the whole presentation tick arrives
 * together), gone rows leave their batches, and batches keep their identity
 * across repaint-only updates.
 */
export function createRenderBatchTracker(): RenderBatchTracker {
  const state: { sequence: number; seen: Set<string>; batches: RenderBatch[] } = {
    sequence: 0,
    seen: new Set<string>(),
    batches: [],
  };
  return {
    update(messages) {
      const liveIds = new Set(messages.map((message) => message.id));
      let next = state.batches
        .map((batch) => ({ ...batch, messageIds: batch.messageIds.filter((id) => liveIds.has(id)) }))
        .filter((batch) => batch.messageIds.length > 0);

      const newMessages = messages.filter((message) => !state.seen.has(message.id));
      const newMessageIds = newMessages.map((message) => message.id);
      for (const id of newMessageIds) state.seen.add(id);

      if (newMessageIds.length) {
        /* A restored/history row is stamped at its immutable message identity.
           Keep the complete parent commit in one batch, but fail closed for the
           batch's entrance if it contains any row that must never replay one. */
        const fresh = newMessages.every((message) => !message.suppressEntryAnimation);
        const animate = fresh && runtimeEntranceAnimationEnabled();
        const mode = getRuntimeAnimationMode();
        /* Auto slides while chat is not fast. Fast chat, an oversized single
           batch, or a browser that keeps dropping frames shows it instantly. */
        const slide = fresh && (
          mode === 'on'
          || (
            mode === 'auto'
            && !runtimeSlideChatFast()
            && newMessageIds.length <= SLIDE_MAX_BATCH_ROWS
            && !runtimeSlideSuppressed()
          )
        );
        next = [...next, {
          id: ++state.sequence,
          messageIds: newMessageIds,
          animate,
          slide,
        }];
      }

      if (state.seen.size > 500) state.seen = new Set(liveIds);
      let total = next.reduce((sum, batch) => sum + batch.messageIds.length, 0);
      while (total > 100 && next.length) {
        total -= next[0].messageIds.length;
        next.shift();
      }
      state.batches = next;
      return next;
    },
  };
}
