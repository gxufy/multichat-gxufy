import { Fragment, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import type { OverlayConfig } from '../pages/multichat';
import type { ParsedMessage } from '../lib/kick';
import type { PinPhase } from '../lib/pinController';

export interface PinnedState {
  msg: ParsedMessage;
  pinnedBy?: string;
  /** Lifecycle phase for entrance/exit animations. */
  phase?: PinPhase;
}

interface Props {
  config: OverlayConfig;
  messages: ParsedMessage[];
  fadingIds: Set<string>;
  pinnedMessage: PinnedState | null;
  showLoader: boolean;
}

const FONT_FAMILIES: Record<string, string> = {
  default:     'inherit',
  baloo:       "'Baloo Tammudu 2', cursive",
  segoe:       "'Segoe UI', sans-serif",
  roboto:      "'Roboto', sans-serif",
  lato:        "'Lato', sans-serif",
  noto:        "'Noto Sans JP', sans-serif",
  sourcecode:  "'Source Code Pro', monospace",
  impact:      "'Impact', sans-serif",
  comfortaa:   "'Comfortaa', cursive",
  dancing:     "'Dancing Script', cursive",
  indieflower: "'Indie Flower', cursive",
  opensans:    "'Open Sans', sans-serif",
  alsina:      "'Alsina', cursive",
};

/* Exact values from chatis size_small/medium/large.css */
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

/* Exact chatis shadow_*.css — filter: drop-shadow (NOT text-shadow) */
import { PreviewMsgLine, PinSVG } from '../lib/previewRenderer';

function getShadowFilter(s: string) {
  if (s === 'small')  return 'drop-shadow(2px 2px 0.2rem black)';
  if (s === 'medium') return 'drop-shadow(2px 2px 0.35rem black)';
  if (s === 'large')  return 'drop-shadow(2px 2px 0.5rem black)';
  return '';
}

/* Exact chatis stroke_*.css */
function getStroke(s: string) {
  const m: Record<string,string> = { thin:'1px black', medium:'2px black', thick:'3px black', thicker:'4px black' };
  return m[s] ?? '';
}

/* Batch slide — exact chatis jQuery behaviour:
 *
 * Chatis does NOT slide the content in. It:
 *   1. Measures the natural height of the incoming batch (via hidden ghost div)
 *   2. Inserts an EMPTY ghost div at height 0 into the container
 *   3. Animates that ghost div 0 → naturalHeight over 150ms (jQuery swing = ease-in-out)
 *   4. In the animation COMPLETE callback: removes ghost, inserts real content
 *
 * Effect: space opens up (older messages get pushed), THEN content snaps in.
 * Content never moves — only the space moves.
 * Each batch runs its OWN independent 150ms regardless of how fast chat moves.
 * New batches never interrupt previous batches — they just stack their own ghost divs.
 */
function SlideGroup({ children, fontSize, lineHeight, fontFamily }: { children: React.ReactNode; fontSize:string; lineHeight:string; fontFamily:string }) {
  // Exact chatis jQuery behaviour:
  // 1. $auxDiv appended to #chat_container (hidden), measure height
  // 2. $animDiv inserted (empty), animated 0→naturalH over 150ms swing
  // 3. Complete callback: remove $animDiv, insert real content
  const [phase, setPhase] = useState<'ghost' | 'content'>('ghost');
  const [ghostH, setGhostH] = useState(0);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // Set width synchronously before measuring — must match container exactly
    const container = document.getElementById('chat_container');
    if (container) el.style.width = `${container.offsetWidth}px`;
    // rAF 1: let browser apply width and compute layout
    requestAnimationFrame(() => {
      const h = el.getBoundingClientRect().height;
      // rAF 2: trigger CSS transition 0 → h (ghost starts at 0 by default)
      requestAnimationFrame(() => {
        setGhostH(h);
        // 150ms matches jQuery .animate duration; content snaps in after
        setTimeout(() => setPhase('content'), 150);
      });
    });
  }, []);

  if (phase === 'content') {
    return <>{children}</>;
  }

  return (
    <>
      {/* $animDiv equivalent — animates height open to push older messages up */}
      <div style={{
        height: ghostH,
        overflow: 'hidden',
        transition: 'height 150ms ease-in-out',
      }} />
      {/* $auxDiv equivalent — off-screen, width set dynamically in useEffect */}
      <div ref={measureRef} style={{
        position:   'fixed',
        top:        '-9999px',
        left:       0,
        width:      'calc(100vw - 40px)', // overridden synchronously in useEffect
        visibility: 'hidden',
        pointerEvents: 'none',
        fontWeight:  800,
        wordBreak:   'break-word',
        fontSize,
        lineHeight,
        fontFamily,
              }}>
        {children}
      </div>
    </>
  );
}

function FadeGroup({ children }: { children: React.ReactNode }) {
  const [op, setOp] = useState(0);
  useEffect(() => { requestAnimationFrame(() => requestAnimationFrame(() => setOp(1))); }, []);
  return <div style={{ opacity:op, transition:'opacity 220ms ease-in-out' }}>{children}</div>;
}

export default function ChatOverlay({ config, messages, fadingIds, pinnedMessage, showLoader }: Props) {
  const cfg = config as OverlayConfig & {
    font?:string; stroke?:string; emoteScale?:number;
    hideNames?:boolean;
  };

  const szKey      = (cfg.textSize in SIZE ? cfg.textSize : 'medium') as SzKey;
  const sz         = SIZE[szKey];
  const filterVal  = getShadowFilter(cfg.textShadow);
  const strokeVal  = getStroke(cfg.stroke ?? 'none');
  const fontFamily = FONT_FAMILIES[cfg.font ?? 'default'] ?? 'inherit';
  const emoteScale = cfg.emoteScale ?? 1;
  const emoteMaxH  = `${parseFloat(sz.emoteMaxH) * emoteScale}px`;
  const emoteMaxW  = `${parseFloat(sz.emoteMaxW) * emoteScale}px`;
  // source tags only matter when 2+ platforms are configured
  const multiPlatform = [cfg.kick || cfg.channel, cfg.twitch, cfg.youtube, cfg.tiktok].filter(Boolean).length > 1;

  /* Batching — chatis has ONE 200ms update loop (script.js update()).
     pages/index.tsx owns that loop now and flushes messages at most
     every 200ms, so each prop change here IS one chatis batch: turn it
     straight into a slide/fade group. A second interval here would
     double-buffer (up to 400ms lag) and desync animation starts. */
  const seqRef      = useRef(0);
  const [batches, setBatches] = useState<{ id:number; msgs:ParsedMessage[] }[]>([]);
  const seenIdsRef  = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newMsgs = messages.filter(m => !seenIdsRef.current.has(m.id));
    newMsgs.forEach(m => seenIdsRef.current.add(m.id));
    // Prune seenIds so it doesn't grow unboundedly
    if (seenIdsRef.current.size > 500) {
      const keep = messages.map(m => m.id);
      seenIdsRef.current = new Set(keep);
    }
    if (!newMsgs.length) return;
    const id = ++seqRef.current;
    setBatches(prev => {
      const next = [...prev, { id, msgs: newMsgs }];
      let total = next.reduce((s,b)=>s+b.msgs.length, 0);
      while (total > 100 && next.length) { total -= next[0].msgs.length; next.shift(); }
      return next;
    });
  }, [messages]);

  /* Sync deletions */
  useEffect(() => {
    const ids = new Set(messages.map(m => m.id));
    setBatches(prev => {
      const next = prev.map(b=>({...b, msgs:b.msgs.filter(m=>ids.has(m.id))})).filter(b=>b.msgs.length);
      return next.length===prev.length ? prev : next;
    });
  }, [messages]);

  const renderMsg = (msg: ParsedMessage) => (
    <div key={msg.id} style={{
      margin: '0 10px',
      // jQuery fadeOut: opacity 1→0 over 400ms, exact chatis behaviour
      opacity: fadingIds.has(msg.id) ? 0 : 1,
      transition: fadingIds.has(msg.id) ? 'opacity 400ms linear' : 'none',

    }}>
      <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
        stroke={strokeVal} hideNames={cfg.hideNames??false}
        tagMode={multiPlatform ? (cfg.sourceTag ?? 'icon') : 'none'}
        showAvatar={cfg.showAvatars ?? false} />
    </div>
  );

  return (
    <>
      <Head>
        <style>{`
          /* Exact chatis body reset from style.css
             Also reset #__next (Next.js wrapper) so it doesn't
             offset position:absolute children of body */
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            height: 100vh !important;
            position: relative !important;
            background: ${(cfg as any).bgColor || 'transparent'} !important;
          }
          /* Next.js inserts #__next between <body> and our content.
             Make it invisible to layout so position:absolute;bottom:0
             on #chat_container anchors to <body> exactly like chatis. */
          #__next {
            position: static !important;
            height: 0 !important;
            overflow: visible !important;
          }
          ${cfg.font==='alsina' ? `@font-face { font-family:Alsina; src:url(https://chatis.is2511.com/v2/styles/Alsina_Ultrajada.ttf); }` : ''}

          /* Badge sizing — exact from size_*.css .badge
             Targets img AND svg (platform icons) via the bare class,
             plus the wrapper-child selector for stragglers */
          .ck-bw img,
          .ck-bw svg,
          .ck-badge-img {
            width:          ${sz.badgeW} !important;
            height:         ${sz.badgeH} !important;
            min-width:      ${sz.badgeW} !important;
            min-height:     ${sz.badgeH} !important;
            max-width:      ${sz.badgeW} !important;
            max-height:     ${sz.badgeH} !important;
            margin-right:   ${sz.badgeMR};
            margin-bottom:  ${sz.badgeMB};
            vertical-align: middle;
            border-radius:  10%;
            display:        inline-block;
          }
          .ck-bw img:last-of-type,
          .ck-bw svg:last-of-type,
          .ck-bw .ck-badge-img:last-of-type { margin-right: ${sz.badgeLastMR}; }

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

          /* Emote sizing — exact from chatis size_*.css .emote +
             style.css (.emote{vertical-align:middle} .emote-container
             {display:inline-block}). object-fit + auto dims keep 7TV/
             BTTV/FFZ art on one baseline regardless of aspect ratio. */
          .ck-body img,
          .ck-body img.ck-emote {
            max-width:      ${emoteMaxW};
            max-height:     ${emoteMaxH};
            height:         auto;
            width:          auto;
            object-fit:     contain;
            margin-right:   ${sz.emoteMR};
            vertical-align: middle;
            display:        inline-block;
          }

          /* Upscale emotes — fill full line-height (chatis upscale class) */
          .ck-body img.ck-upscale {
            max-height:     ${sz.upscaleH};
            max-width:      ${sz.emoteMaxW};
            height:         ${sz.upscaleH};
            width:          auto;
          }

          .ck-colon { margin-right: ${sz.colonMR}; }

          @keyframes ckPin {
            from { opacity:0; transform:translateY(-6px); }
            to   { opacity:1; transform:translateY(0); }
          }
          @keyframes ckSpin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }

        `}</style>
      </Head>

{showLoader && (
        <div style={{
          position: 'absolute',
          left: 'calc(50% - 288px)',
          bottom: 0,
          zIndex: 100,
          width: 576,
          height: 576,
        }}>
          {/* animated WebP: alpha works everywhere incl. iOS (VP9-alpha webm doesn't) */}
          <img src="/tpl.webp" alt="" width={576} height={576} style={{ display: 'block', objectFit: 'contain' }} />
        </div>
      )}

      {cfg.showPinEnabled && pinnedMessage && (
        <PinBanner
          pinned={pinnedMessage} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
          fontFamily={fontFamily} filterVal={filterVal} strokeVal={strokeVal}
          hideNames={cfg.hideNames??false}
        />
      )}

      {/*
        #chat_container — mirrors chatis style.css exactly:
          width: calc(100% - 20px)  (not 100%)
          padding: 10px
          position: absolute; bottom: 0
          font-weight: 800
          word-break: break-word
        font-size from size_*.css applied inline.
      */}
      <div id="chat_container" style={{
        width:      'calc(100% - 20px)',
        padding:    '10px',
        position:   'absolute',
        bottom:     0,
        overflow:   'hidden',
        background: 'transparent',
        color:      (cfg as any).fontColor || 'white',
        fontWeight: (cfg as any).msgBold === false ? 400 : 800,
        textTransform: (cfg as any).msgCaps ? 'uppercase' as const : undefined,
        wordBreak:  'break-word',
        fontFamily,
        fontSize:   sz.fontSize,
                ...(filterVal ? { filter:filterVal } : {}),
        ...(strokeVal ? { WebkitTextStroke:strokeVal } : {}),
      }}>
        {batches.map(({ id, msgs }) => {
          const content = msgs.map(renderMsg);
          if (cfg.animation==='slide') return <SlideGroup key={id} fontSize={sz.fontSize} lineHeight={sz.lineHeight} fontFamily={fontFamily} >{content}</SlideGroup>;
          if (cfg.animation==='fade')  return <FadeGroup  key={id}>{content}</FadeGroup>;
          return <div key={id}>{content}</div>;
        })}
      </div>
    </>
  );
}

/* PinBanner — 5-second lifecycle pin card.
 *
 * Phase-driven animations:
 *   entering  → ckPin keyframe (250 ms, opacity 0→1, translateY -6→0)
 *   visible   → normal display
 *   exiting   → CSS transition opacity 1→0 over 500 ms
 *
 * The pin controller (lib/pinController.ts) drives the phase;
 * when phase becomes 'gone' (pinnedMessage === null), the banner unmounts.
 */
function PinBanner({ pinned, sz, emoteMaxH, emoteMaxW, fontFamily, filterVal, strokeVal, hideNames }: {
  pinned: PinnedState; sz: typeof SIZE[SzKey];
  emoteMaxH:string; emoteMaxW:string; fontFamily:string;
  filterVal:string; strokeVal:string;
  hideNames:boolean;
}) {
  const { msg, pinnedBy } = pinned;
  const phase = pinned.phase ?? 'visible'; // fallback: no lifecycle, just show

  /* Entrance: ckPin keyframe (250 ms).
   * Exit: CSS transition opacity 1→0 (500 ms). */
  const shell: React.CSSProperties = {
    position:'absolute', top:0, left:0, right:0, zIndex:10,
    background:'rgba(12,12,16,0.72)',
    backdropFilter:'blur(16px) saturate(180%)', WebkitBackdropFilter:'blur(16px) saturate(180%)',
    borderBottom:'1px solid rgba(255,255,255,0.12)',
    borderRadius:'0 0 10px 10px',
    fontFamily, fontWeight:800,
    color:'white',
    wordBreak:'break-word', overflowWrap:'break-word',
    overflow:'hidden',
    ...(filterVal ? { filter:filterVal } : {}),
    ...(strokeVal ? { WebkitTextStroke:strokeVal } : {}),
    /* Default: fully opaque. Phase overrides below. */
    opacity: 1,
  };

  if (phase === 'entering') {
    shell.animation = 'ckPin 250ms ease-out';
  } else if (phase === 'exiting') {
    (shell as any).transition = 'opacity 500ms ease-in-out';
    shell.opacity = 0;
  }

  return (
    <div style={shell}>
      <div style={{ display:'flex', alignItems:'center', gap:4, paddingBottom:4, opacity:0.6, fontSize:'0.7em' }}>
        <PinSVG /> <span style={{ fontWeight:700 }}>Pinned Message</span>
      </div>
      <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
        stroke={strokeVal} hideNames={hideNames}
        tagMode="icon" showAvatar={false} />
      {pinnedBy && (
        <div style={{ paddingTop:4, opacity:0.5, fontSize:'0.55em', fontWeight:600 }}>
          Pinned by {pinnedBy}
        </div>
      )}
    </div>
  );
}

/* MsgLine delegates to PreviewMsgLine (same signature). */
const MsgLine = PreviewMsgLine;
