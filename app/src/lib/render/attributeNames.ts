/*
 * React prop names ↔ HTML/SVG attribute names, for the props chat content uses.
 * Shared parts store HTML names; JSX written for parts (lib/render/jsx) uses
 * React's names so markup can be moved between the two unchanged.
 */

/** React prop → attribute, where they differ. */
export const REACT_TO_ATTRIBUTE: Readonly<Record<string, string>> = {
  className: 'class',
  htmlFor: 'for',
  referrerPolicy: 'referrerpolicy',
  crossOrigin: 'crossorigin',
  srcSet: 'srcset',
  tabIndex: 'tabindex',
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  clipRule: 'clip-rule',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
};

/** camelCase props that are also the attribute's own spelling (SVG). */
export const CAMEL_CASE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'viewBox',
  'preserveAspectRatio',
  'pathLength',
  'gradientUnits',
  'gradientTransform',
  'patternUnits',
  'patternTransform',
]);

/* Attributes React writes as the strings "true"/"false" (enumerated, not boolean). */
const BOOLEANISH_STRING = new Set(['draggable', 'focusable', 'spellcheck', 'contenteditable', 'autocorrect']);

/**
 * An attribute value as React would write it for a boolean: "true"/"false" for
 * aria-*, data-* and the booleanish attributes; "" or nothing for true HTML
 * boolean attributes.
 */
export function attributeValueForBoolean(name: string, value: boolean): string | undefined {
  if (name.startsWith('aria-') || name.startsWith('data-') || BOOLEANISH_STRING.has(name)) return String(value);
  return value ? '' : undefined;
}
