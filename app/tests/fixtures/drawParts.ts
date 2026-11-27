/*
 * Tests only: chat parts drawn into the document (jsdom) the way the overlay
 * inserts them, as HTML from the shared writer (lib/render/elementTree.ts).
 */
import { partsToHtml, type ChatPart } from '@/lib/render/elementTree';

export function drawParts(parts: readonly ChatPart[]): {
  container: HTMLElement;
  rerender: (next: readonly ChatPart[]) => void;
  unmount: () => void;
} {
  const container = document.createElement('div');
  container.innerHTML = partsToHtml(parts);
  document.body.append(container);
  return {
    container,
    rerender: (next) => {
      container.innerHTML = partsToHtml(next);
    },
    unmount: () => container.remove(),
  };
}

/** Everything drawn so far, gone (for an afterEach). */
export function clearDrawn(): void {
  document.body.replaceChildren();
}
