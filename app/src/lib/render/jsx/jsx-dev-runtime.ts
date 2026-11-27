/* Development builds ask for jsxDEV; it is the same builder. */
export { Fragment } from './jsx-runtime';
export type { JSX } from './jsx-runtime';
import { jsx } from './jsx-runtime';

export function jsxDEV(type: Parameters<typeof jsx>[0], props: Parameters<typeof jsx>[1], key?: string | number) {
  return jsx(type, props, key);
}
