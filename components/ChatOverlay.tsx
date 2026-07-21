import { Fragment, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import type { OverlayConfig } from '../pages/multichat';
import type { ParsedMessage } from '../lib/kick';
import { sourceTag, PROVIDERS, type SourceTagMode } from '../lib/render';
import type { Platform } from '../lib/types';

export interface PinnedState {
  msg: ParsedMessage;
  pinnedBy?: string;
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
function SlideGroup({ children, fontSize, lineHeight, fontFamily, smallCaps }: { children: React.ReactNode; fontSize:string; lineHeight:string; fontFamily:string; smallCaps:boolean }) {
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
        ...(smallCaps ? { fontVariant: 'small-caps' } : {}),
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
        stroke={strokeVal} smallCaps={cfg.smallCaps??false}
        nlAfterName={cfg.nlAfterName??false} hideNames={cfg.hideNames??false}
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
          if (cfg.animation==='slide') return <SlideGroup key={id} fontSize={sz.fontSize} lineHeight={sz.lineHeight} fontFamily={fontFamily} smallCaps={cfg.smallCaps??false}>{content}</SlideGroup>;
          if (cfg.animation==='fade')  return <FadeGroup  key={id}>{content}</FadeGroup>;
          return <div key={id}>{content}</div>;
        })}
      </div>
    </>
  );
}

/* PinBanner — StreamNook-style persistent pin card.
 * Stays visible while pinned (no auto-hide); after 15s collapses to a
 * thin one-line bar (StreamNook's pinned_start_collapsed pattern).
 * Glassmorphism card with pin header and "Pinned by X" footer. */
function PinBanner({ pinned, sz, emoteMaxH, emoteMaxW, fontFamily, filterVal, strokeVal, smallCaps, nlAfterName, hideNames }: {
  pinned: PinnedState; sz: typeof SIZE[SzKey];
  emoteMaxH:string; emoteMaxW:string; fontFamily:string;
  filterVal:string; strokeVal:string;
  smallCaps:boolean; nlAfterName:boolean; hideNames:boolean;
}) {
  const { msg, pinnedBy } = pinned;
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(() => {
    setCollapsed(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCollapsed(true), 15000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [msg.id]);

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
    ...(filterVal ? { filter:filterVal } : {}),
    ...(strokeVal ? { WebkitTextStroke:strokeVal } : {}),
  };

  if (collapsed) {
    // Thin bar: pin icon + name + truncated single-line text
    return (
      <div style={{ ...shell, padding:'4px 10px', fontSize:'0.55em', display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ opacity:0.7, flexShrink:0, display:'inline-flex' }}><PinSVG /></span>
        <span style={{ color:msg.identity.color, flexShrink:0 }}>{msg.identity.username}</span>
        <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', opacity:0.9, fontWeight:600, minWidth:0 }}>
          {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...shell, padding:'6px 10px 8px', fontSize:sz.fontSize }}>
      <div style={{ display:'flex', alignItems:'center', gap:4, paddingBottom:4, opacity:0.6, fontSize:'0.7em' }}>
        <PinSVG /> <span style={{ fontWeight:700 }}>Pinned Message</span>
      </div>
      <MsgLine msg={msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
        stroke={strokeVal} smallCaps={smallCaps}
        nlAfterName={nlAfterName} hideNames={hideNames}
        tagMode="icon" showAvatar={false} />
      {pinnedBy && (
        <div style={{ paddingTop:4, opacity:0.5, fontSize:'0.55em', fontWeight:600 }}>
          Pinned by {pinnedBy}
        </div>
      )}
    </div>
  );
}

/* StreamNook event-card metadata: category → icon glyph + tint.
   Rendered in 'plain' style: 2px provider-colored left border +
   20%→transparent gradient wash (OverlayChat.tsx:682). */
const CATEGORY_ICON: Record<string, string> = {
  subscription: '★', gift: '🎁', raid: '👥', cheer: '💰',
  milestone: '🔥', follow: '❤️', announcement: '📣',
};

function MsgLine({ msg, sz, emoteMaxH, emoteMaxW, stroke, smallCaps, nlAfterName, hideNames, tagMode, showAvatar }: {
  msg: ParsedMessage; sz: typeof SIZE[SzKey];
  emoteMaxH:string; emoteMaxW:string; stroke:string;
  smallCaps:boolean; nlAfterName:boolean; hideNames:boolean;
  tagMode:SourceTagMode; showAvatar:boolean;
}) {
  const isPaint = !!msg.identity.background;
  const pill = msg.identity.namePill?.split('|');
  const nameStyle: React.CSSProperties = pill
    ? { background:pill[0], color:pill[1], borderRadius:'0.4em', padding:'0 0.35em',
        WebkitTextStroke:'0px', textShadow:'none',
        ...(smallCaps?{fontVariant:'small-caps'}:{}) }
    : isPaint
    ? { background:msg.identity.background, filter:msg.identity.filter,
        WebkitTextFillColor:'transparent', WebkitBackgroundClip:'text',
        backgroundClip:'text', backgroundSize:'cover',
        WebkitTextStroke:'0px', textShadow:'none' }
    : { color:msg.identity.color, ...(smallCaps?{fontVariant:'small-caps'}:{}) };

  const tag = msg.platform ? sourceTag(msg.platform, tagMode) : null;

  // StreamNook: avatars only for yt/tiktok, 1.5em circle, leads the line
  const avatar = showAvatar && msg.avatar && (msg.platform === 'youtube' || msg.platform === 'tiktok') ? (
    <img src={msg.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{ width:'1.5em', height:'1.5em', minWidth:'1.5em', borderRadius:9999,
               objectFit:'cover', marginRight:'0.4em', verticalAlign:'-0.32em',
               display:'inline-block' }}
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
  ) : null;

  const badgesNode = msg.identity.badges.length > 0 && (
    <span className="ck-bw">
      {msg.identity.badges.map((b,i) => <Fragment key={i}>{b}</Fragment>)}
    </span>
  );
  const nameNode = <span style={nameStyle}>{msg.identity.username}</span>;

  /* Event card (StreamNook 'plain' eventStyle): provider-colored left
     border + gradient wash, category icon, regular-weight action text */
  if (msg.kind === 'system') {
    const color = msg.platform ? PROVIDERS[msg.platform as Platform].color : '#888';
    return (
      <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word', display:'flex', alignItems:'flex-start', gap:'0.3em' }}>
        {tag && <span style={{ flexShrink:0 }}>{tag}</span>}
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

  /* Redeem / highlighted message: Twitch-style purple accent bar +
     subtle wash (net-new — UChat only shows/hides these, StreamNook
     routes them to event cards; the bar keeps them inline like Twitch) */
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

  const line = (
    <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word' }}>
      {tag}
      {avatar}
      {!hideNames && (
        <span style={{ display:'inline' }}>
          {/* StreamNook: YouTube renders name THEN badges; others badges-first */}
          {msg.platform === 'youtube'
            ? <>{nameNode}{badgesNode && <span style={{ marginLeft:'0.25em' }}>{badgesNode}</span>}</>
            : <>{badgesNode}{nameNode}</>}
          {!nlAfterName ? <span className="ck-colon">:</span> : <br />}
        </span>
      )}
      <span className="ck-body">
        {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
      </span>
    </div>
  );

  return msg.redeem ? redeemWrap(line) : line;
}

function PinSVG() {
  return (
    <svg height={12} width={12} fill="currentColor" viewBox="0 0 490.125 490.125">
      <path d="M300.625,5.025c-6.7-6.7-17.6-6.7-24.3,0l-72.6,72.6c-6.7,6.7-6.7,17.6,0,24.3l16.3,16.3l-40.3,40.3l-63.5-7c-3-0.3-6-0.5-8.9-0.5c-21.7,0-42.2,8.5-57.5,23.8l-20.8,20.8c-6.7,6.7-6.7,17.6,0,24.3l108.5,108.5l-132.4,132.4c-6.7,6.7-6.7,17.6,0,24.3c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l132.5-132.5l108.5,108.5c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l20.8-20.8c17.6-17.6,26.1-41.8,23.3-66.4l-7-63.5l40.3-40.3l16.2,16.2c6.7,6.7,17.6,6.7,24.3,0l72.6-72.6c3.2-3.2,5-7.6,5-12.1s-1.8-8.9-5-12.1L300.625,5.025z"/>
    </svg>
  );
}
