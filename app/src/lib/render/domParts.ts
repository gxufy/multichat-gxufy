/*
 * Shared chat parts drawn straight into the DOM, for the overlay. The HTML
 * comes from partsToMarkup (byte for byte the markup React wrote for them),
 * then what HTML cannot carry is attached: each image's load-failure handler,
 * and the stateful slots (the Hype Train card, raid avatars and cheermote
 * art), which are drawn by the slot renderers below and keep their state
 * across updates.
 */
import { el, partsToMarkup, SLOT_PLACEHOLDER, type ChatComponentSlot, type ChatPart, type ImageFailure } from './elementTree';
import { handleAssetError, handleAssetErrorWithFallback, hideImageOnly, replaceImageWithAltText } from './imageFallback';
import { HypeTrainCard, TwitchEventIcon } from './chatRows';
import { activeHypeCelebration, hypeClockState, hypePercent } from './hypeTrainCard';
import type { HypeTrainEventData, TwitchCheerEventData } from '../types';

const IMAGE_FAILURE: Readonly<Record<ImageFailure, { handler: (event: Event) => void; once: boolean }>> = {
  hide: { handler: handleAssetError, once: true },
  'fallback-then-hide': { handler: handleAssetErrorWithFallback, once: false },
  'alt-text': { handler: replaceImageWithAltText, once: true },
  'display-none': { handler: hideImageOnly, once: true },
};

/** A stateful piece drawn at a slot: it owns the nodes it puts before `anchor`. */
export interface SlotRenderer {
  render(anchor: Node, props: Readonly<Record<string, unknown>>): void;
  destroy(): void;
}

/** Puts `parts` before `anchor` (with their image handlers); returns the nodes put there. */
function insertBefore(anchor: Node, parts: readonly ChatPart[]): Node[] {
  const { html, images } = partsToMarkup(parts);
  const template = document.createElement('template');
  template.innerHTML = html;
  attachImageFailures(template.content, images);
  const nodes = Array.from(template.content.childNodes);
  anchor.parentNode?.insertBefore(template.content, anchor);
  return nodes;
}

function attachImageFailures(root: ParentNode, images: readonly (ImageFailure | null)[]) {
  const found = root.querySelectorAll('img');
  images.forEach((failure, index) => {
    const image = found[index];
    if (!failure || !image) return;
    const { handler, once } = IMAGE_FAILURE[failure];
    image.addEventListener('error', handler, { once });
  });
}

/** Removes the nodes a renderer put in, wherever they are now. */
const removeAll = (nodes: Node[]) => {
  for (const node of nodes) node.parentNode?.removeChild(node);
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The Hype Train row: the shared card and its countdown, kept current each
 * second. The celebration (words crossing, confetti) comes with the data (the
 * runtime starts it as the train levels up and the card arrives as the newest
 * row); this draws it while it plays and once more when it ends. The card
 * takes its animations' phase from the clock, so a redraw restarts nothing.
 */
function hypeTrainRenderer(): SlotRenderer {
  let nodes: Node[] = [];
  let anchor: Node | null = null;
  let data: HypeTrainEventData | null = null;
  let lastShown: number | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  const draw = () => {
    if (!anchor || !data) return;
    removeAll(nodes);
    const now = Date.now();
    const reducedMotion = prefersReducedMotion();
    const celebration = reducedMotion ? null : activeHypeCelebration(data, now);
    const shown = celebration?.kind === 'level' ? 100 : hypePercent(data);
    nodes = insertBefore(anchor, [HypeTrainCard({ data, celebration, fromPercent: lastShown, now, phaseAt: now, reducedMotion })]);
    lastShown = shown;
    if (timer) clearTimeout(timer);
    timer = celebration
      ? setTimeout(() => {
          timer = null;
          draw();
        }, celebration.at + celebration.ms - now)
      : null;
  };

  /* Only the countdown's text and warmth change each second. */
  const tick = () => {
    if (!data || data.endsAt === undefined) return;
    const state = hypeClockState(data.endsAt, Date.now());
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      const clock = node.querySelector('[data-gx-hype-clock]');
      if (!clock) continue;
      const text = clock.querySelector('.gx-hype-clock-text');
      if (text && text.textContent !== state.text) text.textContent = state.text;
      if (state.heat) clock.setAttribute('data-heat', state.heat);
      else clock.removeAttribute('data-heat');
    }
  };

  const stopTicker = () => {
    if (ticker) clearInterval(ticker);
    ticker = null;
  };

  return {
    render(at, props) {
      anchor = at;
      data = props.data as HypeTrainEventData;
      draw();
      if (data.phase === 'progress' && data.endsAt !== undefined) {
        if (!ticker) ticker = setInterval(tick, 1000);
      } else {
        stopTicker();
      }
    },
    destroy() {
      if (timer) clearTimeout(timer);
      timer = null;
      stopTicker();
      removeAll(nodes);
      nodes = [];
    },
  };
}

/** The raider's avatar, giving way to the shared icon when there is none or it fails. */
function raidAvatarRenderer(): SlotRenderer {
  let nodes: Node[] = [];
  let anchor: Node | null = null;
  let src = '';
  let fallback: ChatPart = '';
  let failed = false;

  const draw = () => {
    if (!anchor) return;
    removeAll(nodes);
    if (!src || failed) {
      nodes = insertBefore(anchor, [fallback]);
      return;
    }
    nodes = insertBefore(anchor, [el('img', { class: 'gx-event-avatar gx-raid-avatar', src, alt: '', 'aria-hidden': 'true' })]);
    nodes[0]?.addEventListener('error', () => {
      failed = true;
      draw();
    }, { once: true });
  };

  return {
    render(at, props) {
      anchor = at;
      const next = String(props.src ?? '');
      if (next !== src) failed = false;
      src = next;
      fallback = props.fallback as ChatPart;
      draw();
    },
    destroy() {
      removeAll(nodes);
      nodes = [];
    },
  };
}

type CheermoteVisual = TwitchCheerEventData['cheermotes'][number] | undefined;

/** The cheermote: animated art, then the still if that fails, then the bits icon. */
function cheermoteRenderer(): SlotRenderer {
  let nodes: Node[] = [];
  let anchor: Node | null = null;
  let visual: CheermoteVisual;
  let src = '';
  let key = '';

  const draw = () => {
    if (!anchor) return;
    removeAll(nodes);
    if (!src) {
      nodes = insertBefore(anchor, [el('span', { class: 'gx-event-icon-fallback gx-cheer-art-fallback', 'aria-hidden': 'true' }, [
        TwitchEventIcon({ kind: 'bits' }),
      ])]);
      return;
    }
    nodes = insertBefore(anchor, [el('img', { src, alt: '', 'aria-hidden': 'true' })]);
    nodes[0]?.addEventListener('error', () => {
      src = visual?.staticUrl && src !== visual.staticUrl ? visual.staticUrl : '';
      draw();
    }, { once: true });
  };

  return {
    render(at, props) {
      anchor = at;
      visual = props.visual as CheermoteVisual;
      const nextKey = `${visual?.animatedUrl ?? ''}\n${visual?.staticUrl ?? ''}`;
      if (nextKey !== key) {
        key = nextKey;
        src = visual?.animatedUrl ?? visual?.staticUrl ?? '';
      }
      draw();
    },
    destroy() {
      removeAll(nodes);
      nodes = [];
    },
  };
}

export const SLOT_RENDERERS: Readonly<Record<string, () => SlotRenderer>> = {
  'hype-train': hypeTrainRenderer,
  'raid-avatar': raidAvatarRenderer,
  'cheermote-art': cheermoteRenderer,
};

/**
 * Draws parts as the content of `target` and keeps them up to date: `update`
 * redraws with new parts, reusing slot renderers of the same name at the same
 * position (so a Hype Train row keeps its celebration across updates).
 */
/*
 * Updating drawn content in place, the way React reconciles: nodes that are
 * still wanted are kept and only what changed is touched. Redrawing a row's
 * whole HTML instead re-creates every image in it: animated emotes and badges
 * restart, and an image whose art failed (hidden by its failure handler)
 * shows its empty space again until it fails again, moving the rest of the
 * line each time.
 */

/** The src each drawn image was created with (a fallback handler may change
 * src later; a later update still has to recognise the image). */
const drawnSource = new WeakMap<Element, string>();

/** Attributes a failure handler owns on an image that failed (or moved to its
 * fallback art); an update leaves them as the handler set them, as React does. */
const IMAGE_FAILURE_STATE = new Set(['src', 'style', 'data-fallback-src', 'data-asset-failed', 'data-asset-fallback-attempted']);

function noteDrawnSources(root: ParentNode) {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    if (!drawnSource.has(image)) drawnSource.set(image, image.getAttribute('src') ?? '');
  }
}

function sameNode(current: Node, wanted: Node): boolean {
  if (current.nodeType !== wanted.nodeType) return false;
  if (current.nodeType !== 1) return true;
  const a = current as Element;
  const b = wanted as Element;
  if (a.tagName !== b.tagName) return false;
  if (a.tagName === 'IMG') return (drawnSource.get(a) ?? a.getAttribute('src')) === b.getAttribute('src');
  return true;
}

function failureStateKept(current: Element, wanted: Element): boolean {
  if (current.tagName !== 'IMG') return false;
  if (current.hasAttribute('data-asset-failed') || current.hasAttribute('data-asset-fallback-attempted')) return true;
  /* hideImageOnly (avatars, Shared Chat art) only sets display: none. */
  return (current as HTMLElement).style.display === 'none'
    && !/display:\s*none/.test(wanted.getAttribute('style') ?? '');
}

function morphElement(current: Element, wanted: Element) {
  const keepFailure = failureStateKept(current, wanted);
  for (const { name } of Array.from(current.attributes)) {
    if (keepFailure && IMAGE_FAILURE_STATE.has(name)) continue;
    if (!wanted.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const { name, value } of Array.from(wanted.attributes)) {
    if (keepFailure && IMAGE_FAILURE_STATE.has(name)) continue;
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  morphChildren(current, wanted);
}

/** Makes `current`'s children match `wanted`'s, keeping matching nodes (in
 * order) and moving new ones out of `wanted`. */
function morphChildren(current: Node, wanted: Node) {
  let have = current.firstChild;
  let next = wanted.firstChild;
  while (next) {
    const following = next.nextSibling;
    if (have && sameNode(have, next)) {
      if (have.nodeType === 1) morphElement(have as Element, next as Element);
      else if (have.nodeValue !== next.nodeValue) have.nodeValue = next.nodeValue;
      have = have.nextSibling;
    } else {
      current.insertBefore(next, have);
    }
    next = following;
  }
  while (have) {
    const extra = have.nextSibling;
    current.removeChild(have);
    have = extra;
  }
}

export function mountParts(target: Element, parts: readonly ChatPart[]) {
  let slots: { name: string; renderer: SlotRenderer }[] = [];
  let drawnHtml: string | null = null;
  let anchors: Comment[] = [];

  const draw = (next: readonly ChatPart[]) => {
    const { html, slots: wanted, images } = partsToMarkup(next);
    if (html === drawnHtml && wanted.length === slots.length && wanted.every((slot, index) => slots[index]!.name === slot.name)) {
      /* Same content: keep every node; only stateful slots take new props. */
      wanted.forEach((slot, index) => slots[index]!.renderer.render(anchors[index]!, slot.props));
      return;
    }
    if (drawnHtml !== null && !wanted.length && !slots.length) {
      const template = document.createElement('template');
      template.innerHTML = html;
      attachImageFailures(template.content, images);
      morphChildren(target, template.content);
      noteDrawnSources(target);
      drawnHtml = html;
      return;
    }
    drawnHtml = html;
    target.innerHTML = html;
    attachImageFailures(target, images);
    noteDrawnSources(target);
    anchors = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node as Comment).data === SLOT_PLACEHOLDER) anchors.push(node as Comment);
    }
    const kept: typeof slots = [];
    wanted.forEach((slot: ChatComponentSlot, index) => {
      const reuse = slots[index]?.name === slot.name ? slots[index] : null;
      if (slots[index] && !reuse) slots[index].renderer.destroy();
      const factory = SLOT_RENDERERS[slot.name];
      if (!factory) throw new Error(`mountParts: no renderer for the "${slot.name}" slot`);
      const entry = reuse ?? { name: slot.name, renderer: factory() };
      entry.renderer.render(anchors[index], slot.props);
      kept.push(entry);
    });
    for (const extra of slots.slice(wanted.length)) extra.renderer.destroy();
    slots = kept;
  };

  draw(parts);
  return {
    update: draw,
    destroy() {
      for (const slot of slots) slot.renderer.destroy();
      slots = [];
      target.textContent = '';
    },
  };
}
