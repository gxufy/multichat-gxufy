/*
 * What the chat overlay's settings mean for drawing it, worked out once for
 * the overlay (web/src/lib/overlay/chat/ChatOverlay.svelte): text sizes and
 * badge/emote geometry, shadows and outlines, font family and weights, the
 * source-tag mode, and the overlay's whole stylesheet. The overlay only draws
 * from it.
 */
import type { MultichatConfig } from './multichatConfig';
import {
  LOCAL_OVERLAY_FONT_CSS,
  OVERLAY_FONT_FAMILIES,
  customGoogleFontFamily,
  overlayFontCss,
} from './overlayFonts';
import type { SourceTagMode } from './renderCore';

export const CHAT_OVERLAY_FADE_GROUP_CSS = `
  @keyframes gxFadeGroupIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .gx-fade-group {
    animation: gxFadeGroupIn 220ms ease-in-out;
  }
`;

export const CHAT_SIZE = {
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
export type SzKey = keyof typeof CHAT_SIZE;
export type SizeGeometry = { [Key in keyof (typeof CHAT_SIZE)['medium']]: string };

/** Scale every size-dependent chat metric from the locked 34px/55px medium
 * geometry. Legacy preset URLs still use the exact SIZE table above. */
function customSize(px: number): SizeGeometry {
  const ratio = px / 34;
  const scaled = (value: string) => `${Math.round(parseFloat(value) * ratio * 100) / 100}px`;
  return {
    fontSize: `${px}px`,
    lineHeight: scaled(CHAT_SIZE.medium.lineHeight),
    badgeW: scaled(CHAT_SIZE.medium.badgeW),
    badgeH: scaled(CHAT_SIZE.medium.badgeH),
    badgeMR: scaled(CHAT_SIZE.medium.badgeMR),
    badgeMB: scaled(CHAT_SIZE.medium.badgeMB),
    badgeLastMR: scaled(CHAT_SIZE.medium.badgeLastMR),
    colonMR: scaled(CHAT_SIZE.medium.colonMR),
    emoteMaxW: scaled(CHAT_SIZE.medium.emoteMaxW),
    emoteMaxH: scaled(CHAT_SIZE.medium.emoteMaxH),
    emoteMR: scaled(CHAT_SIZE.medium.emoteMR),
    upscaleH: scaled(CHAT_SIZE.medium.upscaleH),
    emojiH: scaled(CHAT_SIZE.medium.emojiH),
  };
}


/* Apply one composite drop-shadow to each chat row rather than separate
   shadows on the body and username. Existing strength labels map to
   progressively stronger opacity without changing serialized settings. */
export function getMessageShadow(s: string) {
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
const STROKE_WIDTH_PX: Record<string, number> = { thin: 1, medium: 2, thick: 3, thicker: 4 };

/* How far the outline reaches past each glyph edge, in px. */
function getStrokeWidthPx(s: string): number {
  return STROKE_WIDTH_PX[s] ?? 0;
}

function getStroke(s: string) {
  const px = getStrokeWidthPx(s);
  return px
    ? `${px}px ${px}px 0 black, -${px}px ${px}px 0 black, ${px}px -${px}px 0 black, -${px}px -${px}px 0 black`
    : '';
}


export type ChatOverlayViewOptions = {
  /** Whether `sourceTag=` was actually present in the URL (see ChatOverlay's props). */
  sourceTagExplicit?: boolean;
  /** Preview-only override; production callers leave this absent. */
  sourceTagOverride?: SourceTagMode;
  /** Runtime Shared Chat state; omitted callers use config.sharedChatEnabled. */
  sharedChatEnabled?: boolean;
};

export function chatOverlayView(
  config: MultichatConfig,
  { sourceTagExplicit = false, sourceTagOverride, sharedChatEnabled }: ChatOverlayViewOptions = {},
) {
  const cfg = config;
  const showSharedSource = sharedChatEnabled ?? cfg.sharedChatEnabled;

  const szKey      = (cfg.textSize in CHAT_SIZE ? cfg.textSize : 'medium') as SzKey;
  const sz: SizeGeometry = cfg.textSizePx === undefined
    ? CHAT_SIZE[szKey]
    : customSize(cfg.textSizePx);
  /* Draw the configured chat shadow on glyphs instead of filtering the complete
     row, so provider art and emotes do not inherit a second shadow. */
  const messageShadowFilter = '';
  const bodyTextShadow = getTextShadow(cfg.textShadow, 'body');
  const nameTextShadow = getTextShadow(cfg.textShadow, 'name');
  const strokeVal = getStroke(cfg.stroke ?? 'none');
  /* The outline grows outward on both sides of every word, eating the gaps
     between the name and the message and between words; give that space back. */
  const strokeGapPx = getStrokeWidthPx(cfg.stroke ?? 'none') * 2;
  const renderedBodyTextShadow = [strokeVal, bodyTextShadow].filter(Boolean).join(', ');
  const renderedNameTextShadow = [strokeVal, nameTextShadow].filter(Boolean).join(', ');
  const referenceEdgeActive = Boolean(renderedBodyTextShadow || renderedNameTextShadow);
  const paintEdgeShadow = renderedNameTextShadow;
  const fontFamily = OVERLAY_FONT_FAMILIES[cfg.font ?? 'opensans'] ?? OVERLAY_FONT_FAMILIES.opensans;
  /* A custom Google family resolves to the Open Sans fallback here, but
     overlayFontCss draws it in its own face. It must not get the Open Sans
     weight cap or lose synthetic bold and slant: a family published in one
     weight only shows Bold or Italic through synthesis. */
  const customGoogleFamily = customGoogleFontFamily(cfg.font) !== null;
  const openSansRendering = !customGoogleFamily && fontFamily === OVERLAY_FONT_FAMILIES.opensans;
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
  /* Custom families keep the 800 name weight they have always defaulted to. */
  const nameFontWeight = explicitFontWeight ?? (openSansRendering || customGoogleFamily ? 800 : 900);
  const textTransform = cfg.textTransform === 'none'
    ? (cfg.msgCaps ? 'uppercase' : undefined)
    : cfg.textTransform;
  /* Naming a family does not load it. Only the selected face is requested, and
     system faces and the self-hosted Alsina yield null — see lib/overlayFonts. */
  const fontCss    = overlayFontCss(cfg.font, {
    fontWeight: messageFontWeight,
    fontItalic: cfg.fontItalic,
  });

  const emoteScale = cfg.emoteScale ?? 1;
  const emoteMaxH  = `${parseFloat(sz.emoteMaxH) * emoteScale}px`;
  const emoteMaxW  = `${parseFloat(sz.emoteMaxW) * emoteScale}px`;
  const mediumEmoteProfile = szKey === 'medium' && cfg.textSizePx === undefined;
  const regularEmoteHeight = mediumEmoteProfile
    ? `calc(1.7em * ${emoteScale})`
    : emoteMaxH;
  /* Tell the emote renderer how tall emotes are drawn, so it downloads a 7TV
     file that fits instead of always the largest one. */
  const emoteDrawnPx = mediumEmoteProfile
    ? 1.7 * parseFloat(sz.fontSize) * emoteScale
    : parseFloat(emoteMaxH);
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

  return {
    config: cfg,
    showSharedSource,
    szKey,
    sz,
    messageShadowFilter,
    renderedBodyTextShadow,
    renderedNameTextShadow,
    referenceEdgeActive,
    paintEdgeShadow,
    strokeGapPx,
    fontFamily,
    openSansRendering,
    messageFontWeight,
    nameFontWeight,
    textTransform,
    fontCss,
    emoteScale,
    emoteMaxH,
    emoteMaxW,
    mediumEmoteProfile,
    regularEmoteHeight,
    emoteDrawnPx,
    regularEmoteMaxWidth,
    zeroWidthEmoteHeight,
    tagMode,
  };
}

export type ChatOverlayView = ReturnType<typeof chatOverlayView>;

/**
 * The `#chat_container` style. `smoothRuntime` is the legacy smooth-scroll
 * container (column flex, capped height); the overlay passes false: the
 * animation mode owns all motion.
 */
/** The chat container's padding on every side. Under Slide, new rows rise from
 * the inner edge of its bottom padding (see `[data-slide-clip]` below). */
export const CHAT_CONTAINER_PADDING_PX = 10;

export function chatContainerStyle(v: ChatOverlayView, smoothRuntime: boolean) {
  return {
    width:      '100%',
    padding:    `${CHAT_CONTAINER_PADDING_PX}px`,
    position:   'absolute',
    bottom:     0,
    maxHeight:  smoothRuntime ? 'calc(100vh - 20px)' : undefined,
    display:    smoothRuntime ? 'flex' : undefined,
    flexDirection: smoothRuntime ? 'column' : undefined,
    overflow:   'hidden',
    background: 'transparent',
    color:      v.config.fontColor || 'white',
    fontWeight: v.messageFontWeight,
    fontStyle: v.config.fontItalic ? 'italic' : undefined,
    textTransform: v.textTransform,
    wordBreak:  'break-word',
    fontFamily: v.fontFamily,
    fontSize:   v.sz.fontSize,
  } as const;
}

/** The overlay's stylesheet for these settings (one string; renderers memoize it per view). */
export function chatOverlayCss(v: ChatOverlayView): string {
  return `${LOCAL_OVERLAY_FONT_CSS}

          html, body {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            height: 100vh !important;
            position: relative !important;
            background: ${v.config.bgColor || 'transparent'} !important;
          }

          #__next {
            position: static !important;
            height: 0 !important;
            overflow: visible !important;
          }
          ${v.config.font==='alsina' ? `@font-face { font-family:Alsina; src:url(/fonts/Alsina_Ultrajada.ttf); }` : ''}


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
        /* While Slide's track moves: it is its own layer, and the chat is
           clipped at the bottom of its content, where new rows rise from. */
        .gx-slide-track[data-sliding] {
          will-change: transform;
        }
        #chat_container[data-slide-clip] {
          clip-path: inset(0 0 ${CHAT_CONTAINER_PADDING_PX}px 0);
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
            gap:            ${v.sz.badgeMR};
            margin-right:   ${v.sz.badgeLastMR};
            vertical-align: middle;
            line-height:    0;
          }
          .ck-bw img,
          .ck-bw svg,
          .ck-badge-img {
            width:          ${v.sz.badgeW} !important;
            height:         ${v.sz.badgeH} !important;
            min-width:      ${v.sz.badgeW} !important;
            min-height:     ${v.sz.badgeH} !important;
            max-width:      ${v.sz.badgeW} !important;
            max-height:     ${v.sz.badgeH} !important;
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
            max-width: calc(${v.sz.badgeW} * 2.5) !important;
          }

          /* Gxufy supporter badge: the same square as every other badge, the
             whole art stretched to fill it, nothing cropped.
             The image file itself is untouched. */
          img.ck-badge-img.ck-badge-feature {
            object-fit:    fill;
            border-radius: 0;
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
            max-width:      ${v.regularEmoteMaxWidth};
            max-height:     ${v.regularEmoteHeight};
            height:         ${v.regularEmoteHeight};
            width:          auto;
            object-fit:     contain;
            margin-right:   ${v.sz.emoteMR};
            vertical-align: middle;
            display:        inline-block;
          }

          /* Twitch "Gigantify an Emote" power-up: the last emote, 3x. */
          .ck-body.ck-gigantified img.ck-emote:last-of-type {
            height:         calc(${v.regularEmoteHeight} * 3);
            max-height:     calc(${v.regularEmoteHeight} * 3);
            max-width:      none;
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
            margin-right:   ${v.sz.emoteMR};
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
            max-height:     ${v.zeroWidthEmoteHeight};
            height:         ${v.zeroWidthEmoteHeight};
            width:          auto;
          }


          .ck-body img.ck-upscale {
            max-height:     ${v.regularEmoteHeight};
            max-width:      ${v.regularEmoteMaxWidth};
            height:         ${v.regularEmoteHeight};
            width:          auto;
          }

          ${v.mediumEmoteProfile ? `
          /* Twitch-native artwork keeps its intrinsic height while
             applying the same 1.7em ceiling as other Medium emotes. */
          .ck-body img.ck-native-twitch {
            height: auto;
          }
          ` : ''}

          .ck-colon { margin-right: ${v.sz.colonMR}; }

          /*
             Medium geometry and visual treatment preserve the established
             GXUFY proportions and renderer behavior. */
          #chat_container {
            font-family: ${v.fontFamily};
            letter-spacing: 0;
            word-spacing: 0;
            ${v.openSansRendering ? 'font-synthesis: none;' : ''}
          }

          .ck-body {
            display: inline !important;
            white-space: normal;
            word-spacing: ${v.strokeGapPx}px;
            font-weight: ${v.messageFontWeight} !important;
            line-height: inherit !important;
            text-shadow: none !important;
          }

          .ck-name {
            overflow-wrap: anywhere;
            margin-right: ${8 + v.strokeGapPx}px;
            word-spacing: ${v.strokeGapPx}px;
            font-weight: ${v.nameFontWeight} !important;
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
            text-shadow: ${v.renderedBodyTextShadow || 'none'};
            pointer-events: none;
            user-select: none;
          }

          .ck-name .gx-reference-glyph::before {
            text-shadow: ${v.renderedNameTextShadow || 'none'};
          }

          .gx-reference-glyph-foreground {
            position: relative;
            z-index: 1;
            opacity: 1;
            filter: none;
            text-shadow: none !important;
            transform: none;
          }

          ${v.referenceEdgeActive ? '' : `
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

          /* A painted @mention, and a painted name in an event row: the
             outline is drawn from the element's own copy of the word (same
             edge as the rest of the row's text), and the painted word, with
             the paint's own shadows, sits on top in the same cell. */
          .ck-mention-paint {
            position: relative;
            display: inline-grid;
            font-weight: 800;
            text-shadow: none !important;
          }
          .gx-event-name-paint {
            position: relative;
            display: inline-grid;
            text-shadow: none !important;
          }
          .ck-mention-paint::before,
          .ck-mention-paint-fg,
          .gx-event-name-paint::before,
          .gx-event-name-paint-fg {
            grid-area: 1 / 1;
            font: inherit;
            letter-spacing: inherit;
            line-height: inherit;
            overflow-wrap: anywhere;
          }
          .ck-mention-paint::before,
          .gx-event-name-paint::before {
            content: attr(data-gx-glyph) / "";
            color: transparent;
            text-shadow: ${v.renderedBodyTextShadow || 'none'};
            pointer-events: none;
            user-select: none;
          }
          .ck-mention-paint-fg,
          .gx-event-name-paint-fg {
            position: relative;
            z-index: 1;
            text-shadow: none !important;
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
            height: calc(1.2em * ${v.emoteScale}) !important;
            max-height: calc(1.2em * ${v.emoteScale}) !important;
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

          /* Badges keep their usual shadow while the chat has one; Shadow
             None leaves them flat like the text. */
          .ck-bw img,
          .ck-bw svg,
          .ck-badge-img {
            filter: ${v.config.textShadow === 'none' ? 'none' : 'drop-shadow(rgba(0,0,0,.8) 2px 3px .15rem)'} !important;
          }

          #chat_container [data-source-tag="icon"] {
            filter: ${getMessageShadow(v.config.textShadow) || 'none'} !important;
          }
          #chat_container [data-source-tag="icon"] img,
          #chat_container [data-source-tag="icon"] svg {
            filter: none !important;
          }

          /* The Hype Train card (lib/render/hypeTrainCard.tsx). Sizes are in
             em of the chat text; the top row and the percentage use half of it. */
          .gx-hype {
            --gx-hype-fill: linear-gradient(90deg, #ff5fa2, #9d6cff, #5b8cff, #35d8df, #ffd84a, #ff5fa2);
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
          }

          /* No background of its own: the stream shows through, like the
             chat rows around it. */
          .gx-hype-card {
            position: relative;
            overflow: hidden;
            padding: .28em .44em .3em;
            border: 1px solid rgba(255,255,255,.16);
            border-radius: .46em;
            background: transparent;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
            color: #fff;
            text-shadow: 0 1px 2px rgba(0,0,0,.86);
          }

          .gx-hype-card.is-leveling {
            animation: gxHypeRing 900ms ease-out var(--gx-hype-burst-at, 0ms) both;
          }

          .gx-hype-top {
            position: relative;
            display: flex;
            align-items: center;
            gap: .6em;
            height: 1.44em;
            font-size: .5em;
            line-height: 1.44em;
          }

          .gx-hype-info {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: .5em;
            overflow: hidden;
            white-space: nowrap;
            -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 1.4em), transparent);
            mask-image: linear-gradient(90deg, #000 calc(100% - 1.4em), transparent);
            transition: opacity .25s ease;
          }

          .gx-hype-top.is-words .gx-hype-info,
          .gx-hype-top.is-words .gx-hype-clock {
            opacity: 0;
          }

          .gx-hype-mark {
            flex: none;
            display: inline-flex;
            width: 1.76em;
            height: 1.1em;
          }

          .gx-hype-mark .gx-hype-loco {
            width: 100%;
            height: 100%;
          }

          .gx-hype-record {
            flex: none;
            display: inline-flex;
            width: 1.15em;
            height: 1.15em;
            color: #ffd54a;
          }

          .gx-hype-title {
            flex: none;
            font-weight: 800;
            letter-spacing: .02em;
          }

          .gx-hype-plain-name {
            text-transform: uppercase;
            letter-spacing: .06em;
          }

          .gx-hype-name {
            color: var(--gx-hype-accent);
          }

          .gx-hype-dot {
            opacity: .6;
          }

          .gx-hype-level-num {
            font-variant-numeric: tabular-nums;
          }

          .gx-hype-need {
            flex: none;
            display: inline-flex;
            align-items: center;
            gap: .42em;
            height: 1.3em;
            padding: 0 .6em;
            border-radius: 999px;
            background: rgba(0,0,0,.34);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
            font-size: .94em;
            font-weight: 700;
            line-height: 1.3em;
            font-variant-numeric: tabular-nums;
          }

          .gx-hype-need-part {
            display: inline-flex;
            align-items: center;
            gap: .3em;
          }

          .gx-hype-need-rule {
            width: 1px;
            height: .8em;
            background: rgba(255,255,255,.28);
          }

          .gx-hype-gem,
          .gx-hype-gift {
            flex: none;
            width: 1em;
            height: 1em;
          }

          .gx-hype-gem-body { fill: currentColor; }
          .gx-hype-gem-top { fill: rgba(255,255,255,.55); }
          .gx-hype-gift-box { fill: #ff5fa2; }
          .gx-hype-gift-ribbon { fill: none; stroke: #ffd84a; stroke-width: 1.4; stroke-linejoin: round; }
          .gx-hype-trophy { width: 100%; height: 100%; }
          .gx-hype-trophy-cup { fill: currentColor; }
          .gx-hype-trophy-line { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; }

          .gx-hype-togo {
            flex: none;
            opacity: .78;
          }

          .gx-hype-treasure {
            color: var(--gx-hype-accent);
          }

          /* The countdown: its outline drains as the level's time runs out,
             warming to amber under a minute and red under 20 seconds. */
          .gx-hype-clock {
            --gx-hype-heat: var(--gx-hype-accent);
            position: relative;
            flex: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 1.3em;
            min-width: 3.4em;
            padding: 0 .62em;
            font-size: .94em;
            font-weight: 800;
            line-height: 1.3em;
            font-variant-numeric: tabular-nums;
            transition: color .8s ease, opacity .25s ease;
          }

          .gx-hype-clock[data-heat="warm"] {
            --gx-hype-heat: #ffb547;
            color: #ffdcaa;
          }

          .gx-hype-clock[data-heat="hot"] {
            --gx-hype-heat: #ff5a5a;
            color: #ffb8b8;
          }

          .gx-hype-ring {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            overflow: visible;
          }

          .gx-hype-ring-track {
            fill: rgba(0,0,0,.34);
            stroke: rgba(255,255,255,.14);
            stroke-width: 2.2;
          }

          .gx-hype-ring-left {
            fill: none;
            stroke: var(--gx-hype-heat);
            stroke-width: 2.8;
            stroke-linecap: round;
            stroke-dasharray: 100;
            transition: stroke .8s ease;
            animation: gxHypeDrain var(--gx-hype-drain-ms) linear var(--gx-hype-drain-at) both;
          }

          .gx-hype-clock-text {
            position: relative;
          }

          /* Level-up and kickoff words cross the whole row once. */
          .gx-hype-words {
            position: absolute;
            inset: 0;
            overflow: hidden;
            pointer-events: none;
            -webkit-mask-image: linear-gradient(90deg, transparent, #000 1.4em, #000 calc(100% - 1.4em), transparent);
            mask-image: linear-gradient(90deg, transparent, #000 1.4em, #000 calc(100% - 1.4em), transparent);
          }

          .gx-hype-words-run {
            position: absolute;
            inset: 0;
            animation: gxHypeRunIn var(--gx-hype-cross) linear var(--gx-hype-burst-at, 0ms) both;
          }

          .gx-hype-words-text {
            display: inline-block;
            white-space: nowrap;
            font-weight: 900;
            letter-spacing: .03em;
            text-shadow: 0 0 .55em var(--gx-hype-accent), 0 1px 2px rgba(0,0,0,.9);
            animation: gxHypeRunOut var(--gx-hype-cross) linear var(--gx-hype-burst-at, 0ms) both;
          }

          .gx-hype-bottom {
            position: relative;
            display: flex;
            align-items: flex-end;
            gap: .34em;
            height: 1em;
            margin-top: .02em;
          }

          .gx-hype-track {
            position: relative;
            flex: 1 1 auto;
            min-width: 0;
            height: 100%;
          }

          .gx-hype-meter,
          .gx-hype-glow {
            position: absolute;
            left: 0;
            right: 0;
            bottom: .08em;
            height: .2em;
            border-radius: 999px;
          }

          .gx-hype-meter {
            overflow: hidden;
            background: rgba(0,0,0,.48);
            box-shadow: inset 0 1px 2px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08);
          }

          /* The fill spans the whole track and is revealed up to the
             percentage, so its colours stay put along the way. */
          .gx-hype-fill,
          .gx-hype-glow {
            background: var(--gx-hype-fill);
            background-size: 200% 100%;
            animation:
              gxHypeFlow 6s linear var(--gx-hype-flow-at, 0ms) infinite,
              gxHypeGrow 900ms cubic-bezier(.2,.8,.2,1) backwards;
            transition: clip-path 900ms cubic-bezier(.2,.8,.2,1);
          }

          .gx-hype-fill {
            position: absolute;
            inset: 0;
            overflow: hidden;
            clip-path: inset(0 calc(100% - var(--gx-hype-pct)) 0 0);
          }

          .gx-hype-glow {
            opacity: .6;
            filter: blur(.16em);
            clip-path: inset(-.6em calc(100% - var(--gx-hype-pct)) -.6em -.6em);
            pointer-events: none;
          }

          .gx-hype-shine,
          .gx-hype-sheen {
            position: absolute;
            top: 0;
            bottom: 0;
            left: -3em;
            width: 3em;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,.8), transparent);
          }

          .gx-hype-shine {
            animation: gxHypeShine 4.5s ease-in-out var(--gx-hype-shine-at, 0ms) infinite;
          }

          .gx-hype-sheen {
            width: 6em;
            left: -6em;
            animation: gxHypeSheen 1.2s ease-out var(--gx-hype-burst-at, 0ms) both;
          }

          /* Our locomotive rides the fill's front edge. */
          .gx-hype-rider {
            position: absolute;
            bottom: .13em;
            left: max(var(--gx-hype-pct), 1.36em);
            width: 1.44em;
            height: .9em;
            transform: translateX(-88%);
            pointer-events: none;
            animation: gxHypeRide 900ms cubic-bezier(.2,.8,.2,1) backwards;
            transition: left 900ms cubic-bezier(.2,.8,.2,1);
          }

          .gx-hype-rider .gx-hype-loco {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            overflow: visible;
            animation: gxHypeBob 640ms ease-in-out var(--gx-hype-bob-at, 0ms) infinite alternate;
          }

          .gx-hype-wheel {
            transform-box: fill-box;
            transform-origin: center;
            animation: gxHypeSpin 700ms linear var(--gx-hype-wheel-at, 0ms) infinite;
          }

          .gx-hype-loco-cab { fill: #9d6cff; }
          .gx-hype-card.is-themed .gx-hype-loco-cab { fill: var(--gx-hype-accent); }
          .gx-hype-loco-boiler { fill: #f3efff; }
          .gx-hype-loco-band { fill: none; stroke: rgba(80,60,140,.5); stroke-width: 1.1; }
          .gx-hype-loco-dark { fill: #241f38; }
          .gx-hype-loco-window { fill: #ffe9a8; }
          .gx-hype-loco-lamp { fill: #ffd84a; }
          .gx-hype-loco-catcher { fill: #ff5fa2; }
          .gx-hype-loco-wheel { fill: #2d2747; stroke: #f3efff; stroke-width: 1.2; }
          .gx-hype-loco-spoke { fill: none; stroke: rgba(243,239,255,.5); stroke-width: .8; }
          .gx-hype-loco-hub { fill: #ffd84a; }
          .gx-hype-loco-rod { fill: none; stroke: #c9c2dd; stroke-width: 1.1; stroke-linecap: round; }

          .gx-hype-nose {
            position: absolute;
            right: -.22em;
            bottom: -.12em;
            width: .62em;
            height: .62em;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255,255,255,.95) 0, rgba(255,255,255,.45) 32%, transparent 70%);
            animation: gxHypeGlint 1.6s ease-in-out var(--gx-hype-glint-at, 0ms) infinite;
          }

          .gx-hype-smoke {
            position: absolute;
            left: 68%;
            top: 0;
          }

          .gx-hype-smoke > i,
          .gx-hype-sparks > i {
            position: absolute;
            border-radius: 50%;
            opacity: 0;
          }

          .gx-hype-smoke > i {
            width: .2em;
            height: .2em;
            background: rgba(255,255,255,.62);
            animation: gxHypePuff 1.5s ease-out var(--gx-hype-puff-at, 0ms) infinite;
          }

          .gx-hype-smoke > i:nth-child(2) { animation-delay: calc(var(--gx-hype-puff-at, 0ms) - 500ms); }
          .gx-hype-smoke > i:nth-child(3) { animation-delay: calc(var(--gx-hype-puff-at, 0ms) - 1000ms); }

          .gx-hype-sparks {
            position: absolute;
            left: .1em;
            bottom: .02em;
          }

          .gx-hype-sparks > i {
            width: .13em;
            height: .13em;
            background: var(--gx-hype-accent);
            box-shadow: 0 0 .12em var(--gx-hype-accent);
            animation: gxHypeSpark 1.1s linear var(--gx-hype-glint-at, 0ms) infinite;
          }

          .gx-hype-sparks > i:nth-child(1) { --gx-dy: -.2em; }
          .gx-hype-sparks > i:nth-child(2) { --gx-dy: .06em; animation-delay: calc(var(--gx-hype-glint-at, 0ms) - 370ms); }
          .gx-hype-sparks > i:nth-child(3) { --gx-dy: -.08em; animation-delay: calc(var(--gx-hype-glint-at, 0ms) - 740ms); }

          .gx-hype-percent {
            flex: none;
            width: 3.2em;
            margin-bottom: .04em;
            font-size: .5em;
            font-weight: 900;
            line-height: 1;
            text-align: right;
            font-variant-numeric: tabular-nums;
          }

          /* A finished train shows only its result. */
          .gx-hype-card.is-complete .gx-hype-top,
          .gx-hype-card.is-complete .gx-hype-bottom,
          .gx-hype-card.is-complete .gx-hype-rider {
            visibility: hidden;
          }

          .gx-hype-complete {
            position: absolute;
            inset: 0;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: .58em;
            font-weight: 900;
            letter-spacing: .03em;
            text-shadow: 0 2px 5px rgba(0,0,0,.9);
            pointer-events: none;
            animation: gxHypeComplete .5s ease-out both;
          }

          /* Level-up confetti bursts up from the card over the chat above it
             and falls back down around it. */
          .gx-hype-confetti {
            position: absolute;
            left: 0;
            right: 0;
            top: 0;
            height: 0;
            z-index: 30;
            overflow: visible;
            pointer-events: none;
          }

          .gx-hype-confetti > i {
            position: absolute;
            top: .6em;
            left: var(--x);
            width: .24em;
            height: .38em;
            border-radius: .06em;
            background: var(--c);
            opacity: 0;
            animation: gxHypeConfetti var(--dur) linear calc(var(--delay) + var(--gx-hype-burst-at, 0ms)) both;
          }

          @keyframes gxHypeFlow { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
          @keyframes gxHypeGrow { from { clip-path: inset(0 calc(100% - var(--gx-hype-from)) 0 0); } }
          @keyframes gxHypeRide { from { left: max(var(--gx-hype-from), 1.36em); } }
          @keyframes gxHypeShine { 0% { left: -3em; } 45%, 100% { left: 100%; } }
          @keyframes gxHypeSheen { from { left: -6em; } to { left: 100%; } }
          @keyframes gxHypeBob { from { transform: translateY(0); } to { transform: translateY(-.04em); } }
          @keyframes gxHypeSpin { to { transform: rotate(360deg); } }
          @keyframes gxHypeGlint { 0%, 100% { opacity: .55; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.15); } }
          @keyframes gxHypePuff {
            0% { opacity: 0; transform: translate(0, 0) scale(.5); }
            15% { opacity: .7; }
            100% { opacity: 0; transform: translate(-1.7em, -.32em) scale(2.1); }
          }
          @keyframes gxHypeSpark {
            0% { opacity: 1; transform: translate(0, 0); }
            100% { opacity: 0; transform: translate(-1.4em, var(--gx-dy)); }
          }
          @keyframes gxHypeDrain { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 100; } }
          @keyframes gxHypeRunIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
          @keyframes gxHypeRunOut { from { transform: translateX(0); } to { transform: translateX(-100%); } }
          @keyframes gxHypeRing {
            from { box-shadow: 0 0 0 0 rgba(255,255,255,.75), inset 0 1px 0 rgba(255,255,255,.08); }
            to { box-shadow: 0 0 0 .4em rgba(255,255,255,0), inset 0 1px 0 rgba(255,255,255,.08); }
          }
          @keyframes gxHypeComplete { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
          @keyframes gxHypeConfetti {
            0% { opacity: 0; transform: translate(0, 0) rotate(0deg); animation-timing-function: cubic-bezier(.15,.7,.35,1); }
            4% { opacity: 1; }
            38% { opacity: 1; transform: translate(calc(var(--dx) * .45), calc(var(--up) * -1)) rotate(calc(var(--spin) * .35)); animation-timing-function: cubic-bezier(.5,0,.8,.6); }
            100% { opacity: 0; transform: translate(var(--dx), var(--fall)) rotate(var(--spin)); }
          }

          @media (prefers-reduced-motion: reduce) {
            .gx-hype-card,
            .gx-hype-fill,
            .gx-hype-glow,
            .gx-hype-rider,
            .gx-hype-loco,
            .gx-hype-wheel,
            .gx-hype-nose,
            .gx-hype-complete {
              animation: none !important;
              transition: none !important;
            }

            .gx-hype-shine,
            .gx-hype-smoke,
            .gx-hype-sparks,
            .gx-hype-confetti {
              display: none;
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
            display: flex;
            align-items: center;
            gap: clamp(10px, 2.4vw, 16px);
            max-width: min(440px, 100%);
            padding: clamp(12px, 3vw, 20px) clamp(16px, 4vw, 26px);
            border: 1px solid rgba(255,255,255,.14);
            border-radius: 18px;
            background: rgba(20,20,24,.78);
            background-image: radial-gradient(ellipse 260px 120px at 30% -20px, rgba(74,132,250,.22), transparent);
            color: #fff;
            box-shadow: 0 12px 36px rgba(0,0,0,.34);
            backdrop-filter: blur(8px);
          }
          .ck-startup-logo { height:clamp(48px,9vw,72px); width:auto; flex:0 0 auto; filter:drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
          .ck-startup-copy { min-width:0; font-family:'Open Sans',Arial,system-ui,sans-serif; }
          .ck-startup-title { margin:0; font-size:clamp(20px,4.2vw,32px); line-height:1.1; font-weight:800; letter-spacing:-.025em; }
          .ck-startup-byline { margin:4px 0 10px; color:#6d9dff; font-size:clamp(12px,2vw,15px); font-weight:700; }
          .ck-startup-status { display:flex; align-items:center; gap:9px; margin:0; color:rgba(255,255,255,.82); font-size:clamp(12px,2vw,15px); font-weight:700; }
          .ck-startup-spinner { width:16px; height:16px; flex:0 0 auto; border:2px solid rgba(255,255,255,.25); border-top-color:#6d9dff; border-radius:50%; animation:ckSpin .8s linear infinite; }
          @media (prefers-reduced-motion: reduce) {
            .ck-startup-loader { transition: none; }
            .ck-startup-spinner { animation: none; border-top-color:#6d9dff; }
          }

        `;
}
