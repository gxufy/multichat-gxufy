/* Custom preview messages: the generator's own text, in the real renderer.
 *
 * This produces a `UnifiedMessage` — the plain-data model the connectors emit —
 * and nothing else. It deliberately does not build React nodes: a composer that
 * assembled its own `<img>` badges and coloured `<strong>` mentions would be a
 * second renderer, and the settings applied during conversion (mention colour,
 * 7TV emotes, 7TV cosmetics, paint shadows) would not touch its output. Handing
 * back a normalized message means a composed line goes through
 * `buildParsedMessage` exactly like a fixture and exactly like a live message,
 * so all twenty-four settings reach it for free.
 *
 * Nothing here is sent anywhere. There is no provider call, no socket write, no
 * fetch: composing appends to an array of preview messages held in generator
 * state, and that array is never serialized into an overlay URL or a draft.
 *
 * Ids come from a caller-supplied counter rather than `Date.now()` or
 * `Math.random()`, so composing is deterministic and a test can assert the exact
 * id. The counter only ever increases, so two composed messages cannot collide
 * on a React key even if their name and text are identical.
 */
import type { Platform, UnifiedMessage } from '@/lib/types';
import { SAMPLE_EPOCH } from './samples';

/** Fields the composer collects. Everything else is derived. */
export type PreviewMessageDraft = {
  platform: Platform;
  username: string;
  text: string;
};

/* Caps, applied on the way in rather than trusted from the control. The input
   maxLength stops a paste in the browser; this stops anything else, including a
   caller in a test. Twitch's own display-name limit is 25, and a chat message
   longer than this wraps past the height of the preview surface anyway. */
export const PREVIEW_NAME_MAX = 25;
export const PREVIEW_TEXT_MAX = 500;

/** Shown when the name field is left blank. */
export const PREVIEW_FALLBACK_NAME = 'your_name';

/* Composed messages start after the fixtures so the preview reads as one
   conversation in time order rather than jumping backwards. The gap is an hour:
   large enough that no plausible number of fixtures reaches it. */
const COMPOSED_EPOCH = SAMPLE_EPOCH + 3_600_000;

/**
 * Is this draft worth adding?
 *
 * Blank and whitespace-only text does not compose: the message body is the whole
 * point of the control, and a line reading "your message text" teaches nothing
 * that the built-in samples do not already show. A blank *name* is fine — that
 * one has a sensible default.
 */
export function canComposePreviewMessage(draft: PreviewMessageDraft): boolean {
  return draft.text.trim().length > 0;
}

/**
 * Build a preview message from the composer's fields.
 *
 * `seq` must be unique per message within a preview list; the generator keeps a
 * monotonic counter. Exported separately from the control so the tests can
 * assert the produced model rather than scraping markup for it.
 */
export function composePreviewMessage(
  draft: PreviewMessageDraft,
  seq: number,
): UnifiedMessage {
  /* Trimmed, then capped by codepoint rather than by UTF-16 unit: slicing a
     string at 500 can land between a surrogate pair and produce a lone
     surrogate, which is exactly the kind of text that renders as a replacement
     character. Array.from splits on codepoints. */
  const text = Array.from(draft.text.trim()).slice(0, PREVIEW_TEXT_MAX).join('');
  const named = Array.from(draft.username.trim()).slice(0, PREVIEW_NAME_MAX).join('');

  return {
    platform: draft.platform,
    /* Namespaced so a composed id can never be mistaken for a fixture id, and
       specifically can never equal SAMPLE_PIN_ID — only that one id is
       pin-eligible, so a composed message cannot hijack the pin card. */
    id: `custom-${seq}`,
    /* Stable and unique: `fallbackColor` derives a name colour from platform,
       username, and sender id, so a fixed sender id keeps a composed message
       the same colour every time it is rendered. It matches no 7TV entitlement,
       which is correct — the paint sample is the fixture that demonstrates
       paints. */
    senderId: `custom-${seq}`,
    username: named || PREVIEW_FALLBACK_NAME,
    /* Empty, so the renderer picks the platform-appropriate fallback colour
       instead of this file inventing one. */
    color: '',
    /* No badges. The fixtures already demonstrate every platform's badge art
       through the real lookup tables, and a badge picker here would make the
       card taller for something already on screen. */
    badges: [],
    /* Stored verbatim. Angle brackets and quotes are text: React escapes them
       when it renders a string child, so "<script>alert(1)</script>" appears on
       screen as those characters and never as an element. Sanitizing here would
       be the wrong fix in the wrong place — it would also silently rewrite
       somebody's perfectly innocent "5 < 10". */
    text,
    /* None: platform emote offsets only exist for a real platform payload.
       Third-party emote words still resolve, because `renderMessageText` swaps
       7TV emotes out of the text gaps for kick and twitch — so typing OMEGALUL
       into a Kick preview message shows the emote. */
    emotes: [],
    timestamp: COMPOSED_EPOCH + seq * 1000,
    kind: 'chat',
  };
}
