/* IsolatedPreviewFrame — a production overlay renderer, in its own document.
 *
 * WHY THIS EXISTS
 *
 * The overlay renderers are written to own a whole browser source, and they say
 * so in CSS. `components/ChatOverlay` emits, through `next/head`:
 *
 *   html, body { margin:0 !important; padding:0 !important; overflow:hidden
 *                !important; height:100vh !important; position:relative
 *                !important; background:<bgColor> !important; }
 *   #__next    { position:static !important; height:0 !important; }
 *
 * plus `#chat_container { position:absolute; bottom:0 }`, a pin banner at
 * `position:absolute; top:0; left:0; right:0; z-index:10`, a loader at
 * `z-index:100`, and a slide-measuring div at `position:fixed; top:-9999px`.
 *
 * Every one of those is correct in OBS and catastrophic in the generator. Mounted
 * into the generator's own document they retarget the *page*: `next/head` hoists
 * the reset into the real <head>, so the dark Classic background is replaced by
 * the overlay's transparent one, `#__next` collapses to zero height, and the
 * absolutely positioned chat and pin layers — no longer having any positioned
 * ancestor, because the reset makes <body> the containing block — anchor to the
 * viewport and paint across the channels card, the settings, and the counter.
 *
 * None of that is a bug in the renderers. It is a bug in asking them to share a
 * document. So they no longer share one.
 *
 * HOW
 *
 * An iframe with no `src`, its document written locally, and the real renderer
 * portalled into its <body>. React stays in the parent — one tree, one
 * reconciler, ordinary props — so this is not a second renderer, a second
 * serializer, or a copy of anything. It is the same component tree with a
 * different document at the bottom of it.
 *
 * The frame never navigates. There is no `src`, so there is no provider socket,
 * no pin poll, no viewer fetch, and no OAuth — which is the other reason not to
 * simply point an iframe at the real overlay URL for fixture previews.
 *
 * THE next/head PROBLEM
 *
 * A portal moves DOM, not React context. `<Head>` inside the portalled tree
 * still resolves the *page's* head manager and would still write to the parent
 * document — the escape this component exists to prevent. So the frame supplies
 * its own head manager over the portalled subtree, collecting what the renderer
 * asks for and rendering it into the frame's own <head> through a second portal.
 *
 * That is a deep import of a Next internal, and it is deliberate: the head
 * manager is a plain React context, and matching its identity is the only way to
 * intercept it. Next is a pinned dependency here, and if the path ever moves the
 * override silently stops working — so the containment test asserts the parent
 * document receives no overlay reset, which is exactly the symptom that would
 * return.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';

/**
 * The frame's own baseline reset.
 *
 * Deliberately minimal: it establishes the same starting point an overlay route's
 * document gives (no margin, no scrollbars, transparent) and nothing else. The
 * renderer's own rules arrive through the head portal and win, exactly as they do
 * in OBS.
 *
 * `<base>` is what makes relative URLs work in a document whose own URL is
 * `about:blank` — the counter's `/fonts/DejaVuSans-Bold.ttf` @font-face and the
 * chat overlay's Google Fonts @import both resolve against it.
 */
function frameSkeleton(origin: string): string {
  return (
    '<!DOCTYPE html><html><head>' +
    `<base href="${origin}/">` +
    '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;' +
    'background:transparent;}</style>' +
    '</head><body></body></html>'
  );
}

/**
 * The preview-only zoom steps, as percentages.
 *
 * These belong to the frame rather than to any tool's settings, because that is
 * exactly what they are: a property of how large the preview *surface* is drawn,
 * with no counterpart in the overlay configuration and no route to a generated
 * URL. Nothing here is serialized, and `textSize` is untouched — a visitor who
 * wants smaller text in OBS still has the real setting for it.
 */
export const PREVIEW_SCALES = [65, 75, 85, 100] as const;

export type PreviewScale = (typeof PREVIEW_SCALES)[number];

/**
 * 75%, deliberately not 100%.
 *
 * At full size the canonical 680×280 chat source fits very few lines, so the
 * preview showed a handful of messages and told a visitor little about density,
 * filters, or how a long backlog actually reads. Three quarters fits roughly
 * twice as many while staying legible.
 */
export const PREVIEW_SCALE_DEFAULT: PreviewScale = 75;

export default function IsolatedPreviewFrame({
  title,
  width,
  height,
  scale = 100,
  children,
  testId,
}: {
  /** Accessible iframe title. Announced instead of the frame's contents. */
  title: string;
  /** Canonical OBS width, used for the aspect ratio only — not a pixel width. */
  width: number;
  /** Canonical OBS height, used for the aspect ratio only. */
  height: number;
  /**
   * Preview-only zoom, as a percentage. 100 draws the surface at the ratio's own
   * size; anything smaller enlarges the frame's internal viewport and scales it
   * back down, so more content fits without the renderer being told anything.
   */
  scale?: number;
  /** The production renderer to mount inside the frame. */
  children: ReactNode;
  testId?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  /* The zoom as a multiplier, clamped. Clamped rather than trusted because a
     stray 0 would divide by zero into an infinite width, and a value above 1
     would make the frame smaller than its box and leave a gap — neither is worth
     a runtime surprise for a prop only this file's own control ever sets. */
  const factor = Math.min(1, Math.max(0.25, scale / 100));

  /* The frame's document nodes, once written. Null until then, which is why the
     portals below are conditional: there is no document to portal into on the
     first render pass, and the renderer must not mount into the parent even for
     one commit. */
  const [target, setTarget] = useState<{ head: HTMLElement; body: HTMLElement } | null>(
    null,
  );

  /* Whatever the renderer put in `<Head>`, waiting to go into the frame's head. */
  const [headChildren, setHeadChildren] = useState<ReactNode[]>([]);

  /* Next's SideEffect keeps its mounted <Head> instances in this Set and stashes a
     pending flush on the object, so both have to be real. Identity is stable
     across renders: a fresh object every render would make SideEffect treat the
     manager as new and re-register on every keystroke. */
  const headManager = useMemo(
    () => ({
      mountedInstances: new Set<unknown>(),
      updateHead: (head: ReactNode[]) => setHeadChildren(head),
    }),
    [],
  );

  useEffect(() => {
    const frame = frameRef.current;
    /* contentDocument is null only for a cross-origin frame. This one has no src
        and is same-origin by construction, so a null here means the environment
        does not implement frames at all — render nothing rather than throw. */
    const doc = frame?.contentDocument;
    if (!doc) return;

    /* open/write/close rather than srcDoc: it is synchronous, so the document is
       ready in this same effect with no load event to race, and it works
       identically in jsdom. The written skeleton replaces whatever blank document
       the browser made. */
    doc.open();
    doc.write(frameSkeleton(window.location.origin));
    doc.close();

    setTarget({ head: doc.head, body: doc.body });

    return () => {
      /* Dropping the target unmounts both portals, so React runs the renderer's
         own cleanup — PinBanner's two timers, RollingCount's animation frame,
         SlideGroup's timeout — before the frame's document goes away. Clearing the
         collected head entries with it means a remount starts from the skeleton
         rather than re-applying a previous config's rules. */
      setTarget(null);
      setHeadChildren([]);
    };
  }, []);

  return (
    <div
      /* The canonical browser-source shape, as a ratio rather than fixed pixels:
         the card decides the width, and the frame keeps the proportions the OBS
         source will have. Everything the renderer paints is inside this box —
         `position:fixed` included, because an iframe is its own viewport. */
      style={{ width: '100%', aspectRatio: `${width} / ${height}`, overflow: 'hidden' }}
      data-preview-ratio={`${width}/${height}`}
      data-testid={testId}
    >
      <iframe
        ref={frameRef}
        title={title}
        /* No src, ever. A local document cannot navigate, cannot reach a provider,
           and cannot start the polling a real overlay URL would. */
        scrolling="no"
        /* The narrowest sandbox the portal allows. `allow-same-origin` is
           required — without it the frame gets an opaque origin and
           contentDocument becomes unreachable, so there is nothing to portal
           into. Everything else stays denied: no allow-scripts (the renderer runs
           in the parent realm, and the frame's own document needs no JS), no
           forms, no popups, no top-level navigation. */
        sandbox="allow-same-origin"
        style={{
          display: 'block',
          /* The zoom, and the whole of it.
             The frame is made 1/factor larger than its box and then scaled back
             down by the same factor, so it occupies exactly the box again while
             its *internal viewport* is proportionally bigger. Nothing inside is
             told anything: the renderer lays out against a larger viewport and
             the result is drawn smaller, which is why text, badges, emotes,
             source markers, event cards and the pin card all shrink together and
             stay in proportion. A font-size override could not do that — it
             would leave every px dimension in the overlay's CSS behind.
             Percentages rather than pixels keep the card in charge of the width. */
          width: `${(100 / factor).toFixed(4)}%`,
          height: `${(100 / factor).toFixed(4)}%`,
          transform: factor === 1 ? undefined : `scale(${factor})`,
          /* Top-left, so the scaled box still starts at the corner of its
             container. Scaling about the centre would pull the surface up and
             left by half the overflow and clip the top of the pin card. */
          transformOrigin: '0 0',
          border: 'none',
          background: 'transparent',
        }}
      />
      {target &&
        createPortal(
          <HeadManagerContext.Provider value={headManager}>
            {children}
          </HeadManagerContext.Provider>,
          target.body,
        )}
      {target && createPortal(<>{headChildren}</>, target.head)}
    </div>
  );
}
