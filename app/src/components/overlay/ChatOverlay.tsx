import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import Head from 'next/head';
import type { MultichatConfig } from '../../lib/multichatConfig';
import type { ParsedMessage } from '../../lib/kick';
import { sourceTag, PROVIDERS, type SourceTagMode } from '../../lib/render';
import type { Platform } from '../../lib/types';
import {
  LOCAL_OVERLAY_FONT_CSS,
  OVERLAY_FONT_FAMILIES,
  overlayFontCss,
} from '../../lib/overlayFonts';
import { createSmoothScrollFollower } from '../../lib/smoothScrollFollower';
import { MESSAGE_FADE_TRANSITION_MS } from '../../lib/messageFadeScheduler';
import { runtimeEntranceAnimationEnabled } from '../../lib/multichatAnimationRuntime';
import {
  MESSAGE_ENTRY_SPRING,
  isSlideHeightVisuallyComplete,
  messageEntryInitialState,
  messageEntryTargetState,
  type DirectionalMessageEntry,
} from '../../lib/messageEntryAnimation';

export interface PinnedState {
  msg: ParsedMessage;
  pinnedBy?: string;
}

export type StartupLoaderPhase = 'hidden' | 'visible' | 'fading';

interface Props {
  config: MultichatConfig;
  messages: ParsedMessage[];
  fadingIds: Set<string>;
  pinnedMessage: PinnedState | null;
  /** Boolean remains accepted for renderer fixtures; production passes a phase. */
  showLoader: boolean | StartupLoaderPhase;
  /**
   * Whether `sourceTag=` was actually present in the URL.
   *
   * The parser defaults the field to 'icon', so the config alone cannot tell an
   * explicit `sourceTag=icon` from an omitted parameter. Only the raw query can,
   * and the distinction matters: an omitted parameter shows the shared icon for
   * YouTube and no marker for the other single-platform overlays, while an explicit
   * value is always honoured. Defaults to false so existing callers are unaffected.
   */
  sourceTagExplicit?: boolean;
  /** Preview-only override; production callers leave this absent. */
  sourceTagOverride?: SourceTagMode;
  /** Runtime Shared Chat state; omitted callers use config.sharedChatEnabled. */
  sharedChatEnabled?: boolean;
}

/**
 * `font=` value → CSS `font-family`, the overlay's own resolution.
 *
 * Exported because the generator's font picker previews each option in the face
 * it names, and it must name the same faces the overlay will actually draw. It
 * previously kept a third copy of this table, so a family could be renamed here
 * and the picker would go on previewing the old one.
 */
export const FONT_FAMILIES = OVERLAY_FONT_FAMILIES;

const SIZE = {
  small: {
    fontSize:'20px', lineHeight:'30px',
    badgeW:'16px', badgeH:'16px', badgeMR:'2px', badgeMB:'3px', badgeLastMR:'3px',
    colonMR:'8px',
    emoteMaxW:'75px', emoteMaxH:'25px', emoteMR:'-3px',
    upscaleH:'25px', emojiH:'22px',
  },
  medium: {
    fontSize:'34px', lineHeight:'55px',
    badgeW:'28px', badgeH:'28px', badgeMR:'4px', badgeMB:'6px', badgeLastMR:'6px',
    colonMR:'14px',
    emoteMaxW:'128px', emoteMaxH:'42px', emoteMR:'-6px',
    upscaleH:'42px', emojiH:'39px',
  },
  large: {
    fontSize:'48px', lineHeight:'75px',
    badgeW:'40px', badgeH:'40px', badgeMR:'5px', badgeMB:'8px', badgeLastMR:'8px',
    colonMR:'20px',
    emoteMaxW:'180px', emoteMaxH:'60px', emoteMR:'-8px',
    upscaleH:'60px', emojiH:'55px',
  },
} as const;
type SzKey = keyof typeof SIZE;
type SizeGeometry = { [Key in keyof (typeof SIZE)['medium']]: string };

/** Scale every size-dependent chat metric from the locked 34px/55px medium
 * geometry. Legacy preset URLs still use the exact SIZE table above. */
function customSize(px: number): SizeGeometry {
  const ratio = px / 34;
  const scaled = (value: string) => `${Math.round(parseFloat(value) * ratio * 100) / 100}px`;
  return {
    fontSize: `${px}px`,
    lineHeight: scaled(SIZE.medium.lineHeight),
    badgeW: scaled(SIZE.medium.badgeW),
    badgeH: scaled(SIZE.medium.badgeH),
    badgeMR: scaled(SIZE.medium.badgeMR),
    badgeMB: scaled(SIZE.medium.badgeMB),
    badgeLastMR: scaled(SIZE.medium.badgeLastMR),
    colonMR: scaled(SIZE.medium.colonMR),
    emoteMaxW: scaled(SIZE.medium.emoteMaxW),
    emoteMaxH: scaled(SIZE.medium.emoteMaxH),
    emoteMR: scaled(SIZE.medium.emoteMR),
    upscaleH: scaled(SIZE.medium.upscaleH),
    emojiH: scaled(SIZE.medium.emojiH),
  };
}


/* Apply one composite drop-shadow to each chat row rather than separate
   shadows on the body and username. Existing strength labels map to
   progressively stronger opacity without changing serialized settings. */
function getMessageShadow(s: string) {
  const alpha: Record<string, number> = { small: 0.4, medium: 0.7, large: 1 };
  const opacity = alpha[s] ?? 0;
  return opacity ? `drop-shadow(2px 2px 3px rgba(0, 0, 0, ${opacity}))` : '';
}

/* Build the font stroke from four diagonal black text-shadows. Scale the
   offsets for the existing thickness choices so old URLs retain their
   thin/medium/thick vocabulary. */
function getStroke(s: string) {
  const width: Record<string, number> = { thin: 1, medium: 2, thick: 3, thicker: 4 };
  const px = width[s] ?? 0;
  return px
    ? `${px}px ${px}px 0 black, -${px}px ${px}px 0 black, ${px}px -${px}px 0 black, -${px}px -${px}px 0 black`
    : '';
}

/* Painted names clear inherited text-shadow. When paint shadows are disabled,
   restore a WebKit stroke directly on the painted glyphs using the selected
   legacy width. */
function getPaintStroke(s: string) {
  const width: Record<string, number> = { thin: 1, medium: 2, thick: 3, thicker: 4 };
  const px = width[s] ?? 0;
  return px ? `${px}px black` : '';
}


const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export const SLIDE_SWING_EASE = (progress: number) =>
  0.5 - Math.cos(progress * Math.PI) / 2;

export const SLIDE_HEIGHT_SPRING = {
  type: 'tween' as const,
  duration: 0.15,
  ease: SLIDE_SWING_EASE,
};

function SlideGroup({
  batchId,
  children,
  preserveChildren = false,
}: {
  batchId: number;
  children: React.ReactNode;
  preserveChildren?: boolean;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const completedRef = useRef(false);
  const reduceMotion = useReducedMotion();

  const completeOnce = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setRevealed(true);
  }, []);

  useBrowserLayoutEffect(() => {
    if (revealed || measuredHeight !== null) return;

    const measure = measureRef.current;
    if (!measure) return;

    if (reduceMotion) {
      setRevealed(true);
      return;
    }

    const measured =
      measure.getBoundingClientRect().height || measure.scrollHeight;

    if (measured <= 0) {
      setRevealed(true);
      return;
    }

    setMeasuredHeight(measured);
  }, [measuredHeight, reduceMotion, revealed]);

  /*
   * Ordinary Main Slide keeps the approved cleanup path.
   *
   * Directional entrances intentionally keep the same Motion parent mounted
   * after the height spring settles. Changing that parent to a Fragment would
   * remount the horizontal-entry Motion node and replay Right/Left.
   */
  if (revealed && !preserveChildren) {
    return <>{children}</>;
  }

  if (measuredHeight === null) {
    if (revealed) return <>{children}</>;

    return (
      <div
        className="gx-slide-group"
        data-render-batch-id={batchId}
        data-slide-phase="measure"
        style={{ height: 0, overflow: 'hidden' }}
      >
        <div
          ref={measureRef}
          className="gx-slide-measure"
          data-slide-ghost
          aria-hidden="true"
        >
          {children}
        </div>
      </div>
    );
  }

  const settledDirectional = revealed && preserveChildren;

  return (
    <motion.div
      className={
        settledDirectional
          ? 'gx-slide-directional-settled'
          : 'gx-slide-group'
      }
      data-render-batch-id={batchId}
      data-slide-phase={settledDirectional ? 'settled' : 'opening'}
      data-slide-motion-spacer={settledDirectional ? undefined : true}
      data-slide-live
      initial={{ height: 0 }}
      animate={{
        height: settledDirectional ? 'auto' : measuredHeight,
      }}
      transition={
        settledDirectional
          ? { duration: 0 }
          : SLIDE_HEIGHT_SPRING
      }
      onUpdate={(latest) => {
        if (
          !settledDirectional &&
          isSlideHeightVisuallyComplete(latest.height, measuredHeight)
        ) {
          completeOnce();
        }
      }}
      onAnimationComplete={() => {
        if (!settledDirectional) completeOnce();
      }}
      style={
        settledDirectional
          ? { display: 'contents' }
          : {
              overflow: 'visible',
              clipPath: 'inset(0 -100vw 0 -100vw)',
              WebkitClipPath: 'inset(0 -100vw 0 -100vw)',
            }
      }
    >
      {children}
    </motion.div>
  );
}

function FadeGroup({ children }: { children: React.ReactNode }) {
  /* Pure CSS keeps the 220ms fade while removing two requestAnimationFrame
     callbacks and a React state update for every arriving batch. */
  return <div className="gx-fade-group">{children}</div>;
}

function DirectionalEntry({
  children,
  direction,
  ownsOpacity,
}: {
  children: React.ReactNode;
  direction: DirectionalMessageEntry;
  ownsOpacity: boolean;
}) {
  const reduceMotion = useReducedMotion();

  const initial = messageEntryInitialState(direction, ownsOpacity);
  const target = messageEntryTargetState(ownsOpacity);
  const animateEntrance = !reduceMotion;

  return (
    <motion.div
      className="gx-message-entry"
      data-entry-animation={direction}
      initial={
        animateEntrance && ownsOpacity
          ? { opacity: initial.opacity }
          : false
      }
      animate={
        ownsOpacity
          ? { opacity: target.opacity }
          : {}
      }
      transition={
        animateEntrance && ownsOpacity
          ? { opacity: MESSAGE_ENTRY_SPRING }
          : undefined
      }
      style={{ width: '100%', minWidth: 0 }}
    >
      <motion.div
        data-entry-motion-x
        initial={
          animateEntrance
            ? { x: initial.x }
            : false
        }
        animate={{ x: target.x }}
        transition={
          animateEntrance
            ? { x: MESSAGE_ENTRY_SPRING }
            : undefined
        }
        style={{ width: '100%', minWidth: 0 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

const MessageRow = memo(function MessageRow({
  msg, fading, messageShadowFilter, paintStrokeVal, sz, emoteMaxH, emoteMaxW,
  hideNames, tagMode, showAvatar, showSharedSource, replyStyle, entryAnimation,
  entryOwnsOpacity,
}: {
  msg: ParsedMessage; fading: boolean; messageShadowFilter: string; paintStrokeVal: string;
  sz: SizeGeometry; emoteMaxH: string; emoteMaxW: string;
  hideNames: boolean; tagMode: SourceTagMode; showAvatar: boolean; showSharedSource: boolean;
  replyStyle: MultichatConfig['replyStyle'];
  entryAnimation: MultichatConfig['entryAnimation'];
  entryOwnsOpacity: boolean;
}) {
  const exitEasing = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const exitTransition = [
    `grid-template-rows ${MESSAGE_FADE_TRANSITION_MS}ms ${exitEasing}`,
    `opacity ${MESSAGE_FADE_TRANSITION_MS}ms ${exitEasing}`,
    `transform ${MESSAGE_FADE_TRANSITION_MS}ms ${exitEasing}`,
  ].join(', ');

  return (
    <div
      className="gx-message-row"
      style={{
      margin: '0 10px',
      display: 'grid',
      gridTemplateRows: fading ? '0fr' : '1fr',
      opacity: fading ? 0 : 1,
      transform: fading ? 'translate3d(0, -6px, 0)' : 'translate3d(0, 0, 0)',
      transformOrigin: 'top center',
      transition: exitTransition,
      willChange: fading ? 'grid-template-rows, opacity, transform' : undefined,
      ...(messageShadowFilter ? { filter: messageShadowFilter } : {}),
    }}>
      <div className="gx-message-row-inner" style={{ minHeight: 0, overflow: 'hidden' }}>
        {entryAnimation === 'none' ? (
          <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
            paintStroke={paintStrokeVal} hideNames={hideNames}
            tagMode={tagMode} showAvatar={showAvatar} showSharedSource={showSharedSource} replyStyle={replyStyle} />
        ) : (
          <DirectionalEntry direction={entryAnimation} ownsOpacity={entryOwnsOpacity}>
            <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
              paintStroke={paintStrokeVal} hideNames={hideNames}
              tagMode={tagMode} showAvatar={showAvatar} showSharedSource={showSharedSource} replyStyle={replyStyle} />
          </DirectionalEntry>
        )}
      </div>
    </div>
  );
});

type RenderBatch = {
  id: number;
  messageIds: string[];
  animate: boolean;
};

export default function ChatOverlay({ config, messages, fadingIds, pinnedMessage, showLoader, sourceTagExplicit = false, sourceTagOverride, sharedChatEnabled }: Props) {
  /* Fully typed by MultichatConfig — the schema already declares every field
     read below, so no intersection or cast is needed. */
  const cfg = config;
  const showSharedSource = sharedChatEnabled ?? cfg.sharedChatEnabled;

  const szKey      = (cfg.textSize in SIZE ? cfg.textSize : 'medium') as SzKey;
  const sz: SizeGeometry = cfg.textSizePx === undefined
    ? SIZE[szKey]
    : customSize(cfg.textSizePx);
  /* Draw the configured chat shadow on glyphs instead of filtering the complete
     row, retaining the established three-layer body treatment. */
  const messageShadowFilter = '';
  const bodyTextShadow = cfg.textShadow === 'large'
    ? 'rgb(0,0,0) 2.5px 3px 1.6px, rgb(0,0,0) 0 3px 6.4px, rgba(0,0,0,.8) 0 0 4.8px'
    : cfg.textShadow === 'medium'
      ? 'rgb(0,0,0) 1.75px 2px 1.1px, rgb(0,0,0) 0 2px 4.5px, rgba(0,0,0,.8) 0 0 3.4px'
      : cfg.textShadow === 'small'
        ? 'rgb(0,0,0) 1px 1.2px .65px, rgb(0,0,0) 0 1.2px 2.6px, rgba(0,0,0,.8) 0 0 2px'
        : '';
  const nameTextShadow = cfg.textShadow === 'large'
    ? 'rgb(0,0,0) 2.88px 3.2px 1.6px, rgb(0,0,0) 0 0 4.8px'
    : cfg.textShadow === 'medium'
      ? 'rgb(0,0,0) 2px 2.2px 1.1px, rgb(0,0,0) 0 0 3.4px'
      : cfg.textShadow === 'small'
        ? 'rgb(0,0,0) 1.15px 1.3px .65px, rgb(0,0,0) 0 0 2px'
        : '';
  const strokeVal = getStroke(cfg.stroke ?? 'none');
  const renderedBodyTextShadow = [strokeVal, bodyTextShadow].filter(Boolean).join(', ');
  const renderedNameTextShadow = [strokeVal, nameTextShadow].filter(Boolean).join(', ');
  const paintStrokeVal = cfg.paintShadows === false ? getPaintStroke(cfg.stroke ?? 'none') : '';
  const fontFamily = FONT_FAMILIES[cfg.font ?? 'opensans'] ?? FONT_FAMILIES.opensans;
  const explicitFontWeight = cfg.fontWeight === undefined
    ? null
    : Number(cfg.fontWeight);
  /* No fontWeight parameter is the legacy path: bold messages were 800 and
     ordinary messages 400, while names stayed 900. A modern explicit weight
     is authoritative so all nine Typography choices visibly reach the row. */
  const messageFontWeight = explicitFontWeight
    ?? (cfg.msgBold === false ? 400 : 800);
  const nameFontWeight = explicitFontWeight ?? 900;
  const textTransform = cfg.textTransform === 'none'
    ? (cfg.msgCaps ? 'uppercase' : undefined)
    : cfg.textTransform;
  /* Naming a family does not load it. Only the selected face is requested, and
     system faces and the self-hosted Alsina yield null — see lib/overlayFonts. */
  const fontCss    = overlayFontCss(cfg.font, {
    fontWeight: messageFontWeight,
    fontItalic: cfg.fontItalic,
  });
  
  const smoothRuntime = cfg.smoothScroll && cfg.animation !== 'slide';
  const loaderPhase: StartupLoaderPhase = showLoader === true
    ? 'visible'
    : showLoader === false
      ? 'hidden'
      : showLoader;
  const emoteScale = cfg.emoteScale ?? 1;
  const emoteMaxH  = `${parseFloat(sz.emoteMaxH) * emoteScale}px`;
  const emoteMaxW  = `${parseFloat(sz.emoteMaxW) * emoteScale}px`;
  const mediumEmoteProfile = szKey === 'medium' && cfg.textSizePx === undefined;
  const regularEmoteHeight = mediumEmoteProfile
    ? `calc(1.7em * ${emoteScale})`
    : emoteMaxH;
  const regularEmoteMaxWidth = mediumEmoteProfile
    ? `calc(5em * ${emoteScale})`
    : emoteMaxW;
  const zeroWidthEmoteHeight = mediumEmoteProfile
    ? `calc(1.65em * ${emoteScale})`
    : emoteMaxH;
  /* Source tag mode.
     An explicit sourceTag= always wins, for one platform or four. With no
     parameter, multi-platform and YouTube-only overlays show icons; the other
     single-platform overlays retain their existing marker-free appearance.

     The bug this replaces ignored cfg.sourceTag entirely whenever fewer than two
     platforms were configured, so dot, label, and icon were all unreachable from
     a one-platform URL and every value rendered identically. */
  const configuredPlatforms = [cfg.kick || cfg.channel, cfg.twitch, cfg.youtube, cfg.tiktok].filter(Boolean);
  const multiPlatform = configuredPlatforms.length > 1;
  const youtubeOnly = Boolean(cfg.youtube) && configuredPlatforms.length === 1;
  const tagMode: SourceTagMode = sourceTagOverride ?? (sourceTagExplicit
    ? cfg.sourceTag
    : (multiPlatform || youtubeOnly ? 'icon' : 'none'));

  
  const chatContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!smoothRuntime) return;
    const el = chatContainerRef.current;
    if (!el || typeof MutationObserver === 'undefined') return;

    /* One continuously moving rAF target gives burst chat a stable frame cadence.
       Native smooth scrolling restarts its easing curve on every mutation, while
       the old burst fallback snapped to `auto`; both are visible as uneven speed
       when messages arrive faster than the animation can settle. */
    const follower = createSmoothScrollFollower(el);
    const observer = new MutationObserver(() => follower.wake());
    observer.observe(el, { childList: true });
    follower.wake();
    return () => {
      observer.disconnect();
      follower.stop();
    };
  }, [smoothRuntime]);

  /* The parent commits connector arrivals on the fixed presentation clock.
     Derive batch membership during that same render instead of committing the
     messages first and then running an effect that calls setBatches for a second
     React commit. Refs preserve immutable batch identity across repaint-only
     updates without scheduling any additional render. */
  const batchStateRef = useRef<{
    sequence: number;
    seen: Set<string>;
    batches: RenderBatch[];
  }>({ sequence: 0, seen: new Set<string>(), batches: [] });
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const batches = useMemo(() => {
    const state = batchStateRef.current;
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
      const animate = newMessages.every((message) => !message.suppressEntryAnimation)
        && runtimeEntranceAnimationEnabled();
      next = [...next, {
        id: ++state.sequence,
        messageIds: newMessageIds,
        animate,
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
  }, [messages]);

  const renderMsg = (
    msg: ParsedMessage,
    entryAnimation: MultichatConfig['entryAnimation'] = 'none',
  ) => (
    <MessageRow key={msg.id}
      msg={msg}
      fading={fadingIds.has(msg.id)}
      messageShadowFilter={messageShadowFilter}
      paintStrokeVal={paintStrokeVal}
      sz={sz}
      emoteMaxH={emoteMaxH}
      emoteMaxW={emoteMaxW}
      hideNames={cfg.hideNames ?? false}
      tagMode={tagMode}
      showAvatar={cfg.showAvatars ?? false}
      showSharedSource={showSharedSource}
      replyStyle={cfg.replyStyle}
      entryAnimation={entryAnimation}
      entryOwnsOpacity={cfg.animation !== 'fade'}
    />
  );

  /* Visual configuration is static between settings changes. Memoizing this
     prevents message traffic from reconstructing the same large CSS string. */
  const overlayCss = useMemo(() => `${LOCAL_OVERLAY_FONT_CSS}
          
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            height: 100vh !important;
            position: relative !important;
            background: ${cfg.bgColor || 'transparent'} !important;
          }
          
          #__next {
            position: static !important;
            height: 0 !important;
            overflow: visible !important;
          }
          ${cfg.font==='alsina' ? `@font-face { font-family:Alsina; src:url(/fonts/Alsina_Ultrajada.ttf); }` : ''}

          
          /* Only hint scrolling while the rAF follower is actually moving. */
          .gx-scroll-active { will-change: scroll-position; }

          .gx-slide-group {
          position: relative;
          width: 100%;
        }
        .gx-slide-measure {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          visibility: hidden;
          pointer-events: none;
        }
        @keyframes gxFadeGroupIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          .gx-fade-group {
            animation: gxFadeGroupIn 220ms ease-in-out;
          }
          @media (prefers-reduced-motion: reduce) {
            .gx-message-row {
              animation: none !important;
              transition-duration: 0ms !important;
              transform: none !important;
            }
          }

          
          .ck-bw {
            display:        inline-flex;
            align-items:    center;
            gap:            ${sz.badgeMR};
            margin-right:   ${sz.badgeLastMR};
            vertical-align: middle;
            line-height:    0;
          }
          .ck-bw img,
          .ck-bw svg,
          .ck-badge-img {
            width:          ${sz.badgeW} !important;
            height:         ${sz.badgeH} !important;
            min-width:      ${sz.badgeW} !important;
            min-height:     ${sz.badgeH} !important;
            max-width:      ${sz.badgeW} !important;
            max-height:     ${sz.badgeH} !important;
            margin:         0 !important;
            vertical-align: middle;
            border-radius:  10%;
            display:        block;
            flex:           0 0 auto;
          }

          /* Wide badges (TikTok fan-club/gifter art): height-locked,
             natural width, so they baseline-align with square badges */
          img.ck-badge-img.ck-badge-wide {
            width:     auto !important;
            min-width: 0 !important;
            max-width: calc(${sz.badgeW} * 2.5) !important;
          }

          .ck-body {
            display: inline;
          }

          /* Emote sizing. height is pinned to the configured size rather than
             left auto: providers ship the same emote at 1x-4x, and with
             height:auto a low-resolution source drew shorter than its
             neighbours instead of at the configured size. width stays auto so
             the aspect ratio decides it — wide emotes stay wide, square ones
             stay square, and max-width only clamps the extremes, where
             object-fit letterboxes instead of stretching. */
          /* Scoped to .ck-emote, not to every descendant img. Every emote path
             carries that class — ordinary, native, zero-width base, zero-width
             overlay — so this is the same set of images as before, but a
             non-emote image that ever lands in a body is no longer force-sized.
             That mattered less when height was auto; a pinned height would
             actively distort anything it caught. Badges, avatars and source
             marks are siblings of .ck-body and were never in scope. */
          .ck-body img.ck-emote {
            max-width:      ${regularEmoteMaxWidth};
            max-height:     ${regularEmoteHeight};
            height:         ${regularEmoteHeight};
            width:          auto;
            object-fit:     contain;
            margin-right:   ${sz.emoteMR};
            vertical-align: middle;
            display:        inline-block;
          }

          /* Zero-width stack: base + overlays in one grid cell. The base is
             the only in-flow item, so the cell keeps its full width and the
             compaction margin moves to the wrapper — inside it, that negative
             margin was clipping the base. Overlays are out of flow and
             centred, so they add no width regardless of their own. */
          .ck-body .ck-zw {
            display:        inline-grid;
            position:       relative;
            vertical-align: middle;
            line-height:    0;
            margin-right:   ${sz.emoteMR};
          }
          .ck-body .ck-zw > img.ck-zw-base {
            grid-area:      1 / 1;
            margin-right:   0;
          }
          .ck-body .ck-zw > .ck-zw-layer {
            position:        absolute;
            inset:           0;
            display:         flex;
            align-items:     center;
            justify-content: center;
            pointer-events:  none;
          }
          .ck-body .ck-zw > .ck-zw-layer > img.ck-emote {
            margin-right:   0;
            max-width:      none;
            max-height:     ${zeroWidthEmoteHeight};
            height:         ${zeroWidthEmoteHeight};
            width:          auto;
          }

          
          .ck-body img.ck-upscale {
            max-height:     ${regularEmoteHeight};
            max-width:      ${regularEmoteMaxWidth};
            height:         ${regularEmoteHeight};
            width:          auto;
          }

          ${mediumEmoteProfile ? `
          /* Twitch-native artwork keeps its intrinsic height while
             applying the same 1.7em ceiling as other Medium emotes. */
          .ck-body img.ck-native-twitch {
            height: auto;
          }
          ` : ''}

          .ck-colon { margin-right: ${sz.colonMR}; }

          /*
             Medium geometry and visual treatment preserve the established
             GXUFY proportions and renderer behavior. */
          #chat_container {
            font-family: ${fontFamily};
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          .ck-body {
            display: inline !important;
            white-space: normal;
            font-weight: ${messageFontWeight} !important;
            line-height: inherit !important;
            text-shadow: ${renderedBodyTextShadow || "none"} !important;
          }

          .ck-name {
            overflow-wrap: anywhere;
            margin-right: 8px;
            font-weight: ${nameFontWeight} !important;
            display: inline-block;
            line-height: inherit !important;
            text-shadow: ${renderedNameTextShadow || "none"} !important;
          }

          .ck-name-paint,
          .ck-name-pill {
            text-shadow: none !important;
          }
          .ck-name-paint {
            -webkit-background-clip: text !important;
            background-clip: text !important;
          }

          /* Wrappers stay inline and do not establish a second media geometry. */
          .ck-emote-wrap,
          .ck-twemoji-wrap {
            display: inline !important;
            margin: 0 !important;
            padding: 0 !important;
            line-height: inherit !important;
          }

          /* Unicode emoji keeps the established 1.2em treatment.
             Ordinary provider/7TV emotes continue using the original
             GXUFY .ck-body img.ck-emote rules above. */
          .ck-twemoji-wrap > img.ck-twemoji {
            height: calc(1.2em * ${emoteScale}) !important;
            max-height: calc(1.2em * ${emoteScale}) !important;
            width: auto !important;
            vertical-align: middle !important;
            margin: 0 !important;
          }

          .ck-bw img,
          .ck-bw svg,
          .ck-badge-img {
            filter: drop-shadow(rgba(0,0,0,.8) 2px 3px .15rem) !important;
          }

          #chat_container [data-source-tag="icon"] {
            filter: ${getMessageShadow(cfg.textShadow) || 'none'} !important;
          }
          #chat_container [data-source-tag="icon"] img,
          #chat_container [data-source-tag="icon"] svg {
            filter: none !important;
          }

          @keyframes ckPin {
            from { opacity:0; transform:translateY(-6px); }
            to   { opacity:1; transform:translateY(0); }
          }
          @keyframes ckSpin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }

          .ck-startup-loader {
            position: fixed;
            inset: 0;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            pointer-events: none;
            opacity: 1;
            transition: opacity 250ms ease;
          }
          .ck-startup-loader[data-phase='fading'] { opacity: 0; }
          .ck-startup-card {
            display: block;
            max-width: min(420px, 100%);
            padding: clamp(12px, 3vw, 20px) clamp(16px, 4vw, 26px);
            border: 1px solid rgba(255,255,255,.14);
            border-radius: 18px;
            background: rgba(12,12,16,.64);
            color: #fff;
            box-shadow: 0 12px 36px rgba(0,0,0,.34);
            backdrop-filter: blur(8px);
          }
          .ck-startup-copy { min-width:0; font-family:'Open Sans',Arial,system-ui,sans-serif; }
          .ck-startup-title { margin:0; font-size:clamp(20px,4.2vw,32px); line-height:1.1; font-weight:800; letter-spacing:-.025em; }
          .ck-startup-byline { margin:4px 0 10px; color:#a9c4ff; font-size:clamp(12px,2vw,15px); font-weight:700; }
          .ck-startup-status { display:flex; align-items:center; gap:9px; margin:0; color:rgba(255,255,255,.82); font-size:clamp(12px,2vw,15px); font-weight:700; }
          .ck-startup-spinner { width:16px; height:16px; flex:0 0 auto; border:2px solid rgba(255,255,255,.25); border-top-color:#6d9dff; border-radius:50%; animation:ckSpin .8s linear infinite; }
          @media (prefers-reduced-motion: reduce) {
            .ck-startup-loader { transition: none; }
            .ck-startup-spinner { animation: none; border-top-color:#6d9dff; }
          }

        `, [cfg, sz, emoteScale, mediumEmoteProfile, regularEmoteHeight, regularEmoteMaxWidth, zeroWidthEmoteHeight]);

  return (
    <>
      <Head>
        {/* The selected web font. Without this the overlay named a family it had
            never fetched, so every Google face — including the generator's
            default, Open Sans — fell back to generic sans-serif in OBS while the
            generator preview, which loads them for its own UI, showed the real
            face. `display=swap` keeps text visible while it loads. */}
        {fontCss && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            {/* dangerouslySetInnerHTML, not a text child: React escapes the
                latter, and `&` → `&amp;` plus `'` → `&#x27;` are not decoded
                inside a <style> raw-text element, so the @import would be an
                invalid URL token and load nothing. */}
            <style dangerouslySetInnerHTML={{ __html: fontCss }} />
          </>
        )}
        <style>{overlayCss}</style>
      </Head>

      {loaderPhase !== 'hidden' && (
        <div className="ck-startup-loader" data-phase={loaderPhase} data-testid="chat-startup-loader">
          <div className="ck-startup-card">
            <div className="ck-startup-copy">
              <p className="ck-startup-title">Multi-Chat Overlay</p>
              <p className="ck-startup-byline">made by @Gxufy</p>
              <p className="ck-startup-status">
                <span className="ck-startup-spinner" aria-hidden="true" />
                Loading...
              </p>
            </div>
          </div>
        </div>
      )}

      {cfg.showPinEnabled && pinnedMessage && (
        <PinBanner
          pinned={pinnedMessage} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
          fontFamily={fontFamily} messageShadowFilter={messageShadowFilter} strokeVal={strokeVal} paintStrokeVal={paintStrokeVal}
          hideNames={cfg.hideNames??false} tagMode={tagMode} replyStyle={cfg.replyStyle}
        />
      )}

      {}
      <div id="chat_container" ref={chatContainerRef} style={{
        width:      'calc(100% - 20px)',
        padding:    '10px',
        position:   'absolute',
        bottom:     0,
        maxHeight:  smoothRuntime ? 'calc(100vh - 20px)' : undefined,
        display:    smoothRuntime ? 'flex' : undefined,
        flexDirection: smoothRuntime ? 'column' : undefined,
        overflow:   'hidden',
        background: 'transparent',
        color:      cfg.fontColor || 'white',
        fontWeight: messageFontWeight,
        fontStyle: cfg.fontItalic ? 'italic' : undefined,
        textTransform,
        wordBreak:  'break-word',
        fontFamily,
        fontSize:   sz.fontSize,
      }}>
        {batches.map(({ id, messageIds, animate }) => {
          const content = messageIds
            .map((messageId) => messagesById.get(messageId))
            .filter((message): message is ParsedMessage => Boolean(message))
            .map((message) => renderMsg(
              message,
              animate ? cfg.entryAnimation : 'none',
            ));
          if (animate && cfg.animation==='slide') return (
            <SlideGroup
              key={id}
              batchId={id}
              preserveChildren={
                cfg.entryAnimation === 'slideRight' ||
                cfg.entryAnimation === 'slideLeft'
              }
            >
              {content}
            </SlideGroup>
          );
          if (animate && cfg.animation==='fade')  return <FadeGroup  key={id}>{content}</FadeGroup>;
          return <div key={id}>{content}</div>;
        })}
      </div>
    </>
  );
}

/* PinBanner — 5-second fade-out pin banner.
 *
 * Timing cycle (per msg.id):
 *   0 ms    → rendered, opacity 1
 *   4600 ms → opacity becomes 0 (400 ms fade)
 *   5000 ms → unmounted (stop rendering)
 *
 * Two states: `opacity` (number 0/1) and `mounted` (boolean).
 * Two timers: fade timer at 4600 ms, unmount timer at 5000 ms.
 * A different msg.id restarts the complete cycle.
 * Parent-driven unmount (pinnedMessage null / showPinEnabled false)
 * clears both timers in useEffect cleanup. */
function PinBanner({ pinned, sz, emoteMaxH, emoteMaxW, fontFamily, messageShadowFilter, strokeVal, paintStrokeVal, hideNames, tagMode, replyStyle }: {
  pinned: PinnedState; sz: SizeGeometry;
  emoteMaxH:string; emoteMaxW:string; fontFamily:string;
  messageShadowFilter:string; strokeVal:string; paintStrokeVal:string;
  hideNames:boolean;
  replyStyle: MultichatConfig['replyStyle'];
  /* Follows the overlay's mode rather than a hardcoded 'icon', so sourceTag=none
     leaves no marker here either. */
  tagMode:SourceTagMode;
}) {
  const { msg, pinnedBy } = pinned;
  const [opacity, setOpacity] = useState(1);
  const [mounted, setMounted] = useState(true);
  const timersRef = useRef<{ fade: ReturnType<typeof setTimeout>|null; unmount: ReturnType<typeof setTimeout>|null }>({ fade: null, unmount: null });

  useEffect(() => {
    // Reset cycle on new msg.id or initial mount
    setOpacity(1);
    setMounted(true);

    // Clear any previous timers (handles msg.id change + parent unmount)
    if (timersRef.current.fade) clearTimeout(timersRef.current.fade);
    if (timersRef.current.unmount) clearTimeout(timersRef.current.unmount);

    timersRef.current.fade = setTimeout(() => setOpacity(0), 4600);
    timersRef.current.unmount = setTimeout(() => setMounted(false), 5000);

    return () => {
      if (timersRef.current.fade) clearTimeout(timersRef.current.fade);
      if (timersRef.current.unmount) clearTimeout(timersRef.current.unmount);
    };
  }, [msg.id]);

  /* Entry animation from the original banner + 400 ms opacity fade-out
   * controlled by state. The 150 ms slide-in runs once on mount;
   * opacity transitions from 1 → 0 over 400 ms starting at 4600 ms. */
  const shell: React.CSSProperties = {
    position:'absolute', top:0, left:0, right:0, zIndex:10,
    background:'rgba(12,12,16,0.72)',
    backdropFilter:'blur(16px) saturate(180%)', WebkitBackdropFilter:'blur(16px) saturate(180%)',
    borderBottom:'1px solid rgba(255,255,255,0.12)',
    borderRadius:'0 0 10px 10px',
    animation:'ckPin 150ms ease-out',
    fontFamily, fontWeight:800,
    color:'white',
    wordBreak:'break-word', overflowWrap:'break-word',
    overflow:'hidden',
    opacity,
    transition:'opacity 400ms ease-in-out',
    ...(strokeVal ? { textShadow:strokeVal } : {}),
  };

  if (!mounted) return null;

  return (
    <div style={{ ...shell, padding:'6px 10px 8px', fontSize:sz.fontSize }}>
      <div style={{ display:'flex', alignItems:'center', gap:4, paddingBottom:4, opacity:0.6, fontSize:'0.7em' }}>
        <PinSVG /> <span style={{ fontWeight:700 }}>Pinned Message</span>
      </div>
      <div className="gx-message-row" style={messageShadowFilter ? { filter:messageShadowFilter } : undefined}>
      <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
        paintStroke={paintStrokeVal} hideNames={hideNames}
        tagMode={tagMode} showAvatar={false} showSharedSource={false} replyStyle={replyStyle} />
    </div>
      {pinnedBy && (
        <div style={{ paddingTop:4, opacity:0.5, fontSize:'0.55em', fontWeight:600 }}>
          Pinned by {pinnedBy}
        </div>
      )}
    </div>
  );
}


const CATEGORY_ICON: Record<string, string> = {
  subscription: '★', gift: '🎁', raid: '👥', cheer: '💰',
  milestone: '🔥', follow: '❤️', announcement: '📣',
};

function MsgLine({ msg, sz, emoteMaxH, emoteMaxW, paintStroke, hideNames, tagMode, showAvatar, showSharedSource, replyStyle }: {
  msg: ParsedMessage; sz: SizeGeometry;
  emoteMaxH:string; emoteMaxW:string; paintStroke:string;
  hideNames:boolean;
  tagMode:SourceTagMode; showAvatar:boolean; showSharedSource:boolean;
  replyStyle: MultichatConfig['replyStyle'];
}) {
  const isPaint = !!msg.identity.background;
  const pill = msg.identity.namePill?.split('|');
  const nameStyle: React.CSSProperties = pill
    ? { background:pill[0], color:pill[1], borderRadius:'0.4em', padding:'0 0.35em',
        WebkitTextStroke:'0px', textShadow:'none', fontWeight:800 }
    : isPaint
    /* The paint branch is isolated from the ordinary font stroke: the gradient
       clips to transparent glyphs, its own 7TV shadow filter stays on the name,
       and inherited text-shadow is cleared. If paint shadows are disabled, a
       direct WebKit stroke is restored on the painted glyph. Ordinary username
       text-shadow stays disabled so the paint filter composes exactly once. */
    ? { backgroundImage:msg.identity.background,
        filter:msg.identity.filter || undefined,
        WebkitTextFillColor:'transparent', WebkitBackgroundClip:'text',
        backgroundClip:'text', backgroundSize:'100% 100%',
        backgroundRepeat:'no-repeat', backgroundPosition:'center center',
        WebkitTextStroke:paintStroke || '0px', textShadow:'none', fontWeight:800 }
    : { color:msg.identity.color, fontWeight:800 };

  const visualPlatform = msg.displayPlatform ?? msg.platform;
  const tag = visualPlatform ? sourceTag(visualPlatform, tagMode) : null;


  const avatar = showAvatar && msg.avatar && (msg.platform === 'youtube' || msg.platform === 'tiktok') ? (
    <img src={msg.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{ width:'1.5em', height:'1.5em', minWidth:'1.5em', borderRadius:9999,
               objectFit:'cover', marginRight:'0.4em', verticalAlign:'-0.32em',
               display:'inline-block' }}
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
  ) : null;
  const sourceChannel = showSharedSource && msg.sourceChannel?.profileImageUrl ? (
    <span data-testid="twitch-shared-source" title="Twitch Shared Chat"
      style={{ display:'inline-flex', alignItems:'center', marginRight:'0.35em', verticalAlign:'middle', opacity:0.9 }}>
      <img src={msg.sourceChannel.profileImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
        style={{ width:'1.45em', height:'1.45em', borderRadius:'0.25em', objectFit:'cover' }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
    </span>
  ) : null;

  const badgesNode = msg.identity.badges.length > 0 && (
    <span className="ck-bw">
      {msg.identity.badges.map((b,i) => <Fragment key={i}>{b}</Fragment>)}
    </span>
  );
  const nameNode = (
    <span
      className={pill ? 'ck-name ck-name-pill' : isPaint ? 'ck-name ck-name-paint' : 'ck-name'}
      style={nameStyle}
    >
      {msg.identity.username}:
    </span>
  );

  
  if (msg.kind === 'system') {
    const color = msg.platform ? PROVIDERS[msg.platform as Platform].color : '#888';
    return (
      <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word', display:'flex', alignItems:'flex-start', gap:'0.3em' }}>
        {tag && <span style={{ flexShrink:0 }}>{tag}</span>}
        {sourceChannel}
        <div style={{
          borderLeft:`2px solid ${color}`,
          background:`linear-gradient(90deg, color-mix(in srgb, ${color} 20%, transparent), transparent)`,
          padding:'0 8px', borderRadius:6, flex:1, minWidth:0,
        }}>
          <span style={{ marginRight:'0.35em' }}>{CATEGORY_ICON[msg.category ?? 'announcement'] ?? '📣'}</span>
          <span style={{ fontWeight:400 }} className="ck-body">
            {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
          </span>
        </div>
      </div>
    );
  }

  
  const redeemWrap = (inner: React.ReactNode) => (
    <div style={{
      borderLeft: '0.22em solid #9147ff',
      background: 'linear-gradient(90deg, rgba(145,71,255,0.18), transparent 70%)',
      padding: '0 0 0 0.4em', borderRadius: 3,
    }}>
      {typeof msg.redeem === 'string' && msg.redeem !== 'highlighted' && (
        <div style={{ fontSize: '0.6em', opacity: 0.75, fontWeight: 700, lineHeight: 1.6 }}>
          🎁 {msg.redeem}
        </div>
      )}
      {inner}
    </div>
  );

  const replyNode = msg.reply && replyStyle === 'full' ? (
    <div style={{
      fontSize:'0.6em', lineHeight:1.35, opacity:0.68,
      marginLeft:'0.35em',
      paddingLeft:'0.45em', borderLeft:'2px solid rgba(255,255,255,0.28)',
      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
    }}>
      <span className="ck-body"><span aria-hidden="true">↪ </span><strong style={{ fontWeight:800 }}>{msg.reply.username}</strong>{msg.reply.text ? ` ${msg.reply.text}` : ''}</span>
    </div>
  ) : null;

  const replyMention = msg.reply && replyStyle === 'mention'
    ? <><strong style={{ fontWeight:800 }}>{msg.reply.username.startsWith('@') ? msg.reply.username : '@' + msg.reply.username}</strong>{' '}</>
    : null;

  const messageLine = (
    <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word' }}>
      {tag}
      {sourceChannel}
      {avatar}
      {!hideNames && (
        <span style={{ display:'inline' }}>
          {badgesNode}{nameNode}
        </span>
      )}
      <span className="ck-body">
        {replyMention}
        {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
      </span>
    </div>
  );

  const line = replyNode ? <div>{replyNode}{messageLine}</div> : messageLine;
  return msg.redeem ? redeemWrap(line) : line;
}

function PinSVG() {
  return (
    <svg height={12} width={12} fill="currentColor" viewBox="0 0 490.125 490.125">
      <path d="M300.625,5.025c-6.7-6.7-17.6-6.7-24.3,0l-72.6,72.6c-6.7,6.7-6.7,17.6,0,24.3l16.3,16.3l-40.3,40.3l-63.5-7c-3-0.3-6-0.5-8.9-0.5c-21.7,0-42.2,8.5-57.5,23.8l-20.8,20.8c-6.7,6.7-6.7,17.6,0,24.3l108.5,108.5l-132.4,132.4c-6.7,6.7-6.7,17.6,0,24.3c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l132.5-132.5l108.5,108.5c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l20.8-20.8c17.6-17.6,26.1-41.8,23.3-66.4l-7-63.5l40.3-40.3l16.2,16.2c6.7,6.7,17.6,6.7,24.3,0l72.6-72.6c3.2-3.2,5-7.6,5-12.1s-1.8-8.9-5-12.1L300.625,5.025z"/>
    </svg>
  );
}
