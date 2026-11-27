/*
 * The overlay's reference-weight text: every word of chat text is wrapped in a
 * glyph span (`gx-reference-glyph`, carrying the word in `data-gx-glyph` for
 * the CSS edge layer) with a foreground span inside. Media, emotes, paints and
 * other isolated pieces are left alone.
 */
import { chatElementClass, el, isChatElement, type ChatElement, type ChatPart } from './elementTree';

const MEDIA_TAGS = new Set(['audio', 'canvas', 'img', 'picture', 'source', 'svg', 'video']);

/* Class names (matched as substrings, as before) whose elements keep their text as is. */
const ISOLATED_CLASSES = [
  'ck-emote',
  'ck-mention-paint',
  'ck-name-paint',
  'ck-name-pill',
  'ck-twitch-gif',
  'ck-zw',
  'gx-emote-effect',
  'gx-event-name-paint',
];

function preserved(element: ChatElement): boolean {
  if (element.component) return true;
  if (MEDIA_TAGS.has(element.tag)) return true;
  const className = chatElementClass(element);
  if (ISOLATED_CLASSES.some((value) => className.includes(value))) return true;
  const style = element.attrs?.style;
  return Boolean(
    style
    && typeof style === 'object'
    && (
      style.WebkitBackgroundClip === 'text'
      || style.backgroundClip === 'text'
      || style.WebkitTextFillColor === 'transparent'
    ),
  );
}

function glyphWords(value: string, keyPrefix: string): ChatPart[] {
  return value
    .split(/(\s+)/u)
    .filter(Boolean)
    .map((word, index) => (/^\s+$/u.test(word)
      ? word
      : el('span', { class: 'gx-reference-glyph', 'data-gx-glyph': word }, [
        el('span', { class: 'gx-reference-glyph-foreground' }, [word]),
      ], { key: `${keyPrefix}-${index}` })));
}

/**
 * Parts with their text wrapped for reference weight. Anything that is not a
 * part is left as is.
 */
export function referenceWeightParts(parts: readonly ChatPart[], keyPrefix = 'gx-reference-text'): ChatPart[] {
  return parts.flatMap((part, index): ChatPart[] => {
    const key = `${keyPrefix}-${index}`;
    if (typeof part === 'string') return glyphWords(part, key);
    if (!isChatElement(part)) return [part];
    if (preserved(part) || !part.children?.length) return [part];
    return [{ ...part, children: referenceWeightParts(part.children, `${key}-child`) }];
  });
}
