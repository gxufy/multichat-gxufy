import { Fragment, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import type { OverlayConfig } from '../pages/index';
import type { ParsedMessage } from '../lib/kick';

interface Props {
  config: OverlayConfig;
  messages: ParsedMessage[];
  fadingIds: Set<string>;
  pinnedMessage: ParsedMessage | null;
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
function SlideGroup({ children }: { children: React.ReactNode }) {
  // Exact chatis behaviour:
  // 1. Append hidden $auxDiv INSIDE #chat_container to measure natural height
  //    (inherits all container styles — font, size, word-break, padding)
  // 2. Append empty $animDiv, animate height 0→naturalH over 150ms (jQuery swing)
  // 3. On complete: remove $animDiv, append real content
  const [phase, setPhase] = useState<'ghost' | 'content'>('ghost');
  const [ghostH, setGhostH] = useState(0);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measureEl = measureRef.current;
    if (!measureEl) return;
    // Measure AFTER paint so layout is computed with full inherited styles
    const h = measureEl.getBoundingClientRect().height;
    // Animate ghost 0 → h over 150ms then show content (mirrors jQuery .animate callback)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setGhostH(h);
        setTimeout(() => setPhase('content'), 155); // 5ms buffer over 150ms transition
      });
    });
  }, []);

  if (phase === 'content') {
    return <>{children}</>;
  }

  return (
    <>
      {/* $animDiv equivalent: empty div that expands to make space */}
      <div style={{
        height: ghostH,
        overflow: 'hidden',
        transition: 'height 150ms ease-in-out',
      }} />
      {/* $auxDiv equivalent: hidden inside container to inherit all styles for accurate measurement */}
      <div ref={measureRef} style={{
        visibility: 'hidden',
        pointerEvents: 'none',
        overflow: 'hidden',
        height: 0,        // collapse so it doesn't affect layout visually
        maxHeight: 0,
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
    smallCaps?:boolean; nlAfterName?:boolean; hideNames?:boolean;
  };

  const szKey      = (cfg.textSize in SIZE ? cfg.textSize : 'medium') as SzKey;
  const sz         = SIZE[szKey];
  const filterVal  = getShadowFilter(cfg.textShadow);
  const strokeVal  = getStroke(cfg.stroke ?? 'none');
  const fontFamily = FONT_FAMILIES[cfg.font ?? 'default'] ?? 'inherit';
  const emoteScale = cfg.emoteScale ?? 1;
  const emoteMaxH  = `${parseFloat(sz.emoteMaxH) * emoteScale}px`;
  const emoteMaxW  = `${parseFloat(sz.emoteMaxW) * emoteScale}px`;

  /* 200ms batch queue — track by ID not by index.
     Tracking by index breaks when the messages array shrinks
     (fade expiry, bans) causing prevLenRef to overshoot and
     new messages to be sliced off as empty. */
  const pendingRef  = useRef<ParsedMessage[]>([]);
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
    if (newMsgs.length) pendingRef.current.push(...newMsgs);
  }, [messages]);

  useEffect(() => {
    const iv = setInterval(() => {
      if (!pendingRef.current.length) return;
      const batch = pendingRef.current.splice(0);
      const id = ++seqRef.current;
      setBatches(prev => {
        const next = [...prev, { id, msgs: batch }];
        let total = next.reduce((s,b)=>s+b.msgs.length, 0);
        while (total > 100 && next.length) { total -= next[0].msgs.length; next.shift(); }
        return next;
      });
    }, 200);
    return () => clearInterval(iv);
  }, []);

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
        stroke={strokeVal} smallCaps={cfg.smallCaps??false}
        nlAfterName={cfg.nlAfterName??false} hideNames={cfg.hideNames??false} />
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
            background: transparent !important;
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
             Targets both the wrapper-child selector AND the direct class
             to override any remaining Tailwind/inline size attrs */
          .ck-bw img,
          img.ck-badge-img {
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
          .ck-bw img.ck-badge-img:last-of-type { margin-right: ${sz.badgeLastMR}; }

          .ck-body {
            display: inline;
          }

          /* Emote sizing — exact from size_*.css .emote */
          .ck-body img,
          .ck-body img.ck-emote {
            max-width:      ${emoteMaxW};
            max-height:     ${emoteMaxH};
            height:         auto;
            width:          auto;
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
          left: 'calc(50% - 64px)',
          bottom: 'calc(20% - 64px)',
          zIndex: 100,
          animation: 'ckSpin 2s linear infinite',
          width: 128,
          height: 128,
        }}>
          <img src="/kick-logo.gif" alt="Loading..." width={128} height={128} style={{ display: 'block' }} />
        </div>
      )}

      {cfg.showPinEnabled && pinnedMessage && (
        <PinBanner
          msg={pinnedMessage} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
          fontFamily={fontFamily} filterVal={filterVal} strokeVal={strokeVal}
          smallCaps={cfg.smallCaps??false} nlAfterName={cfg.nlAfterName??false} hideNames={cfg.hideNames??false}
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
        color:      'white',
        fontWeight: 800,
        wordBreak:  'break-word',
        fontFamily,
        fontSize:   sz.fontSize,
        ...(cfg.smallCaps ? { fontVariant:'small-caps' } : {}),
        ...(filterVal ? { filter:filterVal } : {}),
        ...(strokeVal ? { WebkitTextStroke:strokeVal } : {}),
      }}>
        {batches.map(({ id, msgs }) => {
          const content = msgs.map(renderMsg);
          if (cfg.animation==='slide') return <SlideGroup key={id}>{content}</SlideGroup>;
          if (cfg.animation==='fade')  return <FadeGroup  key={id}>{content}</FadeGroup>;
          return <div key={id}>{content}</div>;
        })}
      </div>
    </>
  );
}

/* PinBanner — shows pinned message, auto-hides after 10s, no scrollbar */
function PinBanner({ msg, sz, emoteMaxH, emoteMaxW, fontFamily, filterVal, strokeVal, smallCaps, nlAfterName, hideNames }: {
  msg: ParsedMessage; sz: typeof SIZE[SzKey];
  emoteMaxH:string; emoteMaxW:string; fontFamily:string;
  filterVal:string; strokeVal:string;
  smallCaps:boolean; nlAfterName:boolean; hideNames:boolean;
}) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 7000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [msg.id]);

  if (!visible) return null;

  return (
    <div style={{
      position:'absolute', top:0, left:0, right:0, zIndex:10,
      background:'rgba(0,0,0,0.75)', backdropFilter:'blur(4px)',
      padding:'6px 10px 8px', borderRadius:'0 0 6px 6px',
      animation:'ckPin 150ms ease-out',
      fontFamily, fontWeight:800, fontSize:sz.fontSize,
      color:'white',
      wordBreak:'break-word', overflowWrap:'break-word',
      overflow:'hidden',           // no scrollbar ever
      ...(filterVal ? { filter:filterVal } : {}),
      ...(strokeVal ? { WebkitTextStroke:strokeVal } : {}),
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:4, paddingBottom:4, opacity:0.6, fontSize:'0.7em' }}>
        <PinSVG /> <span style={{ fontWeight:700 }}>Pinned Message</span>
      </div>
      <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
        stroke={strokeVal} smallCaps={smallCaps}
        nlAfterName={nlAfterName} hideNames={hideNames} />
    </div>
  );
}

function MsgLine({ msg, sz, emoteMaxH, emoteMaxW, stroke, smallCaps, nlAfterName, hideNames }: {
  msg: ParsedMessage; sz: typeof SIZE[SzKey];
  emoteMaxH:string; emoteMaxW:string; stroke:string;
  smallCaps:boolean; nlAfterName:boolean; hideNames:boolean;
}) {
  const isPaint = !!msg.identity.background;
  const nameStyle: React.CSSProperties = isPaint
    ? { background:msg.identity.background, filter:msg.identity.filter,
        WebkitTextFillColor:'transparent', WebkitBackgroundClip:'text',
        backgroundClip:'text', backgroundSize:'cover',
        WebkitTextStroke:'0px', textShadow:'none' }
    : { color:msg.identity.color, ...(smallCaps?{fontVariant:'small-caps'}:{}) };

  return (
    <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word' }}>
      {!hideNames && (
        <span style={{ display:'inline' }}>
          {msg.identity.badges.length > 0 && (
            <span className="ck-bw">
              {msg.identity.badges.map((b,i) => <Fragment key={i}>{b}</Fragment>)}
            </span>
          )}
          <span style={nameStyle}>{msg.identity.username}</span>
          {!nlAfterName ? <span className="ck-colon">:</span> : <br />}
        </span>
      )}
      <span className="ck-body">
        {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
      </span>
    </div>
  );
}

function PinSVG() {
  return (
    <svg height={12} width={12} fill="currentColor" viewBox="0 0 490.125 490.125">
      <path d="M300.625,5.025c-6.7-6.7-17.6-6.7-24.3,0l-72.6,72.6c-6.7,6.7-6.7,17.6,0,24.3l16.3,16.3l-40.3,40.3l-63.5-7c-3-0.3-6-0.5-8.9-0.5c-21.7,0-42.2,8.5-57.5,23.8l-20.8,20.8c-6.7,6.7-6.7,17.6,0,24.3l108.5,108.5l-132.4,132.4c-6.7,6.7-6.7,17.6,0,24.3c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l132.5-132.5l108.5,108.5c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l20.8-20.8c17.6-17.6,26.1-41.8,23.3-66.4l-7-63.5l40.3-40.3l16.2,16.2c6.7,6.7,17.6,6.7,24.3,0l72.6-72.6c3.2-3.2,5-7.6,5-12.1s-1.8-8.9-5-12.1L300.625,5.025z"/>
    </svg>
  );
}
