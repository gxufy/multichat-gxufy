/*
 * Chat content as plain data: the elements a message, its badges or a source
 * tag draw, described without any UI framework. The shared message builders
 * (renderCore, multichatMessageModel, twitchGif) produce these and the
 * overlay draws them (domParts.ts).
 *
 * Attribute names are HTML's (`class`, `referrerpolicy`, `data-*`). Their
 * order is kept and is the order the DOM gets them in; `style` is one of them,
 * written as a React-style object (camelCase names, values as React takes
 * them). An image's `onError` names what happens when it fails to load.
 */

export type ElementStyle = Readonly<Record<string, string | number | undefined>>;
export type AttributeValue = string | number | ElementStyle | undefined;

/**
 * What a failed image does: hide itself (marked failed), try its
 * `data-fallback-src` first, become its alt text, or only stop being displayed.
 */
export type ImageFailure = 'hide' | 'fallback-then-hide' | 'alt-text' | 'display-none';

/** A stateful piece each renderer draws with its own component (e.g. the Hype Train row). */
export interface ChatComponentSlot {
  readonly name: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface ChatElement {
  readonly $el: true;
  /** An HTML or SVG tag; '' is a fragment (its children, no element of its own). */
  readonly tag: string;
  readonly key?: string | number;
  readonly attrs?: Readonly<Record<string, AttributeValue>>;
  readonly onError?: ImageFailure;
  readonly children?: readonly ChatPart[];
  /** Set on a slot (tag ''): drawn by the renderer's own component of this name. */
  readonly component?: ChatComponentSlot;
}

export type ChatPart = string | ChatElement;

export function el(
  tag: string,
  attrs?: ChatElement['attrs'],
  children?: readonly ChatPart[],
  options?: { key?: string | number; onError?: ImageFailure },
): ChatElement {
  return {
    $el: true,
    tag,
    ...(options?.key !== undefined ? { key: options.key } : {}),
    ...(attrs ? { attrs } : {}),
    ...(options?.onError ? { onError: options.onError } : {}),
    ...(children && children.length ? { children } : {}),
  };
}

export function fragment(key: string | number, children: readonly ChatPart[]): ChatElement {
  return el('', undefined, children, { key });
}

/** A slot for a stateful piece; each renderer supplies the component for `name`. */
export function componentSlot(name: string, props: Readonly<Record<string, unknown>>, key?: string | number): ChatElement {
  return { $el: true, tag: '', ...(key !== undefined ? { key } : {}), component: { name, props } };
}

export function isChatElement(value: unknown): value is ChatElement {
  return typeof value === 'object' && value !== null && (value as { $el?: unknown }).$el === true;
}

/** The element's class list as written (empty when it has none). */
export function chatElementClass(element: ChatElement): string {
  const value = element.attrs?.class;
  return typeof value === 'string' ? value : '';
}

/* React's unitless style properties (react-dom's isUnitlessNumber), for
   serializing numbers exactly as React does. */
const UNITLESS = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth',
  'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount', 'columns', 'flex', 'flexGrow',
  'flexPositive', 'flexShrink', 'flexNegative', 'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd',
  'gridRowSpan', 'gridRowStart', 'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart',
  'fontWeight', 'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'scale', 'tabSize', 'widows',
  'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray',
  'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth',
]);

/**
 * A style object as CSS declarations, the way React writes it: camelCase to
 * kebab-case (vendor prefixes included), numbers get `px` unless unitless,
 * empty values left out. For renderers that set a style attribute directly.
 */
export function styleText(style: ElementStyle | undefined): string {
  if (!style) return '';
  const out: string[] = [];
  for (const [name, value] of Object.entries(style)) {
    if (value === undefined || value === null || value === '' || typeof value === 'boolean') continue;
    const property = name.startsWith('--')
      ? name
      : name
        .replace(/^(Webkit|Moz|ms|O)(?=[A-Z])/, (prefix) => `-${prefix.toLowerCase()}`)
        .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const text = typeof value === 'number' && value !== 0 && !UNITLESS.has(name) && !name.startsWith('--')
      ? `${value}px`
      : String(value).trim();
    out.push(`${property}: ${text};`);
  }
  return out.join(' ');
}

/* ------------------------------------------------------------------ */
/* As HTML                                                             */
/* ------------------------------------------------------------------ */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Escaped the way React's server renderer escapes text and attribute values. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&#x27;'
  ));
}

/** Style attribute text in React's server format ("a:b;c:d"). */
function styleAttribute(style: ElementStyle): string {
  return styleText(style).split('; ').map((declaration) => declaration.replace(/;$/, '').replace(': ', ':')).filter(Boolean).join(';');
}

/** What writing HTML collected: slots (in placeholder order) and each image's failure (in document order). */
type MarkupContext = { slots: ChatComponentSlot[]; images: (ImageFailure | null)[] } | null;

/** The placeholder a slot is written as: a comment, so it adds no element. */
export const SLOT_PLACEHOLDER = 'gx-slot';

function elementHtml(element: ChatElement, context: MarkupContext): string {
  if (element.component) {
    if (!context) throw new Error(`partsToHtml: the "${element.component.name}" component has no HTML form`);
    context.slots.push(element.component);
    return `<!--${SLOT_PLACEHOLDER}-->`;
  }
  if (context && element.tag === 'img') context.images.push(element.onError ?? null);
  const inner = (element.children ?? []).map((child) => partHtml(child, context)).join('');
  if (element.tag === '') return inner;
  let open = `<${element.tag}`;
  for (const [name, value] of Object.entries(element.attrs ?? {})) {
    if (value === undefined) continue;
    const text = typeof value === 'object' ? styleAttribute(value) : String(value);
    if (typeof value === 'object' && !text) continue;
    open += ` ${name}="${escapeHtml(text)}"`;
  }
  return VOID_TAGS.has(element.tag) ? `${open}/>` : `${open}>${inner}</${element.tag}>`;
}

function partHtml(part: ChatPart, context: MarkupContext = null): string {
  return typeof part === 'string' ? escapeHtml(part) : elementHtml(part, context);
}

/**
 * Parts as an HTML string, byte-for-byte what React's server renderer wrote
 * for the same parts (tests hold that markup). For renderers that insert
 * HTML; image failures are then handled by `imageFailureFor` from one listener.
 */
export function partsToHtml(parts: readonly ChatPart[]): string {
  return parts.map((part) => partHtml(part)).join('');
}

/**
 * Parts as HTML for a renderer that inserts HTML and then attaches what HTML
 * cannot carry: each slot is a `<!--gx-slot-->` comment (filled, in order,
 * from `slots`), and `images[i]` is what the i-th <img> of the inserted HTML
 * (document order, slots not yet filled) does when it fails to load.
 */
export function partsToMarkup(parts: readonly ChatPart[]): {
  html: string;
  slots: ChatComponentSlot[];
  images: (ImageFailure | null)[];
} {
  const context = { slots: [] as ChatComponentSlot[], images: [] as (ImageFailure | null)[] };
  const html = parts.map((part) => partHtml(part, context)).join('');
  return { html, ...context };
}

/**
 * What a failed image in chat content should do, read from the image itself
 * (for content inserted as HTML, which carries no handlers): the same choice
 * the builders attach as `onError`. Null for images that have none (platform
 * icons).
 */
export function imageFailureFor(image: { getAttribute(name: string): string | null }): ImageFailure | null {
  const classes = ` ${image.getAttribute('class') ?? ''} `;
  if (classes.includes(' ck-twemoji ')) return 'alt-text';
  if (image.getAttribute('data-fallback-src') !== null) return 'fallback-then-hide';
  if (/ (ck-emote|ck-badge-img|ck-twitch-gif) /.test(classes)) return 'hide';
  return null;
}
