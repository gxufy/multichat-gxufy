/*
 * A JSX runtime that builds shared chat parts (lib/render/elementTree.ts)
 * instead of React elements. A file opts in with
 *   /** @jsxImportSource ./jsx *\/   (path relative to that file)
 * so chat markup can be written as ordinary JSX, with React's prop names.
 *
 * Function components are plain functions of their props (no hooks or state);
 * anything stateful is a `component` slot each renderer fills itself.
 */
import { el, type AttributeValue, type ChatElement, type ChatPart, type ElementStyle, type ImageFailure } from '../elementTree';
import { attributeValueForBoolean, CAMEL_CASE_ATTRIBUTES, REACT_TO_ATTRIBUTE } from '../attributeNames';

export const Fragment = '';

type Child = ChatPart | number | boolean | null | undefined | readonly Child[];

/** Children flattened as React flattens them: nested lists opened, empties dropped, numbers as text. */
export function flattenChildren(children: Child, into: ChatPart[] = []): ChatPart[] {
  if (children === null || children === undefined || typeof children === 'boolean' || children === '') return into;
  if (Array.isArray(children)) {
    for (const child of children as readonly Child[]) flattenChildren(child, into);
    return into;
  }
  into.push(typeof children === 'number' ? String(children) : (children as ChatPart));
  return into;
}

function attributeName(prop: string): string {
  const mapped = REACT_TO_ATTRIBUTE[prop];
  if (mapped) return mapped;
  if (/[A-Z]/.test(prop) && !CAMEL_CASE_ATTRIBUTES.has(prop) && !prop.startsWith('data-') && !prop.startsWith('aria-')) {
    throw new Error(`Chat parts JSX: no attribute name known for the prop "${prop}"`);
  }
  return prop;
}

type Props = Record<string, unknown> & { children?: Child; $onError?: ImageFailure };

export function jsx(type: string | ((props: Props) => ChatPart | null), props: Props, key?: string | number): ChatPart {
  if (typeof type === 'function') {
    const out = type(key === undefined ? props : { ...props, key });
    return out ?? '';
  }
  const children = flattenChildren(props.children);
  if (type === Fragment) return el('', undefined, children, key === undefined ? undefined : { key });
  const attrs: Record<string, AttributeValue> = {};
  for (const [prop, value] of Object.entries(props)) {
    if (prop === 'children' || prop === '$onError' || value === undefined || value === null) continue;
    const name = attributeName(prop);
    if (typeof value === 'boolean') {
      const text = attributeValueForBoolean(name, value);
      if (text !== undefined) attrs[name] = text;
    } else if (prop === 'style') {
      attrs.style = value as ElementStyle;
    } else if (typeof value === 'string' || typeof value === 'number') {
      attrs[name] = value;
    } else {
      throw new Error(`Chat parts JSX: "${prop}" must be text, a number or a boolean`);
    }
  }
  return el(type, attrs, children, {
    ...(key !== undefined ? { key } : {}),
    ...(props.$onError ? { onError: props.$onError } : {}),
  });
}

export const jsxs = jsx;

export namespace JSX {
  export type Element = ChatPart;
  export interface ElementChildrenAttribute { children: unknown }
  export interface IntrinsicAttributes { key?: string | number }
  export interface IntrinsicElements {
    [tag: string]: Record<string, unknown> & { $onError?: ImageFailure };
  }
}

export type { ChatElement };
