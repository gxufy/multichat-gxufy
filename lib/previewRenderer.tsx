/* Shared rendering for the generator preview and the production overlay.
 *
 * Takes a UnifiedMessage (the same shape connectors emit) and converts
 * it into a ParsedMessage (React nodes), applying the same transformations
 * as pages/multichat.tsx buildParsed(): 7TV cosmetics, badges, emotes,
 * mentions, YouTube owner pill.
 *
 * PreviewMsgLine renders a single ParsedMessage identically to the
 * ChatOverlay MsgLine (same CSS classes, same layout), so the preview
 * looks exactly like the production overlay.
 *
 * PreviewPinBanner renders a pinned-message banner for the preview area
 * with the same glassmorphism card layout as the ChatOverlay PinBanner.
 */
import React, { Fragment, useEffect, useRef, useState } from 'react';
import type { ParsedMessage } from './kick';
import type { SevenTVEmote, SevenTVBadge, SevenTVPaint, Entitlements, KickChannel } from './kick';
import type { UnifiedMessage } from './types';
import {
  renderMessageText,
  renderBadges,
  fallbackColor,
  readableColor,
  isYouTubeOwner,
  sourceTag,
  PROVIDERS,
  type MentionContext,
  type SourceTagMode,
} from './render';

/* ── buildPaintStyle (extracted from pages/multichat.tsx) ──────────────
 * Converts a SevenTVPaint into { background, filter } CSS strings. */
/* decimalToRGBA — matches lib/kick.ts for 7TV paint color conversion */
function decimalToRGBA(decimal: number): string {
  const r = (decimal >>> 24) & 255;
  const g = (decimal >>> 16) & 255;
  const b = (decimal >>> 8) & 255;
  const a = ((decimal & 255) / 255).toFixed(3);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ── buildPaintStyle (extracted from pages/multichat.tsx) ──────────────
 * Converts a SevenTVPaint into { background, filter } CSS strings. */
function buildPaintStyle(paint: SevenTVPaint, paintShadows = true): { background: string; filter: string } {
  const parts: string[] = [];
  const shadows: string[] = [];
  let prefix = '';
  if (paint.func === 'URL') {
    parts.push(paint.image_url ?? '');
  } else {
    if (paint.func === 'LINEAR_GRADIENT') parts.push(`${paint.angle ?? 0}deg`);
    else if (paint.func === 'RADIAL_GRADIENT') parts.push(paint.shape ?? 'circle');
    prefix = paint.repeat ? 'repeating-' : '';
    for (const stop of paint.stops) {
      parts.push(`${decimalToRGBA(stop.color)} ${stop.at * 100}%`);
    }
  }
  for (const shadow of paint.shadows) {
    if (!paintShadows) break;
    shadows.push(`drop-shadow(${decimalToRGBA(shadow.color)} ${shadow.x_offset}px ${shadow.y_offset}px ${shadow.radius}px)`);
  }
  const background = `${prefix}${paint.func.toLowerCase().replace('_', '-')}(${parts.join(', ')})`;
  return { background, filter: shadows.join(' ') };
}

/* ── makePreviewMessage ─────────────────────────────────────────────────
 * UnifiedMessage → ParsedMessage for the generator preview.
 *
 * Unlike the production buildParsed(), this does NOT track mentions in a
 * live map or queue GQL cosmetics lookups.  Cosmetics are applied from
 * the provided maps (usually empty in the preview, but test messages
 * can carry entitlements for cosmetic testing).
 *
 * Mention coloring: if `mentionCtx.colors` is empty, @mentions are NOT
 * highlighted (they still appear as text).  A non-empty map (e.g. from
 * a test simulator that remembers chatters) enables coloring. */
export function makePreviewMessage(
  um: UnifiedMessage,
  opts?: {
    sevenTVCosmeticsEnabled?: boolean;
    paintShadows?: boolean;
    emotes?: SevenTVEmote[];
    badges?: SevenTVBadge[];
    paints?: SevenTVPaint[];
    entitlements?: Entitlements;
    subscriberBadges?: KickChannel['subscriber_badges'];
    mentionCtx?: MentionContext;
  },
): ParsedMessage {
  const {
    sevenTVCosmeticsEnabled = false,
    paintShadows = true,
    emotes = [],
    badges = [],
    paints = [],
    entitlements = {},
    subscriberBadges = [],
    mentionCtx,
  } = opts ?? {};

  const badgeNodes = renderBadges(um, subscriberBadges);
  let background = '';
  let filter = '';

  if ((um.platform === 'kick' || um.platform === 'twitch') && sevenTVCosmeticsEnabled && um.senderId) {
    const entitlement = entitlements[`${um.platform}:${um.senderId}`];
    if (entitlement) {
      if (entitlement.badge) {
        const badge = badges.find(b => b.id === entitlement.badge);
        if (badge) badgeNodes.push(<img key="7tv-badge" className="ck-badge-img" src={badge.image} alt="7tv badge" />);
      }
      if (entitlement.paint) {
        const paint = paints.find(p => p.id === entitlement.paint);
        if (paint) ({ background, filter } = buildPaintStyle(paint, paintShadows));
      }
    }
  }

  const displayColor = um.color ? readableColor(um.color) : fallbackColor(um.platform, um.username, um.senderId);

  return {
    id: `${um.platform}:${um.id}`,
    platform: um.platform,
    senderId: um.senderId,
    kind: um.kind,
    category: um.category,
    redeem: um.redeem,
    avatar: um.avatar,
    raw: um,
    timestamp: Date.now(),
    identity: {
      username: um.username,
      color: displayColor,
      background,
      filter,
      badges: badgeNodes,
      ...(isYouTubeOwner(um) ? { namePill: '#ffd600|#111111' } : {}),
    },
    message: renderMessageText(
      um,
      (um.platform === 'kick' || um.platform === 'twitch') ? emotes : [],
      mentionCtx
    ),
  };
}

/* ── PreviewMsgLine ─────────────────────────────────────────────────────
 * Renders a single ParsedMessage identically to ChatOverlay MsgLine.
 *
 * Same CSS classes (ck-bw, ck-colon, ck-body, ck-emote, ck-upscale),
 * same badge/emote sizing, same event-card / redeem-wrapping logic.
 * Does NOT carry ChatOverlay-specific props (batch animation, etc.). */
export function PreviewMsgLine({ msg, sz, emoteMaxH, emoteMaxW, stroke, hideNames, tagMode, showAvatar }: {
  msg: ParsedMessage;
  sz: {
    fontSize: string; lineHeight: string;
    badgeW: string; badgeH: string; badgeMR: string; badgeMB: string; badgeLastMR: string;
    colonMR: string;
    emoteMaxW: string; emoteMaxH: string;
    upscaleH: string;
  };
  emoteMaxH: string;
  emoteMaxW: string;
  stroke: string;
  hideNames: boolean;
  tagMode: 'none' | 'dot' | 'label' | 'icon';
  showAvatar: boolean;
}) {
  const isPaint = !!msg.identity.background;
  const pill = msg.identity.namePill?.split('|');
  const nameStyle: React.CSSProperties = pill
    ? { background: pill[0], color: pill[1], borderRadius: '0.4em', padding: '0 0.35em',
        WebkitTextStroke: '0px', textShadow: 'none', }
    : isPaint
    ? { background: msg.identity.background, filter: msg.identity.filter,
        WebkitTextFillColor: 'transparent', WebkitBackgroundClip: 'text',
        backgroundClip: 'text', backgroundSize: 'cover',
        WebkitTextStroke: '0px', textShadow: 'none' }
    : { color: msg.identity.color };

  const tag = msg.platform ? sourceTag(msg.platform, tagMode) : null;

  // Avatars only for yt/tiktok, 1.5em circle, leads the line
  const avatar = showAvatar && msg.avatar && (msg.platform === 'youtube' || msg.platform === 'tiktok') ? (
    <img src={msg.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{ width: '1.5em', height: '1.5em', minWidth: '1.5em', borderRadius: 9999,
               objectFit: 'cover', marginRight: '0.4em', verticalAlign: '-0.32em',
               display: 'inline-block' }}
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
  ) : null;

  const badgesNode = msg.identity.badges.length > 0 && (
    <span className="ck-bw">
      {msg.identity.badges.map((b, i) => <Fragment key={i}>{b}</Fragment>)}
    </span>
  );
  const nameNode = <span style={nameStyle}>{msg.identity.username}</span>;

  /* Event card (StreamNook 'plain' eventStyle): provider-colored left
     border + gradient wash, category icon, regular-weight action text */
  if (msg.kind === 'system') {
    const color = msg.platform ? PROVIDERS[msg.platform].color : '#888';
    return (
      <div style={{ lineHeight: sz.lineHeight, wordBreak: 'break-word', display: 'flex', alignItems: 'flex-start', gap: '0.3em' }}>
        {tag && <span style={{ flexShrink: 0 }}>{tag}</span>}
        <div style={{
          borderLeft: `2px solid ${color}`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${color} 20%, transparent), transparent)`,
          padding: '0 8px', borderRadius: 6, flex: 1, minWidth: 0,
        }}>
          <span style={{ marginRight: '0.35em' }}>{CATEGORY_ICON[msg.category ?? 'announcement'] ?? '📣'}</span>
          <span style={{ fontWeight: 400 }} className="ck-body">
            {msg.message.map((node, i) => <Fragment key={i}>{node}</Fragment>)}
          </span>
        </div>
      </div>
    );
  }

  /* Redeem / highlighted message: Twitch-style purple accent bar */
  const redeemWrap = (inner: React.ReactNode) => (
    <div style={{
      borderLeft: '0.22em solid #9147ff',
      background: 'linear-gradient(90deg, rgba(145,71,255,0.18), transparent 70%)',
      padding: '0 0 0 0.4em', borderRadius: 3,
    }}>
      {typeof msg.redeem === 'string' && msg.redeem !== 'highlighted' && (
        <div style={{ fontSize: '0.6em', opacity: 0.75, fontWeight: 700, lineHeight: 1.6 }}>
          {'🎁'} {msg.redeem}
        </div>
      )}
      {inner}
    </div>
  );

  const line = (
    <div style={{ lineHeight: sz.lineHeight, wordBreak: 'break-word' }}>
      {tag}
      {avatar}
      {!hideNames && (
        <span style={{ display: 'inline' }}>
          {msg.platform === 'youtube'
            ? <>{nameNode}{badgesNode && <span style={{ marginLeft: '0.25em' }}>{badgesNode}</span>}</>
            : <>{badgesNode}{nameNode}</>}
          <span className="ck-colon">:</span>
        </span>
      )}
      <span className="ck-body">
        {msg.message.map((node, i) => <Fragment key={i}>{node}</Fragment>)}
      </span>
    </div>
  );

  return msg.redeem ? redeemWrap(line) : line;
}

/* ── PinBanner (for ChatOverlay production) ────────────────────────────
 * Extracted from ChatOverlay.tsx so it can be imported by both
 * the overlay and the preview.  Manages its own 15s collapse timer
 * for the current pinned message. */
export function PinBanner({ pinned, sz, emoteMaxH, emoteMaxW, fontFamily, filterVal, strokeVal, hideNames }: {
  pinned: { msg: ParsedMessage; pinnedBy?: string };
  sz: {
    fontSize: string; lineHeight: string;
    badgeW: string; badgeH: string; badgeMR: string; badgeMB: string; badgeLastMR: string;
    colonMR: string;
    emoteMaxW: string; emoteMaxH: string;
    upscaleH: string;
  };
  emoteMaxH: string;
  emoteMaxW: string;
  fontFamily: string;
  filterVal: string;
  strokeVal: string;
  hideNames: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCollapsed(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCollapsed(true), 15000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [pinned.msg.id]);

  const shell: React.CSSProperties = {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    background: 'rgba(12,12,16,0.72)',
    backdropFilter: 'blur(16px) saturate(180%)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '0 0 10px 10px',
    animation: 'ckPin 150ms ease-out',
    fontFamily, fontWeight: 800,
    color: 'white',
    wordBreak: 'break-word', overflowWrap: 'break-word',
    overflow: 'hidden',
    ...(filterVal ? { filter: filterVal } : {}),
    ...(strokeVal ? { WebkitTextStroke: strokeVal } : {}),
  };

  if (collapsed) {
    return (
      <div style={{ ...shell, padding: '4px 10px', fontSize: '0.55em', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ opacity: 0.7, flexShrink: 0, display: 'inline-flex' }}><PinSVG /></span>
        <span style={{ color: pinned.msg.identity.color, flexShrink: 0 }}>{pinned.msg.identity.username}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.9, fontWeight: 600, minWidth: 0 }}>
          {pinned.msg.message.map((node, i) => <Fragment key={i}>{node}</Fragment>)}
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...shell, padding: '6px 10px 8px', fontSize: sz.fontSize }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 4, opacity: 0.6, fontSize: '0.7em' }}>
        <PinSVG /> <span style={{ fontWeight: 700 }}>Pinned Message</span>
      </div>
      <PreviewMsgLine msg={pinned.msg} sz={sz} emoteMaxH={emoteMaxH} emoteMaxW={emoteMaxW}
        stroke={strokeVal} hideNames={hideNames}
        tagMode="icon" showAvatar={false} />
      {pinned.pinnedBy && (
        <div style={{ paddingTop: 4, opacity: 0.5, fontSize: '0.55em', fontWeight: 600 }}>
          Pinned by {pinned.pinnedBy}
        </div>
      )}
    </div>
  );
}

/* ── PreviewPinBanner (for LandingPage preview) ─────────────────────────
 * Renders a pinned-message banner inside the preview area.
 *
 * Unlike the production PinBanner, this lives inside a regular div
 * (not position:absolute overlay).
 *
 * Phase-driven lifecycle (5 s total):
 *   entering  → ckPin keyframe (250 ms, opacity 0→1, translateY -6→0)
 *   visible   → normal display
 *   exiting   → CSS transition opacity 1→0 over 500 ms
 */
import type { PinnedState } from '../components/ChatOverlay';

export function PreviewPinBanner({ pinned, sz, fontFamily, hideNames }: {
  pinned: PinnedState;
  sz: {
    fontSize: string; lineHeight: string;
    badgeW: string; badgeH: string; badgeMR: string; badgeMB: string; badgeLastMR: string;
    colonMR: string;
    emoteMaxW: string; emoteMaxH: string;
    upscaleH: string;
  };
  fontFamily: string;
  hideNames: boolean;
}) {
  const phase = pinned.phase ?? 'visible'; // fallback: no lifecycle

  const containerStyle: React.CSSProperties = {
    background: 'rgba(12,12,16,0.72)',
    backdropFilter: 'blur(16px) saturate(180%)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    fontFamily, fontWeight: 800,
    color: 'white',
    wordBreak: 'break-word', overflowWrap: 'break-word',
    overflow: 'hidden',
    opacity: 1,
  };

  if (phase === 'entering') {
    (containerStyle as any).animation = 'ckPin 250ms ease-out';
  } else if (phase === 'exiting') {
    (containerStyle as any).transition = 'opacity 500ms ease-in-out';
    containerStyle.opacity = 0;
  }

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 4, opacity: 0.6, fontSize: '0.7em' }}>
        <PinSVG /> <span style={{ fontWeight: 700 }}>Pinned Message</span>
      </div>
      <PreviewMsgLine msg={pinned.msg} sz={sz} emoteMaxH={sz.emoteMaxH} emoteMaxW={sz.emoteMaxW}
        stroke="" hideNames={hideNames}
        tagMode="icon" showAvatar={false} />
      {pinned.pinnedBy && (
        <div style={{ paddingTop: 4, opacity: 0.5, fontSize: '0.55em', fontWeight: 600 }}>
          Pinned by {pinned.pinnedBy}
        </div>
      )}
    </div>
  );
}

/* ── PinSVG (shared icon) ─────────────────────────────────────────────── */
function PinSVG() {
  return (
    <svg height={12} width={12} fill="currentColor" viewBox="0 0 490.125 490.125">
      <path d="M300.625,5.025c-6.7-6.7-17.6-6.7-24.3,0l-72.6,72.6c-6.7,6.7-6.7,17.6,0,24.3l16.3,16.3l-40.3,40.3l-63.5-7c-3-0.3-6-0.5-8.9-0.5c-21.7,0-42.2,8.5-57.5,23.8l-20.8,20.8c-6.7,6.7-6.7,17.6,0,24.3l108.5,108.5l-132.4,132.4c-6.7,6.7-6.7,17.6,0,24.3c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l132.5-132.5l108.5,108.5c3.3,3.3,7.7,5,12.1,5s8.8-1.7,12.1-5l20.8-20.8c17.6-17.6,26.1-41.8,23.3-66.4l-7-63.5l40.3-40.3l16.2,16.2c6.7,6.7,17.6,6.7,24.3,0l72.6-72.6c3.2-3.2,5-7.6,5-12.1s-1.8-8.9-5-12.1L300.625,5.025z" />
    </svg>
  );
}

/* ── Re-export shared constants ─────────────────────────────────────────
 * Needed by PreviewMsgLine for event card rendering and source tags. */
export { PROVIDERS, sourceTag } from './render';

/* ── PinSVG (shared icon) — exported for use by consumers of previewRenderer */
export { PinSVG };

export const CATEGORY_ICON: Record<string, string> = {
  subscription: '★', gift: '🎁', raid: '👥', cheer: '💰',
  milestone: '🔥', follow: '❤️', announcement: '📣',
};
