import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { motion, useReducedMotion } from 'motion/react';

import Head from 'next/head';
import type { MultichatConfig } from '../../lib/multichatConfig';
import type { ParsedMessage } from '../../lib/kick';
import { sourceTag, PROVIDERS, type SourceTagMode } from '../../lib/render';
import type {
  HypeTrainEventData,
  Platform,
  TwitchAnnouncementEventData,
  TwitchCheerEventData,
  TwitchGiftEventData,
  TwitchMilestoneEventData,
  TwitchRaidEventData,
  TwitchSubscriptionEventData,
  TwitchSubscriptionTransitionEventData,
} from '../../lib/types';
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

export type StartupLoaderPhase = 'hidden' | 'visible' | 'fading';

interface Props {
  config: MultichatConfig;
  messages: ParsedMessage[];
  fadingIds: Set<string>;
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

export const CHAT_OVERLAY_FADE_GROUP_CSS = `
  @keyframes gxFadeGroupIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .gx-fade-group {
    animation: gxFadeGroupIn 220ms ease-in-out;
  }
`;

const SIZE = {
  small: {
    fontSize:'20px', lineHeight:'32px',
    badgeW:'16px', badgeH:'16px', badgeMR:'2px', badgeMB:'3px', badgeLastMR:'3px',
    colonMR:'8px',
    emoteMaxW:'75px', emoteMaxH:'25px', emoteMR:'-3px',
    upscaleH:'25px', emojiH:'22px',
  },
  medium: {
    fontSize:'34px', lineHeight:'58px',
    badgeW:'35px', badgeH:'35px', badgeMR:'6px', badgeMB:'6px', badgeLastMR:'6px',
    colonMR:'14px',
    emoteMaxW:'128px', emoteMaxH:'42px', emoteMR:'-6px',
    upscaleH:'42px', emojiH:'39px',
  },
  large: {
    fontSize:'48px', lineHeight:'79px',
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
  if (s === 'large') return 'drop-shadow(2px 2px 4px #000000)';
  return opacity ? `drop-shadow(2px 2px 3px rgba(0, 0, 0, ${opacity}))` : '';
}

/* The text edge is rendered on a separate, unfiltered pseudo-layer.
   Large uses the approved footprint for GXUFY's locked 34px Medium geometry.
   Small/medium retain the approved compact edge. The real foreground glyph stays
   fully opaque and uses Chromium's native antialiasing, so source colours are
   never mixed into the edge treatment. */
function getTextShadow(s: string, role: 'body' | 'name') {
  if (s === 'large') {
    return role === 'name'
      ? '2.448px 2.72px 1.36px black, 0 0 4.08px black'
      : '2.125px 2.55px 1.36px black, 0 2.55px 5.44px black, 0 0 4.08px rgba(0,0,0,.8)';
  }
  const opacity: Record<string, readonly number[]> = {
    small: [0.35, 0.38, 0.38, 0.4, 0.46, 0.42, 0.48, 0.52, 0.24, 0.32, 0.4, 0.6],
    medium: [0.51, 0.54, 0.54, 0.58, 0.64, 0.61, 0.67, 0.72, 0.34, 0.45, 0.56, 0.77],
  };
  const strength = opacity[s];
  if (!strength) return '';
  return [
    `-1px -1px 0 rgba(0,0,0,${strength[0]})`,
    `0 -1px 0 rgba(0,0,0,${strength[1]})`,
    `1px -1px 0 rgba(0,0,0,${strength[2]})`,
    `-1px 0 0 rgba(0,0,0,${strength[3]})`,
    `1px 0 0 rgba(0,0,0,${strength[4]})`,
    `-1px 1px 0 rgba(0,0,0,${strength[5]})`,
    `0 1px 0 rgba(0,0,0,${strength[6]})`,
    `1px 1px 0 rgba(0,0,0,${strength[7]})`,
    `1.25px 0 0 rgba(0,0,0,${strength[8]})`,
    `0 1.25px 0 rgba(0,0,0,${strength[9]})`,
    `1.25px 1.25px 0 rgba(0,0,0,${strength[10]})`,
    `1.25px 2.75px 1px rgba(0,0,0,${strength[11]})`,
  ].join(', ');
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



type ReferenceTextElementProps = {
  children?: ReactNode;
  className?: unknown;
  style?: React.CSSProperties;
};

const REFERENCE_TEXT_MEDIA_TAGS = new Set([
  'audio',
  'canvas',
  'img',
  'picture',
  'source',
  'svg',
  'video',
]);

const REFERENCE_TEXT_ISOLATED_CLASSES = [
  'ck-emote',
  'ck-name-paint',
  'ck-name-pill',
  'ck-twitch-gif',
  'ck-zw',
  'gx-emote-effect',
];

function preserveReferenceTextElement(
  element: ReactElement<ReferenceTextElementProps>,
): boolean {
  if (
    typeof element.type === 'string'
    && REFERENCE_TEXT_MEDIA_TAGS.has(element.type)
  ) {
    return true;
  }

  const className = typeof element.props.className === 'string'
    ? element.props.className
    : '';
  if (REFERENCE_TEXT_ISOLATED_CLASSES.some((value) => className.includes(value))) {
    return true;
  }

  const style = element.props.style;
  return Boolean(
    style
    && (
      style.WebkitBackgroundClip === 'text'
      || style.backgroundClip === 'text'
      || style.WebkitTextFillColor === 'transparent'
    )
  );
}

function referenceGlyphWords(value: string, keyPrefix: string): ReactNode[] {
  return value
    .split(/(\s+)/u)
    .filter(Boolean)
    .map((part, index) => {
      if (/^\s+$/u.test(part)) return part;
      return (
        <span
          key={`${keyPrefix}-${index}`}
          className="gx-reference-glyph"
          data-gx-glyph={part}
        >
          <span className="gx-reference-glyph-foreground">{part}</span>
        </span>
      );
    });
}

function referenceWeightNode(node: ReactNode, keyPrefix: string): ReactNode {
  if (typeof node === 'string' || typeof node === 'number') {
    return referenceGlyphWords(String(node), keyPrefix);
  }
  if (!isValidElement<ReferenceTextElementProps>(node)) return node;
  if (preserveReferenceTextElement(node)) return node;
  if (node.props.children === undefined || node.props.children === null) return node;

  return cloneElement(
    node,
    undefined,
    renderReferenceWeightText(node.props.children, `${keyPrefix}-child`),
  );
}

function renderReferenceWeightText(children: ReactNode, keyPrefix: string): ReactNode[] {
  return Children.toArray(children).flatMap((child, index) => {
    const rendered = referenceWeightNode(child, `${keyPrefix}-${index}`);
    return Array.isArray(rendered) ? rendered : [rendered];
  });
}

function ReferenceWeightText({ children }: { children: ReactNode }) {
  return <>{renderReferenceWeightText(children, 'gx-reference-text')}</>;
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
  msg, fading, messageShadowFilter, paintEdgeShadow, sz, emoteMaxH, emoteMaxW,
  hideNames, tagMode, showAvatar, showSharedSource, replyStyle, entryAnimation,
  entryOwnsOpacity,
}: {
  msg: ParsedMessage; fading: boolean; messageShadowFilter: string; paintEdgeShadow: string;
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
      /* The full-width container lets ordinary rows match the reference's
         effective 12px left / 4px right treatment. System rows compensate on
         the right so their already-approved visual bounds do not move. */
      margin: msg.kind === 'system' ? '0 30px 0 10px' : '0 -6px 0 2px',
      display: 'grid',
      gridTemplateRows: fading ? '0fr' : '1fr',
      opacity: fading ? 0 : 1,
      transform: fading ? 'translate3d(0, -6px, 0)' : undefined,
      transformOrigin: 'top center',
      transition: exitTransition,
      willChange: fading ? 'grid-template-rows, opacity, transform' : undefined,
      ...(messageShadowFilter ? { filter: messageShadowFilter } : {}),
    }}>
      <div className="gx-message-row-inner" style={{ minHeight: 0, overflow: 'hidden' }}>
        {entryAnimation === 'none' ? (
          <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
            paintEdgeShadow={paintEdgeShadow} hideNames={hideNames}
            tagMode={tagMode} showAvatar={showAvatar} showSharedSource={showSharedSource} replyStyle={replyStyle} />
        ) : (
          <DirectionalEntry direction={entryAnimation} ownsOpacity={entryOwnsOpacity}>
            <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
              paintEdgeShadow={paintEdgeShadow} hideNames={hideNames}
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

export default function ChatOverlay({ config, messages, fadingIds, showLoader, sourceTagExplicit = false, sourceTagOverride, sharedChatEnabled }: Props) {
  /* Fully typed by MultichatConfig — the schema already declares every field
     read below, so no intersection or cast is needed. */
  const cfg = config;
  const showSharedSource = sharedChatEnabled ?? cfg.sharedChatEnabled;

  const szKey      = (cfg.textSize in SIZE ? cfg.textSize : 'medium') as SzKey;
  const sz: SizeGeometry = cfg.textSizePx === undefined
    ? SIZE[szKey]
    : customSize(cfg.textSizePx);
  /* Draw the configured chat shadow on glyphs instead of filtering the complete
     row, so provider art and emotes do not inherit a second shadow. */
  const messageShadowFilter = '';
  const bodyTextShadow = getTextShadow(cfg.textShadow, 'body');
  const nameTextShadow = getTextShadow(cfg.textShadow, 'name');
  const strokeVal = getStroke(cfg.stroke ?? 'none');
  const renderedBodyTextShadow = [strokeVal, bodyTextShadow].filter(Boolean).join(', ');
  const renderedNameTextShadow = [strokeVal, nameTextShadow].filter(Boolean).join(', ');
  const referenceEdgeActive = Boolean(renderedBodyTextShadow || renderedNameTextShadow);
  const paintEdgeShadow = renderedNameTextShadow;
  const fontFamily = FONT_FAMILIES[cfg.font ?? 'opensans'] ?? FONT_FAMILIES.opensans;
  const openSansRendering = fontFamily === FONT_FAMILIES.opensans;
  const requestedFontWeight = cfg.fontWeight === undefined
    ? null
    : Number(cfg.fontWeight);
  /* Open Sans is genuinely loaded only across 300-800. Keep explicit lighter
     choices and the legacy non-bold body intact, but never ask Chromium to
     fabricate a heavier Open Sans face. Other families retain their existing
     weight behavior because their published ranges differ. */
  const explicitFontWeight = requestedFontWeight === null
    ? null
    : openSansRendering
      ? Math.min(requestedFontWeight, 800)
      : requestedFontWeight;
  const messageFontWeight = explicitFontWeight
    ?? (cfg.msgBold === false ? 400 : 800);
  const nameFontWeight = explicitFontWeight ?? (openSansRendering ? 800 : 900);
  const textTransform = cfg.textTransform === 'none'
    ? (cfg.msgCaps ? 'uppercase' : undefined)
    : cfg.textTransform;
  /* Naming a family does not load it. Only the selected face is requested, and
     system faces and the self-hosted Alsina yield null — see lib/overlayFonts. */
  const fontCss    = overlayFontCss(cfg.font, {
    fontWeight: messageFontWeight,
    fontItalic: cfg.fontItalic,
  });
  
  /* The main animation mode is authoritative. Slide owns the approved measured
     height reveal; Fade owns opacity only; None is a direct render. The legacy
     smoothScroll query still parses for copied URLs, but must not add position
     motion behind either None or Fade. */
  const smoothRuntime = false;
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
      paintEdgeShadow={paintEdgeShadow}
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
        ${CHAT_OVERLAY_FADE_GROUP_CSS}
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
            transform-origin: center center;
            transition:     transform 140ms cubic-bezier(.2,.8,.2,1);
          }
          .ck-bw img:hover,
          .ck-bw svg:hover,
          .ck-badge-img:hover {
            transform: translateY(-1px) scale(1.12);
          }

          @media (prefers-reduced-motion: reduce) {
            .ck-bw img,
            .ck-bw svg,
            .ck-badge-img {
              transition: none !important;
              transform: none !important;
            }
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
            letter-spacing: 0;
            word-spacing: 0;
            ${openSansRendering ? 'font-synthesis: none;' : ''}
          }

          .ck-body {
            display: inline !important;
            white-space: normal;
            font-weight: ${messageFontWeight} !important;
            line-height: inherit !important;
            text-shadow: none !important;
          }

          .ck-name {
            overflow-wrap: anywhere;
            margin-right: 8px;
            font-weight: ${nameFontWeight} !important;
            display: inline-block;
            line-height: inherit !important;
            text-shadow: none !important;
          }

          /* Each textual word occupies one inline grid cell. Generated content
             supplies an independent, unfiltered dark edge without duplicating
             accessible DOM text or width. The real source-colour glyph sits in
             the same cell with native browser antialiasing. */
          .gx-reference-glyph {
            position: relative;
            display: inline-grid;
            grid-template-columns: minmax(0, auto);
            max-width: 100%;
            color: inherit;
            font: inherit;
            letter-spacing: inherit;
            line-height: inherit;
            vertical-align: baseline;
            overflow: visible;
            transform: none;
          }

          .gx-reference-glyph::before,
          .gx-reference-glyph-foreground {
            grid-area: 1 / 1;
            min-width: 0;
            max-width: 100%;
            color: inherit;
            font: inherit;
            letter-spacing: inherit;
            line-height: inherit;
            overflow-wrap: anywhere;
          }

          .gx-reference-glyph::before {
            /* Chromium paints the first value but exposes the empty alternate
               text to accessibility APIs, so the visual edge never causes the
               real foreground word to be announced twice. */
            content: attr(data-gx-glyph) / "";
            z-index: 0;
            opacity: 1;
            filter: none;
            text-shadow: ${renderedBodyTextShadow || 'none'};
            pointer-events: none;
            user-select: none;
          }

          .ck-name .gx-reference-glyph::before {
            text-shadow: ${renderedNameTextShadow || 'none'};
          }

          .gx-reference-glyph-foreground {
            position: relative;
            z-index: 1;
            opacity: 1;
            filter: none;
            text-shadow: none !important;
            transform: none;
          }

          ${referenceEdgeActive ? '' : `
          .gx-reference-glyph::before {
            visibility: hidden;
          }
          `}

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

          .gx-emote-effect-unit,
          .gx-emote-effect {
            display: inline-block;
            line-height: inherit;
            transform-origin: center;
            vertical-align: middle;
          }

          .gx-emote-effect-squish-x { transform: scaleX(.5); }
          .gx-emote-effect-wide { transform: scaleX(3); }
          .gx-emote-effect-flip-x { transform: scaleX(-1); }
          .gx-emote-effect-flip-y { transform: scaleY(-1); }
          .gx-emote-effect-rotate-right { transform: rotate(90deg); }
          .gx-emote-effect-rotate-left { transform: rotate(-90deg); }
          .gx-emote-effect-rotate-half { transform: rotate(180deg); }
          .gx-emote-effect-half-flip-x { transform: rotate(180deg) scaleX(-1); }
          .gx-emote-effect-cursed { filter: grayscale(1) contrast(2.4); }

          @keyframes gxEmoteShake {
            0%, 100% { transform: translate(0, 0); }
            25% { transform: translate(-.08em, .04em); }
            50% { transform: translate(.08em, -.04em); }
            75% { transform: translate(-.04em, -.07em); }
          }
          @keyframes gxEmoteRainbow {
            from { filter: hue-rotate(0deg); }
            to { filter: hue-rotate(360deg); }
          }
          @keyframes gxEmoteHyper {
            0%, 100% { transform: translate(0, 0) rotate(0); }
            25% { transform: translate(-.12em, .04em) rotate(-4deg); }
            50% { transform: translate(.1em, -.09em) rotate(3deg); }
            75% { transform: translate(.05em, .1em) rotate(-2deg); }
          }
          @keyframes gxEmoteSlide {
            0%, 100% { transform: translateX(-.35em); }
            50% { transform: translateX(.35em); }
          }
          @keyframes gxEmoteJam {
            0%, 100% { transform: translateY(0) rotate(-3deg); }
            50% { transform: translateY(-.16em) rotate(3deg); }
          }
          @keyframes gxEmoteBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-.3em); }
          }
          @keyframes gxEmoteSpin {
            to { transform: rotate(360deg); }
          }
          @keyframes gxEmoteArrive {
            0% { transform: translateX(-.7em) scale(.7); opacity: .2; }
            45%, 100% { transform: translateX(0) scale(1); opacity: 1; }
          }
          @keyframes gxEmoteLeave {
            0%, 55% { transform: translateX(0) scale(1); opacity: 1; }
            100% { transform: translateX(.7em) scale(.7); opacity: .2; }
          }

          .gx-emote-effect-shake { animation: gxEmoteShake .35s steps(2, end) infinite; }
          .gx-emote-effect-rainbow { animation: gxEmoteRainbow 2s linear infinite; }
          .gx-emote-effect-hyper { animation: gxEmoteHyper .22s steps(2, end) infinite; }
          .gx-emote-effect-slide { animation: gxEmoteSlide .8s ease-in-out infinite; }
          .gx-emote-effect-jam { animation: gxEmoteJam .48s ease-in-out infinite; }
          .gx-emote-effect-bounce { animation: gxEmoteBounce .65s ease-in-out infinite; }
          .gx-emote-effect-spin { animation: gxEmoteSpin 1s linear infinite; }
          .gx-emote-effect-arrive { animation: gxEmoteArrive 1.2s ease-out infinite; }
          .gx-emote-effect-leave { animation: gxEmoteLeave 1.2s ease-in infinite; }

          @media (prefers-reduced-motion: reduce) {
            .gx-emote-effect-animated {
              animation: none !important;
            }
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

          @keyframes gxHypeFlow {
            from {
              background-position: 0% 50%;
            }
            to {
              background-position: 200% 50%;
            }
          }

          @keyframes gxHypeFlash {
            0% {
              opacity: 0;
            }
            18% {
              opacity: .72;
            }
            100% {
              opacity: 0;
            }
          }

          @keyframes gxHypeLevelUp {
            0% {
              opacity: 0;
              transform: translateY(.32em) scale(.92);
            }
            22% {
              opacity: 1;
              transform: translateY(0) scale(1.06);
            }
            75% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
            100% {
              opacity: 0;
              transform: translateY(-.22em) scale(.98);
            }
          }

          .gx-hype-card {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            height: 1.62em;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,.16);
            border-radius: .36em;
            background:
              linear-gradient(
                180deg,
                rgba(24,20,38,.90),
                rgba(12,11,20,.88)
              );
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.08),
              0 .16em .48em rgba(0,0,0,.24);
          }

          .gx-hype-fill {
            position: absolute;
            inset: 0 auto 0 0;
            overflow: hidden;
            background:
              linear-gradient(
                105deg,
                #ff5fa2 0%,
                #9d6cff 22%,
                #5b8cff 43%,
                #35d8df 63%,
                #ffd84a 82%,
                #ff5fa2 100%
              );
            background-size: 200% 100%;
            opacity: .66;
            transition: width 500ms ease-out;
            animation: gxHypeFlow 2.5s linear infinite;
          }

          .gx-hype-fill::after {
            content: "";
            position: absolute;
            top: -20%;
            right: -.12em;
            width: .38em;
            height: 140%;
            border-radius: 50%;
            background: rgba(255,255,255,.34);
            filter: blur(.08em);
          }

          .gx-hype-content {
            position: absolute;
            inset: 0;
            z-index: 3;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: .4em;
            padding: 0 .45em;
            color: #fff;
            text-shadow: 0 1px 2px rgba(0,0,0,.86);
            pointer-events: none;
          }

          .gx-hype-left,
          .gx-hype-right {
            display: inline-flex;
            align-items: center;
            gap: .28em;
            min-width: 0;
            white-space: nowrap;
          }

          .gx-hype-train-icon {
            font-size: .72em;
            line-height: 1;
          }

          .gx-hype-label {
            font-size: .48em;
            font-weight: 900;
            letter-spacing: .035em;
          }

          .gx-hype-level {
            font-size: .44em;
            font-weight: 800;
            opacity: .92;
          }

          .gx-hype-percent {
            position: absolute;
            left: 50%;
            top: 50%;
            z-index: 4;
            transform: translate(-50%, -50%);
            font-size: .62em;
            line-height: 1;
            font-weight: 950;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          }

          .gx-hype-progress {
            font-size: .38em;
            font-weight: 750;
            opacity: .92;
            font-variant-numeric: tabular-nums;
          }

          .gx-hype-remaining {
            font-size: .34em;
            opacity: .72;
          }

          .gx-hype-flash {
            position: absolute;
            inset: 0;
            z-index: 5;
            pointer-events: none;
            background: #fff;
            animation: gxHypeFlash 850ms ease-out both;
          }

          .gx-hype-levelup {
            position: absolute;
            inset: 0;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            color: #fff;
            font-size: .55em;
            font-weight: 950;
            letter-spacing: .035em;
            text-shadow: 0 2px 5px rgba(0,0,0,.9);
            pointer-events: none;
            animation: gxHypeLevelUp 2600ms ease both;
          }

          .gx-hype-complete {
            position: absolute;
            inset: 0;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            background:
              linear-gradient(
                90deg,
                rgba(145,71,255,.72),
                rgba(255,95,162,.72),
                rgba(255,216,74,.66)
              );
            color: #fff;
            font-size: .54em;
            font-weight: 950;
            letter-spacing: .035em;
            text-shadow: 0 2px 5px rgba(0,0,0,.9);
            pointer-events: none;
          }

          @media (prefers-reduced-motion: reduce) {
            .gx-hype-fill {
              animation: none !important;
              transition: none !important;
            }

            .gx-hype-flash,
            .gx-hype-levelup {
              animation: none !important;
            }
          }

          .gx-announcement-card,
          .gx-milestone-card {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: .44em;
            min-height: 1.55em;
            overflow: hidden;
            padding: .16em .42em .18em .28em;
            border: 1px solid var(--gx-notice-color);
            border-left-width: .12em;
            border-radius: .34em;
            background-color: transparent;
            background-image: none;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.07),
              0 .12em .38em rgba(0,0,0,.18);
          }

          .gx-notice-icon {
            position: relative;
            z-index: 1;
            flex: 0 0 auto;
            width: 1.18em;
            height: 1.18em;
            display: grid;
            place-items: center;
            font-size: .74em;
            line-height: 1;
          }

          .gx-notice-copy {
            position: relative;
            z-index: 1;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.18;
          }

          .gx-notice-header {
            min-width: 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .18em;
            font-size: .52em;
            font-weight: 800;
          }

          .gx-notice-name {
            font-size: 1em;
            line-height: 1;
            font-weight: 950;
            letter-spacing: .005em;
            margin-right: .06em;
          }

          .gx-notice-action {
            font-size: 1em;
            line-height: 1.1;
            font-weight: 850;
            color: var(--gx-notice-color);
          }

          .gx-notice-pill {
            display: inline-flex;
            align-items: center;
            padding: .08em .36em;
            border: 1px solid rgba(255,255,255,.17);
            border-radius: 999px;
            background: rgba(255,255,255,.09);
            color: white;
            font-size: .84em;
            line-height: 1.1;
            font-weight: 900;
            font-variant-numeric: tabular-nums;
          }

          .gx-notice-body {
            margin-top: .08em;
            min-width: 0;
            color: rgba(255,255,255,.92);
            font-size: .64em;
            line-height: 1.28;
            overflow-wrap: anywhere;
          }

          .gx-raid-card {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: .46em;
            min-height: 1.58em;
            overflow: hidden;
            padding: .16em .44em .18em .26em;
            border: 1px solid #ff4f91;
            border-left-width: .12em;
            border-radius: .34em;
            background-color: transparent;
            background-image: none;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.07),
              0 .12em .40em rgba(0,0,0,.20);
          }

          .gx-raid-avatar-wrap {
            position: relative;
            z-index: 1;
            flex: 0 0 auto;
            width: 1.24em;
            height: 1.24em;
            display: grid;
            place-items: center;
          }

          .gx-raid-avatar {
            position: relative;
            z-index: 1;
            width: 1.16em;
            height: 1.16em;
            display: block;
            border: .055em solid rgba(255,255,255,.85);
            border-radius: 50%;
            object-fit: cover;
            background: rgba(255,255,255,.08);
          }

          .gx-raid-avatar-fallback {
            position: relative;
            z-index: 1;
            width: 1.16em;
            height: 1.16em;
            display: grid;
            place-items: center;
            border: .055em solid rgba(255,255,255,.70);
            border-radius: 50%;
            background:
              linear-gradient(
                135deg,
                #ff4f91,
                #9147ff
              );
            font-size: .64em;
          }

          .gx-raid-copy {
            position: relative;
            z-index: 1;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.18;
          }

          .gx-raid-header {
            min-width: 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .18em;
            font-size: .52em;
            font-weight: 800;
          }

          .gx-raid-name {
            font-size: 1em;
            line-height: 1;
            font-weight: 950;
            letter-spacing: .005em;
            margin-right: .06em;
          }

          .gx-raid-action {
            font-size: 1em;
            line-height: 1.1;
            font-weight: 850;
            color: #ff9fc2;
          }

          .gx-raid-count {
            display: inline-flex;
            align-items: center;
            padding: .08em .36em;
            border: 1px solid rgba(255,255,255,.17);
            border-radius: 999px;
            background: rgba(255,255,255,.09);
            color: white;
            font-size: .86em;
            line-height: 1.1;
            font-weight: 900;
            font-variant-numeric: tabular-nums;
          }

          .gx-raid-subline {
            margin-top: .08em;
            color: rgba(255,255,255,.72);
            font-size: .47em;
            line-height: 1.25;
          }

          .gx-gift-card {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: .42em;
            min-height: 1.55em;
            overflow: hidden;
            padding: .16em .42em .18em .28em;
            border: 1px solid #ffb84d;
            border-left-width: .12em;
            border-radius: .34em;
            background-color: transparent;
            background-image: none;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.07),
              0 .12em .38em rgba(0,0,0,.18);
          }

          .gx-gift-icon {
            position: relative;
            z-index: 1;
            flex: 0 0 auto;
            width: 1.18em;
            height: 1.18em;
            display: grid;
            place-items: center;
            font-size: .74em;
            line-height: 1;
          }

          .gx-gift-copy {
            position: relative;
            z-index: 1;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.18;
          }

          .gx-gift-header {
            min-width: 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .18em;
            font-size: .52em;
            font-weight: 800;
          }

          .gx-gift-badges {
            display: inline-flex;
            align-items: center;
            flex: 0 0 auto;
          }

          .gx-gift-name {
            font-size: 1em;
            line-height: 1;
            font-weight: 950;
            letter-spacing: .005em;
            margin-right: .06em;
          }

          .gx-gift-action {
            font-size: 1em;
            line-height: 1.1;
            font-weight: 850;
            color: #ffd08a;
            opacity: .98;
          }

          .gx-gift-recipient {
            font-size: 1.08em;
            line-height: 1;
            font-weight: 900;
            color: #ff91ad;
          }

          .gx-gift-total {
            display: inline-flex;
            align-items: center;
            padding: .08em .34em;
            border: 1px solid rgba(255,255,255,.16);
            border-radius: 999px;
            background: rgba(255,255,255,.08);
            color: rgba(255,255,255,.90);
            font-size: .82em;
            line-height: 1.1;
            font-weight: 850;
          }

          .gx-gift-recipients {
            margin-top: .10em;
            min-width: 0;
            color: rgba(255,255,255,.82);
            font-size: .48em;
            line-height: 1.3;
            overflow-wrap: anywhere;
          }

          .gx-gift-recipient-list-name {
            color: #ffb0c4;
            font-weight: 850;
          }

          .gx-sub-card {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: .42em;
            min-height: 1.55em;
            overflow: hidden;
            padding: .16em .42em .18em .28em;
            border: 1px solid #a970ff;
            border-left-width: .12em;
            border-radius: .34em;
            background-color: transparent;
            background-image: none;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.06),
              0 .12em .38em rgba(0,0,0,.18);
          }

          .gx-sub-icon {
            position: relative;
            z-index: 1;
            flex: 0 0 auto;
            width: 1.18em;
            height: 1.18em;
            display: grid;
            place-items: center;
            font-size: .72em;
            line-height: 1;
          }

          .gx-sub-copy {
            position: relative;
            z-index: 1;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.18;
          }

          .gx-sub-header {
            min-width: 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .18em;
            font-size: .52em;
            font-weight: 800;
          }

          .gx-sub-badges {
            display: inline-flex;
            align-items: center;
            flex: 0 0 auto;
          }

          .gx-sub-name {
            font-size: 1em;
            line-height: 1;
            font-weight: 950;
            letter-spacing: .005em;
            margin-right: .06em;
          }

          .gx-sub-action {
            font-size: 1em;
            line-height: 1.1;
            font-weight: 850;
            color: #c9a7ff;
            opacity: .96;
          }

          .gx-sub-body {
            margin-top: .08em;
            min-width: 0;
            font-size: .64em;
            line-height: 1.28;
            color: rgba(255,255,255,.92);
            overflow-wrap: anywhere;
          }

          .gx-cheer-card {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: .42em;
            min-height: 1.55em;
            overflow: hidden;
            padding: .16em .42em .18em .28em;
            border: 1px solid rgba(255,255,255,.14);
            border-left-width: .12em;
            border-radius: .34em;
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,.06),
              0 .12em .38em rgba(0,0,0,.18);
          }

          .gx-cheer-art {
            flex: 0 0 auto;
            width: 1.18em;
            height: 1.18em;
            display: grid;
            place-items: center;
          }

          .gx-cheer-art img {
            display: block;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
          }

          .gx-cheer-art-fallback {
            font-size: .78em;
            line-height: 1;
          }

          .gx-cheer-copy {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.18;
          }

          .gx-cheer-header {
            min-width: 0;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: .18em;
            font-size: .52em;
            font-weight: 800;
          }

          .gx-cheer-badges {
            display: inline-flex;
            align-items: center;
            flex: 0 0 auto;
          }

          .gx-cheer-name {
            font-size: 1em;
            line-height: 1;
            font-weight: 950;
            letter-spacing: .005em;
            margin-right: .06em;
          }

          .gx-cheer-amount {
            font-size: 1em;
            line-height: 1.1;
            font-weight: 850;
            opacity: .94;
          }

          .gx-cheer-body {
            margin-top: .08em;
            min-width: 0;
            font-size: .64em;
            line-height: 1.28;
            color: rgba(255,255,255,.92);
            overflow-wrap: anywhere;
          }

          .gx-cheer-body .ck-native-emote {
            vertical-align: middle;
          }

          /* Every provider's normalized system event shares one compact visual
             grammar: a thin category/source accent, hard-edged neutral copy,
             and one event-color wash that fades fully into the game surface. */
          .gx-event-strip {
            --gx-event-accent: #a970ff;
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            min-height: 0;
            display: flex;
            align-items: flex-start;
            gap: .36em;
            overflow: visible;
            padding: .14em .38em .17em .32em;
            border: 0;
            border-left: .09em solid var(--gx-event-accent);
            border-radius: .18em 0 0 .18em;
            background-color: transparent;
            background-image:
              linear-gradient(
                90deg,
                color-mix(in srgb, var(--gx-event-accent) 18%, transparent) 0%,
                color-mix(in srgb, var(--gx-event-accent) 10%, transparent) 35%,
                transparent 75%
              );
            box-shadow: none;
            color: rgba(255,255,255,.98);
            text-shadow: none;
          }

          .gx-event-strip::after {
            content: none;
            display: none;
            animation: none;
          }

          .gx-event-icon {
            position: relative;
            z-index: 1;
            flex: 0 0 1.08em;
            width: 1.08em;
            height: 1.08em;
            display: grid;
            place-items: center;
            margin-top: .08em;
            color: var(--gx-event-accent, #a970ff);
            font-size: 1em;
            line-height: 1;
          }

          .gx-event-icon-svg,
          .gx-event-icon > img {
            display: block;
            width: .88em;
            height: .88em;
            max-width: .88em;
            max-height: .88em;
            object-fit: contain;
          }

          .gx-event-avatar {
            position: relative;
            z-index: 1;
            display: block;
            width: 1.02em;
            height: 1.02em;
            border: 1px solid rgba(255,255,255,.52);
            border-radius: 50%;
            object-fit: cover;
            background: rgba(255,255,255,.06);
          }

          .gx-event-icon-fallback {
            width: 1.02em;
            height: 1.02em;
            display: grid;
            place-items: center;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: var(--gx-event-accent, #7ba8ff);
            font-size: 1em;
          }

          .gx-event-copy {
            position: relative;
            z-index: 1;
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.2;
          }

          .gx-event-header {
            min-width: 0;
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            gap: .18em;
            font-size: 1em;
            line-height: 1.18;
            font-weight: 700;
          }

          .gx-event-badges {
            display: inline-flex;
            align-items: center;
            align-self: center;
            flex: 0 0 auto;
            line-height: 0;
          }

          .gx-event-name {
            margin-right: .02em;
            font-size: 1em;
            line-height: inherit;
            font-weight: 900;
            letter-spacing: normal;
          }

          .gx-event-action {
            color: rgba(255,255,255,.98);
            font-size: 1em;
            line-height: inherit;
            font-weight: 750;
            opacity: 1;
          }

          .gx-event-accent {
            color: var(--gx-event-accent, #ffb0c4);
            font-weight: 850;
          }

          .gx-event-inline-value {
            display: inline;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            font-size: inherit;
            line-height: inherit;
          }

          .gx-event-body,
          .gx-event-subline {
            min-width: 0;
            margin-top: .12em;
            color: rgba(255,255,255,.96);
            opacity: 1;
            font-size: .86em;
            line-height: 1.28;
            overflow-wrap: anywhere;
          }

          .gx-event-meta {
            display: inline;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: inherit;
            opacity: .72;
            font-size: .86em;
            line-height: inherit;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }

          .gx-event-generic-text {
            min-width: 0;
            color: rgba(255,255,255,.98);
            font-size: 1em;
            line-height: 1.2;
            overflow-wrap: anywhere;
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

      <div id="chat_container" ref={chatContainerRef} style={{
        width:      '100%',
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
          const batchEntryAnimation =
            animate && cfg.animation === 'slide' && messageIds.length === 1
              ? cfg.entryAnimation
              : 'none';
          const content = messageIds
            .map((messageId) => messagesById.get(messageId))
            .filter((message): message is ParsedMessage => Boolean(message))
            .map((message) => renderMsg(
              message,
              batchEntryAnimation,
            ));
          if (animate && cfg.animation==='slide') return (
            <SlideGroup
              key={id}
              batchId={id}
              preserveChildren={
                batchEntryAnimation === 'slideRight' ||
                batchEntryAnimation === 'slideLeft'
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

const HYPE_NUMBER =
  new Intl.NumberFormat('en-US');

export function HypeTrainEventRow({
  data,
}: {
  data: HypeTrainEventData;
}) {
  const reducedMotion =
    useReducedMotion();

  const previous =
    useRef({
      level: data.level,
      progress: data.progress,
    });

  const celebrationTimer =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);

  const [
    celebrating,
    setCelebrating,
  ] = useState(false);

  useEffect(() => {
    if (data.phase !== 'progress') {
      previous.current = {
        level: data.level,
        progress: data.progress,
      };

      if (celebrationTimer.current) {
        clearTimeout(
          celebrationTimer.current,
        );

        celebrationTimer.current =
          null;
      }

      setCelebrating(false);
      return;
    }

    const before =
      previous.current;

    const levelIncreased =
      data.level > before.level;

    const progressReset =
      before.progress > 0 &&
      data.progress <
        before.progress * 0.5 &&
      data.level >=
        before.level;

    previous.current = {
      level: data.level,
      progress: data.progress,
    };

    if (
      reducedMotion ||
      (
        !levelIncreased &&
        !progressReset
      )
    ) {
      return;
    }

    if (celebrationTimer.current) {
      clearTimeout(
        celebrationTimer.current,
      );
    }

    setCelebrating(true);

    celebrationTimer.current =
      setTimeout(() => {
        celebrationTimer.current =
          null;

        setCelebrating(false);
      }, 2600);
  }, [
    data.level,
    data.phase,
    data.progress,
    reducedMotion,
  ]);

  useEffect(
    () => () => {
      if (celebrationTimer.current) {
        clearTimeout(
          celebrationTimer.current,
        );
      }
    },
    [],
  );

  const percentage =
    data.goal > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (
                data.progress /
                data.goal
              ) * 100,
            ),
          ),
        )
      : 0;

  const remaining =
    Math.max(
      0,
      data.goal -
        data.progress,
    );

  const progressLabel =
    `${HYPE_NUMBER.format(data.progress)} / ${HYPE_NUMBER.format(data.goal)}`;

  const trainSymbol =
    String.fromCodePoint(
      0x1f682,
    );

  const sparkleSymbol =
    String.fromCodePoint(
      0x2728,
    );

  const celebrationSymbol =
    String.fromCodePoint(
      0x1f389,
    );

  return (
    <div
      className="gx-hype-card"
      data-testid="hype-train-row"
      data-hype-phase={data.phase}
      data-hype-level={data.level}
      aria-label={
        data.phase === 'end'
          ? `Hype Train complete at level ${data.level}`
          : `Hype Train level ${data.level}, ${percentage} percent, ${progressLabel} points`
      }
    >
      <div
        className="gx-hype-fill"
        style={{
          width:
            `${percentage}%`,
        }}
      />

      <div className="gx-hype-content">
        <span className="gx-hype-left">
          <span
            className="gx-hype-train-icon"
            aria-hidden="true"
          >
            {trainSymbol}
          </span>

          <span className="gx-hype-label">
            HYPE TRAIN
          </span>

          <span className="gx-hype-level">
            LVL {data.level}
          </span>
        </span>

        <span className="gx-hype-right">
          <span className="gx-hype-progress">
            {progressLabel}
          </span>

          <span className="gx-hype-remaining">
            {HYPE_NUMBER.format(remaining)} remaining
          </span>
        </span>
      </div>

      <span className="gx-hype-percent">
        {percentage}%
      </span>

      {celebrating && (
        <>
          <span
            className="gx-hype-flash"
            aria-hidden="true"
          />

          <span
            className="gx-hype-levelup"
            aria-hidden="true"
          >
            {sparkleSymbol}
            {' LEVEL UP! - LVL '}
            {data.level}
            {' '}
            {sparkleSymbol}
          </span>
        </>
      )}

      {data.phase === 'end' && (
        <span className="gx-hype-complete">
          {celebrationSymbol}
          {' HYPE TRAIN COMPLETE - LVL '}
          {data.level}
          {' '}
          {celebrationSymbol}
        </span>
      )}
    </div>
  );
}

function twitchSubPlanLabel(
  plan: string,
): string {
  switch (
    plan.toLowerCase()
  ) {
    case 'prime':
      return 'Prime';

    case '1000':
      return 'Tier 1';

    case '2000':
      return 'Tier 2';

    case '3000':
      return 'Tier 3';

    default:
      return (
        plan.trim()
          ? plan
          : 'sub'
      );
  }
}

function twitchAnnouncementColor(
  color: string,
): string {
  switch (
    color.toUpperCase()
  ) {
    case 'BLUE':
      return '#3b82f6';

    case 'GREEN':
      return '#22c55e';

    case 'ORANGE':
      return '#f97316';

    case 'PURPLE':
      return '#a855f7';

    case 'PRIMARY':
    default:
      return '#9147ff';
  }
}

type TwitchEventIconKind =
  | 'prime'
  | 'gift'
  | 'raid'
  | 'watch-streak'
  | 'bits'
  | 'modiversary'
  | 'announcement';

function TwitchEventIcon({
  kind,
}: {
  kind: TwitchEventIconKind;
}) {
  const common = {
    className: 'gx-event-icon-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    focusable: false,
    'aria-hidden': true,
  };

  switch (kind) {
    case 'prime':
      return (
        <svg {...common}>
          <path d="m3 7 4.2 4 4.8-7 4.8 7L21 7l-2 11H5L3 7Z" />
          <path d="M5 21h14" />
        </svg>
      );

    case 'gift':
      return (
        <svg {...common}>
          <path d="M3 9h18v12H3zM2 5h20v4H2zM12 5v16" />
          <path d="M12 5H7.7A2.2 2.2 0 1 1 10 2.8L12 5Zm0 0h4.3A2.2 2.2 0 1 0 14 2.8L12 5Z" />
        </svg>
      );

    case 'raid':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.3" />
          <path d="M3 20c.3-4 2.3-6 6-6s5.7 2 6 6M14 15c3.8 0 6 1.7 6.4 5" />
        </svg>
      );

    case 'watch-streak':
      return (
        <svg {...common}>
          <path d="M13.2 2.5c.6 3.2-.7 4.7-2.1 6.3-1.1-1-1.5-2.1-1.4-3.6C6 7.8 4 10.7 4 14a8 8 0 0 0 16 0c0-4.3-2.4-8.3-6.8-11.5Z" />
          <path d="M12 11c2 2 2.8 3.2 2.8 4.8a2.8 2.8 0 1 1-5.6 0c0-1.4.8-2.8 2.8-4.8Z" />
        </svg>
      );

    case 'bits':
      return (
        <svg {...common}>
          <path d="m12 2 7 7-7 13L5 9l7-7Z" />
          <path d="m5 9 7 4 7-4M12 2v11" />
        </svg>
      );

    case 'modiversary':
      return (
        <svg {...common}>
          <path d="m12 2.8 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.4l6.2-.9L12 2.8Z" />
        </svg>
      );

    case 'announcement':
      return (
        <svg {...common}>
          <path d="M4 10v4l11 4V6L4 10ZM15 9l5-3v12l-5-3M7 15l1.4 5h3.3l-2-4" />
        </svg>
      );
  }
}

function TwitchSubscriptionTransitionEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchSubscriptionTransitionEventData;
  hideNames: boolean;
}) {
  const painted =
    Boolean(
      msg.identity.background,
    );

  const nameStyle:
    React.CSSProperties =
      painted
        ? {
            background:
              msg.identity.background,
            WebkitBackgroundClip:
              'text',
            backgroundClip:
              'text',
            color:
              'transparent',
            textShadow:
              'none',
            filter:
              msg.identity.filter ||
              undefined,
          }
        : {
            color:
              msg.identity.color ||
              '#a970ff',
          };

  let action:
    string;

  let detail:
    string | undefined;

  switch (data.type) {
    case 'prime-paid-upgrade':
      action =
        'converted Prime to a paid sub';
      break;

    case 'gift-paid-upgrade':
      action =
        'continued a gifted sub';

      if (
        data.priorGifterDisplayName
      ) {
        detail =
          `originally gifted by ${data.priorGifterDisplayName}`;
      }

      break;

    case 'anonymous-gift-paid-upgrade':
      action =
        'continued an anonymous gifted sub';
      break;

    case 'standard-pay-forward':
      action =
        'paid the gift forward';

      if (
        data.recipientDisplayName &&
        data.priorGifterDisplayName
      ) {
        detail =
          `to ${data.recipientDisplayName} - originally from ${data.priorGifterDisplayName}`;
      }
      else if (
        data.recipientDisplayName
      ) {
        detail =
          `to ${data.recipientDisplayName}`;
      }
      else if (
        data.priorGifterDisplayName
      ) {
        detail =
          `originally from ${data.priorGifterDisplayName}`;
      }

      break;

    case 'community-pay-forward':
      action =
        'paid the gift forward to the community';

      if (
        data.priorGifterDisplayName
      ) {
        detail =
          `originally from ${data.priorGifterDisplayName}`;
      }

      break;
  }

  const showDetail =
    !hideNames &&
    Boolean(detail);

  const iconKind:
    TwitchEventIconKind =
      data.type ===
      'prime-paid-upgrade'
        ? 'prime'
        : 'gift';

  return (
    <div
      className="gx-event-strip gx-event-subscription gx-sub-card"
      data-testid="twitch-subscription-transition-row"
      data-transition-type={data.type}
      style={
        {
          '--gx-event-accent':
            '#c9a7ff',
        } as React.CSSProperties
      }
    >
      <span
        className="gx-event-icon gx-sub-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind={iconKind}
        />
      </span>

      <span className="gx-event-copy gx-sub-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-sub-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-sub-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={index}
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <span
                className="gx-event-name gx-sub-name"
                style={nameStyle}
              >
                {
                  msg.identity
                    .username
                }
              </span>
            </>
          )}

          <span className="gx-event-action gx-sub-action">
            {action}
            {data.plan && (
              <>
                {' with '}
              {twitchSubPlanLabel(
                data.plan,
              )}
              </>
            )}
          </span>

          {data.promoGiftTotal && (
            <span className="gx-event-meta">
              {data.promoGiftTotal.toLocaleString()}
              {' promo '}
              {data.promoGiftTotal ===
              1
                ? 'gift'
                : 'gifts'}
            </span>
          )}
        </span>

        {showDetail && (
          <span className="gx-event-body gx-sub-body">
            {detail}
          </span>
        )}

        {data.promoName && (
          <span className="gx-event-body gx-sub-body">
            {data.promoName}
          </span>
        )}

        {msg.message.length >
          0 && (
          <span className="gx-event-body gx-sub-body ck-body">
            {msg.message.map(
              (
                node,
                index,
              ) => (
                <Fragment
                  key={index}
                >
                  {node}
                </Fragment>
              ),
            )}
          </span>
        )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchAnnouncementEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchAnnouncementEventData;
  hideNames: boolean;
}) {
  const color =
    twitchAnnouncementColor(
      data.color,
    );

  return (
    <div
      className="gx-event-strip gx-event-announcement gx-announcement-card"
      data-testid="twitch-announcement-row"
      style={
        {
          '--gx-event-accent':
            color,
        } as React.CSSProperties
      }
    >
      <span
        className="gx-event-icon gx-notice-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind="announcement"
        />
      </span>

      <span className="gx-event-copy gx-notice-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-notice-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length > 0 && (
                <span className="gx-event-badges">
                  {msg.identity.badges.map((badge, index) => (
                    <Fragment key={index}>
                      {badge}
                    </Fragment>
                  ))}
                </span>
              )}

              <span
                className="gx-event-name gx-notice-name"
                style={{
                  color:
                    msg.identity.color ||
                    color,
                }}
              >
                {
                  msg.identity
                    .username
                }
              </span>
            </>
          )}

          <span className="gx-event-action gx-notice-action">
            announced
          </span>
        </span>

        {msg.message.length >
          0 && (
          <span className="gx-event-body gx-notice-body ck-body">
            {msg.message.map(
              (
                node,
                index,
              ) => (
                <Fragment
                  key={index}
                >
                  {node}
                </Fragment>
              ),
            )}
          </span>
        )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchMilestoneEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchMilestoneEventData;
  hideNames: boolean;
}) {
  const visual =
    data.type ===
    'watch-streak'
      ? {
          color:
            '#f6c344',
          icon:
            'watch-streak' as const,
          action:
            `watched ${data.value.toLocaleString()} consecutive streams`,
        }
      : data.type ===
        'bits-badge'
        ? {
            color:
              '#38bdf8',
            icon:
              'bits' as const,
            action:
              `unlocked the ${data.value.toLocaleString()} Bits badge`,
          }
        : {
            color:
              '#22c55e',
            icon:
              'modiversary' as const,
            action:
              `celebrates ${data.value.toLocaleString()} months as a moderator`,
          };

  return (
    <div
      className="gx-event-strip gx-event-milestone gx-milestone-card"
      data-testid="twitch-milestone-row"
      data-milestone-type={data.type}
      style={
        {
          '--gx-event-accent':
            visual.color,
        } as React.CSSProperties
      }
    >
      <span
        className="gx-event-icon gx-notice-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind={visual.icon}
        />
      </span>

      <span className="gx-event-copy gx-notice-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-notice-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length > 0 && (
                <span className="gx-event-badges">
                  {msg.identity.badges.map((badge, index) => (
                    <Fragment key={index}>
                      {badge}
                    </Fragment>
                  ))}
                </span>
              )}

              <span
                className="gx-event-name gx-notice-name"
                style={{
                  color:
                    msg.identity.color ||
                    visual.color,
                }}
              >
                {
                  msg.identity
                    .username
                }
              </span>
            </>
          )}

          <span className="gx-event-action gx-notice-action">
            {visual.action}
          </span>

          {data.channelPoints && (
            <span className="gx-event-meta gx-notice-pill">
              +
              {data.channelPoints.toLocaleString()}
              {' points'}
            </span>
          )}
        </span>

        {msg.message.length >
          0 && (
          <span className="gx-event-body gx-notice-body ck-body">
            {msg.message.map(
              (
                node,
                index,
              ) => (
                <Fragment
                  key={index}
                >
                  {node}
                </Fragment>
              ),
            )}
          </span>
        )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchRaidEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchRaidEventData;
  hideNames: boolean;
}) {
  const [
    avatarFailed,
    setAvatarFailed,
  ] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [
    data.profileImageUrl,
  ]);

  const painted =
    Boolean(
      msg.identity.background,
    );

  const nameStyle:
    React.CSSProperties =
      painted
        ? {
            background:
              msg.identity.background,
            WebkitBackgroundClip:
              'text',
            backgroundClip:
              'text',
            color:
              'transparent',
            textShadow:
              'none',
            filter:
              msg.identity.filter ||
              undefined,
          }
        : {
            color:
              msg.identity.color ||
              '#ff8fbb',
          };

  const showAvatar =
    !hideNames &&
    Boolean(
      data.profileImageUrl,
    ) &&
    !avatarFailed;

  return (
    <div
      className="gx-event-strip gx-event-raid gx-raid-card"
      data-testid="twitch-raid-row"
      data-raid-viewers={data.viewers}
      style={
        {
          '--gx-event-accent':
            '#8da8ff',
        } as React.CSSProperties
      }
    >
      <span className="gx-event-icon gx-raid-avatar-wrap">
        {showAvatar ? (
          <img
            className="gx-event-avatar gx-raid-avatar"
            src={data.profileImageUrl}
            alt=""
            aria-hidden="true"
            onError={() =>
              setAvatarFailed(true)
            }
          />
        ) : (
          <span
            className="gx-event-icon-fallback gx-raid-avatar-fallback"
            aria-hidden="true"
          >
            <TwitchEventIcon
              kind="raid"
            />
          </span>
        )}
      </span>

      <span className="gx-event-copy gx-raid-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-raid-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length > 0 && (
                <span className="gx-event-badges">
                  {msg.identity.badges.map((badge, index) => (
                    <Fragment key={index}>
                      {badge}
                    </Fragment>
                  ))}
                </span>
              )}

              <span
                className="gx-event-name gx-raid-name"
                style={nameStyle}
              >
                {data.raiderDisplayName}
              </span>
            </>
          )}

          <span className="gx-event-action gx-raid-action">
            raided with{' '}
            <span className="gx-event-accent gx-event-inline-value gx-raid-count">
              {data.viewers.toLocaleString()}{' '}
              {data.viewers === 1
                ? 'viewer'
                : 'viewers'}
            </span>
          </span>
        </span>

        {!hideNames &&
          data.raiderLogin &&
          data.raiderLogin.toLowerCase() !==
            data.raiderDisplayName.toLowerCase() && (
            <span className="gx-event-subline gx-raid-subline">
              @{data.raiderLogin}
            </span>
          )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchGiftEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchGiftEventData;
  hideNames: boolean;
}) {
  const painted =
    Boolean(
      msg.identity.background,
    );

  const nameStyle:
    React.CSSProperties =
      painted
        ? {
            background:
              msg.identity.background,
            WebkitBackgroundClip:
              'text',
            backgroundClip:
              'text',
            color:
              'transparent',
            textShadow:
              'none',
            filter:
              msg.identity.filter ||
              undefined,
          }
        : {
            color:
              msg.identity.color ||
              '#ff91ad',
          };

  const plan =
    twitchSubPlanLabel(
      data.plan,
    );

  const recipients =
    data.recipients ??
    [];

  return (
    <div
      className="gx-event-strip gx-event-gift gx-gift-card"
      data-testid="twitch-gift-row"
      data-gift-type={data.type}
      data-gift-count={data.count}
      style={
        {
          '--gx-event-accent':
            '#ffb184',
        } as React.CSSProperties
      }
    >
      <span
        className="gx-event-icon gx-gift-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind="gift"
        />
      </span>

      <span className="gx-event-copy gx-gift-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-gift-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-gift-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={index}
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <span
                className="gx-event-name gx-gift-name"
                style={nameStyle}
              >
                {data.anonymous
                  ? 'Anonymous'
                  : msg.identity.username}
              </span>
            </>
          )}

          {data.type ===
          'community' ? (
            <span className="gx-event-action gx-gift-action">
              gifted{' '}
              {data.count.toLocaleString()}{' '}
              {plan} subs
            </span>
          ) : (
            <>
              <span className="gx-event-action gx-gift-action">
                gifted a {plan} sub
                {data.recipient &&
                !hideNames
                  ? ' to'
                  : ''}
              </span>

              {data.recipient &&
                !hideNames && (
                  <span className="gx-event-accent gx-event-inline-value gx-gift-recipient">
                    {' '}
                    {
                      data.recipient
                        .displayName
                    }
                  </span>
                )}
            </>
          )}

          {data.senderCount && (
            <span className="gx-event-meta gx-gift-total">
              {data.senderCount.toLocaleString()}{' '}
              total gifted
            </span>
          )}
        </span>

        {data.type ===
          'community' &&
          recipients.length >
            0 &&
          !hideNames && (
            <span className="gx-event-subline gx-gift-recipients">
              {recipients.length.toLocaleString()}
              {' of '}
              {data.count.toLocaleString()}
              {' gifted to '}
              {recipients.map(
                (
                  recipient,
                  index,
                ) => (
                  <Fragment
                    key={
                      recipient.userId ??
                      recipient.username ??
                      `${recipient.displayName}-${index}`
                    }
                  >
                    {index >
                      0 && ', '}

                    <span className="gx-event-accent gx-gift-recipient-list-name">
                      {
                        recipient.displayName
                      }
                    </span>
                  </Fragment>
                ),
              )}
            </span>
          )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchSubscriptionEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchSubscriptionEventData;
  hideNames: boolean;
}) {
  const painted =
    Boolean(
      msg.identity.background,
    );

  const nameStyle:
    React.CSSProperties =
      painted
        ? {
            background:
              msg.identity.background,
            WebkitBackgroundClip:
              'text',
            backgroundClip:
              'text',
            color:
              'transparent',
            textShadow:
              'none',
            filter:
              msg.identity.filter ||
              undefined,
          }
        : {
            color:
              msg.identity.color,
          };

  const plan =
    twitchSubPlanLabel(
      data.plan,
    );

  const action =
    data.type === 'resub'
      ? (
          `resubscribed for ${data.months.toLocaleString()} ` +
          (
            data.months === 1
              ? 'month'
              : 'months'
          ) +
          ` with ${plan}`
        )
      : `subscribed with ${plan}`;

  const streak =
    data.streakMonths &&
    data.streakMonths > 1
      ? (
          ` - ${data.streakMonths.toLocaleString()} month streak`
        )
      : '';

  return (
    <div
      className="gx-event-strip gx-event-subscription gx-sub-card"
      data-testid="twitch-subscription-row"
      data-sub-type={data.type}
      data-sub-months={data.months}
      style={
        {
          '--gx-event-accent':
            '#c9a7ff',
        } as React.CSSProperties
      }
    >
      <span
        className="gx-event-icon gx-sub-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind={
            data.plan.toLowerCase() ===
            'prime'
              ? 'prime'
              : 'gift'
          }
        />
      </span>

      <span className="gx-event-copy gx-sub-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-sub-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-sub-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={index}
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <span
                className="gx-event-name gx-sub-name"
                style={nameStyle}
              >
                {
                  msg.identity
                    .username
                }
              </span>
            </>
          )}

          <span className="gx-event-action gx-sub-action">
            {action}
            {streak}
          </span>
        </span>

        {msg.message.length > 0 &&
          !(
            msg.message.length === 1 &&
            msg.message[0] === ''
          ) && (
            <span className="gx-event-body gx-sub-body ck-body">
              {msg.message.map(
                (
                  node,
                  index,
                ) => (
                  <Fragment
                    key={index}
                  >
                    {node}
                  </Fragment>
                ),
              )}
            </span>
          )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchCheermoteArt({
  visual,
}: {
  visual:
    TwitchCheerEventData[
      'cheermotes'
    ][number] | undefined;
}) {
  const initial =
    visual?.animatedUrl ??
    visual?.staticUrl ??
    '';

  const [
    src,
    setSrc,
  ] = useState(initial);

  useEffect(() => {
    setSrc(
      visual?.animatedUrl ??
        visual?.staticUrl ??
        '',
    );
  }, [
    visual?.animatedUrl,
    visual?.staticUrl,
  ]);

  if (!src) {
    return (
      <span
        className="gx-event-icon-fallback gx-cheer-art-fallback"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind="bits"
        />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => {
        if (
          visual?.staticUrl &&
          src !==
            visual.staticUrl
        ) {
          setSrc(
            visual.staticUrl,
          );

          return;
        }

        setSrc('');
      }}
    />
  );
}

function TwitchCheerEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchCheerEventData;
  hideNames: boolean;
}) {
  const primary =
    data.cheermotes.reduce<
      TwitchCheerEventData[
        'cheermotes'
      ][number] | undefined
    >(
      (
        current,
        candidate,
      ) =>
        !current ||
        candidate.bits >
          current.bits
          ? candidate
          : current,
      undefined,
    );

  const color =
    primary?.color ??
    '#9147ff';

  const painted =
    Boolean(
      msg.identity.background,
    );

  const nameStyle:
    React.CSSProperties =
      painted
        ? {
            background:
              msg.identity.background,
            WebkitBackgroundClip:
              'text',
            backgroundClip:
              'text',
            color:
              'transparent',
            textShadow:
              'none',
            filter:
              msg.identity.filter ||
              undefined,
          }
        : {
            color:
              msg.identity.color,
          };

  return (
    <div
      className="gx-event-strip gx-event-bits gx-cheer-card"
      data-testid="twitch-cheer-row"
      data-cheer-bits={data.bits}
      style={
        {
          '--gx-event-accent':
            color,
        } as React.CSSProperties
      }
    >
      <span className="gx-event-icon gx-cheer-art">
        <TwitchCheermoteArt
          visual={primary}
        />
      </span>

      <span className="gx-event-copy gx-cheer-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-cheer-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-cheer-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={
                          index
                        }
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <span
                className="gx-event-name gx-cheer-name"
                style={
                  nameStyle
                }
              >
                {
                  msg.identity
                    .username
                }
              </span>
            </>
          )}

          <span className="gx-event-action gx-cheer-amount">
            cheered{' '}
            <span className="gx-event-accent gx-event-inline-value">
              {data.bits.toLocaleString()}{' '}
              {data.bits === 1
                ? 'bit'
                : 'bits'}
            </span>
          </span>
        </span>

        <span className="gx-event-body gx-cheer-body ck-body">
          {msg.message.map(
            (
              node,
              index,
            ) => (
              <Fragment
                key={index}
              >
                {node}
              </Fragment>
            ),
          )}
        </span>
        </ReferenceWeightText>
      </span>
    </div>
  );
}

const CATEGORY_ICON: Record<string, string> = {
  subscription: '★', gift: '🎁', raid: '👥', cheer: '💰',
  milestone: '🔥', follow: '❤️', announcement: '📣',
};

const CATEGORY_EVENT_CLASS: Record<string, string> = {
  subscription: 'gx-event-subscription',
  gift: 'gx-event-gift',
  raid: 'gx-event-raid',
  cheer: 'gx-event-bits',
  milestone: 'gx-event-milestone',
  follow: 'gx-event-follow',
  announcement: 'gx-event-announcement',
};

function splitLeadingEventUsername(msg: ParsedMessage): React.ReactNode[] | null {
  const username = msg.identity.username.trim();
  const first = msg.message[0];
  if (!username || typeof first !== 'string') return null;
  if (first.slice(0, username.length).toLowerCase() !== username.toLowerCase()) return null;

  const boundary = first.charAt(username.length);
  if (boundary && !/[\s:,–—-]/u.test(boundary)) return null;

  const remainder = first.slice(username.length).replace(/^\s+/u, '');
  return remainder
    ? [remainder, ...msg.message.slice(1)]
    : msg.message.slice(1);
}

function MsgLine({ msg, sz, emoteMaxH, emoteMaxW, paintEdgeShadow, hideNames, tagMode, showAvatar, showSharedSource, replyStyle }: {
  msg: ParsedMessage; sz: SizeGeometry;
  emoteMaxH:string; emoteMaxW:string; paintEdgeShadow:string;
  hideNames:boolean;
  tagMode:SourceTagMode; showAvatar:boolean; showSharedSource:boolean;
  replyStyle: MultichatConfig['replyStyle'];
}) {
  const isPaint = !!msg.identity.background;
  const pill = msg.identity.namePill?.split('|');
  const nameStyle: React.CSSProperties = pill
    ? {
        background:pill[0],
        color:pill[1],
        borderRadius:'0.4em',
        padding:'0 0.35em',
        WebkitTextStroke:'0px',
        textShadow:'none',
        fontWeight:800,
      }
    : isPaint
    ? {
        backgroundImage:msg.identity.background,
        filter:msg.identity.filter || undefined,
        WebkitTextFillColor:'transparent',
        WebkitBackgroundClip:'text',
        backgroundClip:'text',
        backgroundSize:'cover',
        WebkitTextStroke:'0px',
        textShadow:'none',
        fontWeight:800,
      }
    : {
        color:msg.identity.color,
        fontWeight:800,
      };

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
  const nameNode = pill ? (
    <span
      className="ck-name ck-chat-name ck-name-pill"
      style={nameStyle}
    >
      {`${msg.identity.username}:`}
    </span>
  ) : isPaint ? (
    <span
      className="ck-name ck-chat-name ck-name-paint"
      style={{
        display:'inline-grid',
        fontWeight:800,
        textShadow:'none',
      }}
    >
      {paintEdgeShadow ? (
        <span
          aria-hidden="true"
          className="gx-paint-edge"
          style={{
            gridArea:'1 / 1',
            color:'transparent',
            textShadow:paintEdgeShadow,
            WebkitTextStroke:'0px',
            zIndex:1,
            pointerEvents:'none',
          }}
        >
          {`${msg.identity.username}:`}
        </span>
      ) : null}

      <span
        className="gx-paint-foreground"
        style={{
          ...nameStyle,
          gridArea:'1 / 1',
          zIndex:2,
        }}
      >
        {`${msg.identity.username}:`}
      </span>
    </span>
  ) : (
    <span
      className="ck-name ck-chat-name"
      style={nameStyle}
    >
      <ReferenceWeightText>
        {`${msg.identity.username}:`}
      </ReferenceWeightText>
    </span>
  );

if (
    msg.kind === 'system' &&
    msg.category === 'hypetrain' &&
    msg.hypeTrain
  ) {
    return (
      <div
        style={{
          lineHeight: sz.lineHeight,
          wordBreak: 'break-word',
          display: 'flex',
          alignItems: 'center',
          gap: '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <HypeTrainEventRow
          data={msg.hypeTrain}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'subscription' &&
    msg.twitchSubscriptionTransition
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchSubscriptionTransitionEventRow
          msg={msg}
          data={
            msg.twitchSubscriptionTransition
          }
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'announcement' &&
    msg.twitchAnnouncement
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchAnnouncementEventRow
          msg={msg}
          data={
            msg.twitchAnnouncement
          }
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'milestone' &&
    msg.twitchMilestone
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchMilestoneEventRow
          msg={msg}
          data={
            msg.twitchMilestone
          }
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'raid' &&
    msg.twitchRaid
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchRaidEventRow
          msg={msg}
          data={msg.twitchRaid}
          hideNames={hideNames}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'gift' &&
    msg.twitchGift
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchGiftEventRow
          msg={msg}
          data={msg.twitchGift}
          hideNames={hideNames}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'subscription' &&
    msg.twitchSubscription
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchSubscriptionEventRow
          msg={msg}
          data={msg.twitchSubscription}
          hideNames={hideNames}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'cheer' &&
    msg.twitchCheer
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchCheerEventRow
          msg={msg}
          data={msg.twitchCheer}
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (msg.kind === 'system') {
    const color = msg.platform ? PROVIDERS[msg.platform as Platform].color : '#888';
    const category = msg.category ?? 'announcement';
    const eventClass = CATEGORY_EVENT_CLASS[category] ?? 'gx-event-announcement';
    const eventBody = splitLeadingEventUsername(msg);
    return (
      <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word', display:'flex', alignItems:'flex-start', gap:'0.3em' }}>
        {tag && <span style={{ flexShrink:0 }}>{tag}</span>}
        {sourceChannel}
        <div
          className={`gx-event-strip ${eventClass}`}
          data-testid="system-event-row"
          data-event-platform={msg.platform}
          data-event-category={category}
          style={{ '--gx-event-accent': color } as React.CSSProperties}
        >
          <span className="gx-event-icon" aria-hidden="true">
            <span className="gx-event-icon-fallback">
              {CATEGORY_ICON[category] ?? '📣'}
            </span>
          </span>
          <span className="gx-event-copy">
            <ReferenceWeightText>
              {eventBody ? (
                <span className="gx-event-header">
                  <span className="gx-event-name" style={nameStyle}>
                    {msg.identity.username}
                  </span>
                  <span className="gx-event-generic-text ck-body">
                    {eventBody.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
                  </span>
                </span>
              ) : (
                <span className="gx-event-generic-text ck-body">
                  {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
                </span>
              )}
            </ReferenceWeightText>
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
      <span className="ck-body">
        <ReferenceWeightText>
          <span aria-hidden="true">↪ </span>
          <strong style={{ fontWeight:800 }}>{msg.reply.username}</strong>
          {msg.reply.text ? (
            <>
              {' '}
              {msg.reply.renderedText?.length
                ? msg.reply.renderedText
                : msg.reply.text}
            </>
          ) : ''}
        </ReferenceWeightText>
      </span>
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
      <span className="ck-body ck-chat-body">
        <ReferenceWeightText>
          {replyMention}
          {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
        </ReferenceWeightText>
      </span>
    </div>
  );

  const line = replyNode ? <div>{replyNode}{messageLine}</div> : messageLine;
  return msg.redeem ? redeemWrap(line) : line;
}
