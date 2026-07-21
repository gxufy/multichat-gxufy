/* Renders UnifiedMessage → ParsedMessage (React nodes).
 *
 * Platform emotes arrive as char-offsets into text (unified-chat-lite
 * scheme); 7TV emotes (Kick only) are word-matched in the text gaps,
 * preserving the zero-width overlay behavior from the original overlay.
 */
import React from 'react';
import type { SevenTVEmote, ParsedMessage, KickChannel } from './kick';
import type { UnifiedMessage, Platform } from './types';

/* StreamNook PROVIDERS metadata (types/providers.ts) — brand colors/labels */
export const PROVIDERS: Record<Platform, { color: string; label: string }> = {
  twitch: { color: '#9147ff', label: 'Twitch' },
  kick: { color: '#53fc18', label: 'Kick' },
  youtube: { color: '#ff0000', label: 'YouTube' },
  tiktok: { color: '#00f2ea', label: 'TikTok' },
};

/* Platform marks for the source tag:
   - Twitch / TikTok: user-supplied brand PNGs (public/platform-*.png)
   - Kick / YouTube: official vector marks */
const iconImgStyle: React.CSSProperties = { height: '1em', width: 'auto', display: 'inline-block', verticalAlign: 'middle' };
function providerIcon(p: Platform): React.ReactNode {
  switch (p) {
    case 'twitch':
      return <img src="/platform-twitch.png" alt="Twitch" style={iconImgStyle} />;
    case 'tiktok':
      return <img src="/platform-tiktok.png" alt="TikTok" style={iconImgStyle} />;
    case 'kick':
      // kick's blocky K reads denser than the other marks — shrink ~20%
      // inside a 1em box so it aligns with the badge row
      return (
        <span style={{ width:'1em', height:'1em', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
          <svg viewBox="0 0 24 24" fill="#53FC19" style={{ width:'0.8em', height:'0.8em' }}><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>
        </span>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" style={{ width:'1em', height:'1em' }}>
          <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
          <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12z"/>
        </svg>
      );
  }
}

export type SourceTagMode = 'none' | 'dot' | 'label' | 'icon';

/* StreamNook SourceTag (OverlayChat.tsx:294) — inline platform marker.
   'dot' (default): 0.5em provider-colored circle; 'icon': brand SVG;
   'label': colored text pill. NOT a badge — leads the message line. */
export function sourceTag(platform: Platform, mode: SourceTagMode): React.ReactNode {
  if (mode === 'none') return null;
  const meta = PROVIDERS[platform];
  if (mode === 'dot') {
    return (
      <span key="srctag" style={{
        display:'inline-block', width:'0.5em', height:'0.5em',
        borderRadius:9999, backgroundColor:meta.color,
        marginRight:'0.4em', verticalAlign:'middle',
      }} />
    );
  }
  if (mode === 'icon') {
    return (
      <span key="srctag" style={{ display:'inline-flex', verticalAlign:'-0.1em', marginRight:'0.4em' }}>
        {providerIcon(platform)}
      </span>
    );
  }
  return (
    <span key="srctag" style={{
      fontSize:'0.72em', fontWeight:700, color:meta.color,
      backgroundColor:`color-mix(in srgb, ${meta.color} 16%, transparent)`,
      padding:'0.12em 0.4em', borderRadius:'0.4em', marginRight:'0.4em',
      verticalAlign:'middle',
    }}>{meta.label}</span>
  );
}

/* Name colors for platforms that don't send one:
   - YouTube/TikTok: StreamNook color_for (youtube.rs:1708) — FNV-1a hash
     of the user id over its exact 14-color palette
   - Twitch: chatis (script.js:1898) — classic 15-color palette indexed
     by (firstCharCode + lastCharCode) % 15 */
const SN_PALETTE = ['#ff4f4f', '#ff8c42', '#ffd23f', '#9ee493', '#4fd1c5', '#4f9dff', '#7c6cff', '#c77dff', '#ff6fae', '#f25c54', '#43aa8b', '#577590', '#e07a5f', '#81b29a'];
const TWITCH_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];

export function fallbackColor(platform: Platform, username: string, senderId?: string): string {
  if (platform === 'youtube' || platform === 'tiktok') {
    // FNV-1a over the stable user id (falls back to name)
    const key = senderId || username;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i) & 0xff;
      hash = Math.imul(hash, 16777619);
    }
    return SN_PALETTE[(hash >>> 0) % SN_PALETTE.length];
  }
  if (platform === 'twitch') {
    return TWITCH_COLORS[(username.charCodeAt(0) + username.charCodeAt(username.length - 1)) % TWITCH_COLORS.length];
  }
  return '#ffffff';
}

/* chatis lightens user-set colors with brightness ≤ 50 by 30 (tinycolor
   formula: brightness = (R*299 + G*587 + B*114) / 1000; lighten = +30%
   lightness in HSL). Keeps dark names readable on stream. */
export function readableColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  if ((r * 299 + g * 587 + b * 114) / 1000 > 50) return hex;
  // RGB→HSL, lightness +0.30, →RGB
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  let h = 0, s = 0;
  let l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
    else if (max === gf) h = ((bf - rf) / d + 2) / 6;
    else h = ((rf - gf) / d + 4) / 6;
  }
  l = Math.min(1, l + 0.30);
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r2: number, g2: number, b2: number;
  if (!s) { r2 = g2 = b2 = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3); g2 = hue2rgb(p, q, h); b2 = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

function emoteImg(key: string, src: string, alt: string, upscale = false): React.ReactNode {
  return <img key={key} className={`ck-emote${upscale ? ' ck-upscale' : ''}`} src={src} alt={alt} />;
}

/* Word-level 7TV swap for a plain-text segment (Kick), with zero-width
   emotes overlaying the previous emote — behavior carried over from the
   original parseMessageText. */
function render7TVSegment(segment: string, emotes: SevenTVEmote[], keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const words = segment.split(' ');
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const emote = emotes.find(e => e.name === word);
    if (!emote) {
      nodes.push(i !== words.length - 1 ? word + ' ' : word);
      continue;
    }
    const zeroWidths: React.ReactNode[] = [];
    while (i + 1 < words.length) {
      const next = emotes.find(e => e.name === words[i + 1]);
      if (!next || !next.zeroWidth) break;
      zeroWidths.push(emoteImg(`${keyBase}-zw-${i}`, next.image, next.name, next.upscale));
      i++;
    }
    const nextIsEmote = i + 1 < words.length && emotes.some(e => e.name === words[i + 1]);
    if (zeroWidths.length === 0) {
      nodes.push(emoteImg(`${keyBase}-em-${i}`, emote.image, emote.name, emote.upscale));
    } else {
      nodes.push(
        <span key={`${keyBase}-zws-${i}`} style={{ display: 'inline-block', position: 'relative', verticalAlign: 'middle' }}>
          <img className={`ck-emote${emote.upscale ? ' ck-upscale' : ''}`} src={emote.image} alt={emote.name} style={{ display: 'block' }} />
          {zeroWidths.map((zw, zi) => (
            <span key={zi} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{zw}</span>
          ))}
        </span>
      );
    }
    if (i !== words.length - 1 && !nextIsEmote) nodes.push(' ');
  }
  return nodes;
}

/* UChat-style colorable mentions (ref-uchat emoteParser.ts:286):
   tokens normalized by stripping @ and trailing commas; a mention only
   colors if that user has chatted before (name → color map filled as
   messages arrive). */
export interface MentionContext {
  enabled: boolean;
  /** lowercase username → their display color */
  colors: Map<string, string>;
}

function renderMentions(segment: string, ctx: MentionContext | undefined, keyBase: string): React.ReactNode[] {
  if (!ctx?.enabled || !segment.includes('@')) return [segment];
  const nodes: React.ReactNode[] = [];
  const words = segment.split(' ');
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const tail = i !== words.length - 1 ? ' ' : '';
    if (word.startsWith('@')) {
      const color = ctx.colors.get(word.replace(/[@,]/g, '').toLowerCase());
      if (color) {
        nodes.push(<strong key={`${keyBase}-m${i}`} style={{ color, fontWeight: 800 }}>{word}</strong>);
        if (tail) nodes.push(tail);
        continue;
      }
    }
    const last = nodes[nodes.length - 1];
    if (typeof last === 'string') nodes[nodes.length - 1] = last + word + tail;
    else nodes.push(word + tail);
  }
  return nodes;
}

/** text + platform emote offsets (+ 7TV for kick/twitch) → React nodes */
export function renderMessageText(msg: UnifiedMessage, sevenTV: SevenTVEmote[], mentions?: MentionContext): React.ReactNode[] {
  const chars = Array.from(msg.text); // codepoint-safe offsets
  const sorted = [...msg.emotes].sort((a, b) => a.begin - b.begin);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  const pushText = (segment: string, keyBase: string) => {
    if (!segment) return;
    // 7TV word-swap applies to kick AND twitch text gaps
    if ((msg.platform === 'kick' || msg.platform === 'twitch') && sevenTV.length) {
      const parts = render7TVSegment(segment.replace(/\s\s+/g, ' '), sevenTV, keyBase);
      // apply mention coloring to the plain-string parts between emotes
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        if (typeof p === 'string') nodes.push(...renderMentions(p, mentions, `${keyBase}-p${pi}`));
        else nodes.push(p);
      }
    } else {
      nodes.push(...renderMentions(segment, mentions, keyBase));
    }
  };

  for (let idx = 0; idx < sorted.length; idx++) {
    const e = sorted[idx];
    pushText(chars.slice(cursor, e.begin).join(''), `t${idx}`);
    nodes.push(emoteImg(`pe-${idx}`, e.url, e.text));
    cursor = e.end;
  }
  pushText(chars.slice(cursor).join(''), 'tail');
  return nodes;
}

/* Kick badge art lookup — moved verbatim from pages/index.tsx */
function kickGifterSrc(count: number): string {
  if (count >= 5000) return '/badges/gift_5000+.svg';
  if (count >= 4000) return '/badges/gift_4000-4999.svg';
  if (count >= 3000) return '/badges/gift_3000-3999.svg';
  if (count >= 2000) return '/badges/gift_2000-2999.svg';
  if (count >= 1000) return '/badges/gift_1000-1999.svg';
  if (count >= 850) return '/badges/gift_850-899.svg';
  if (count >= 800) return '/badges/gift_800-849.svg';
  if (count >= 750) return '/badges/gift_750-799.svg';
  if (count >= 700) return '/badges/gift_700-749.svg';
  if (count >= 650) return '/badges/gift_650-699.svg';
  if (count >= 600) return '/badges/gift_600-649.svg';
  if (count >= 500) return '/badges/gift_500-549.svg';
  if (count >= 450) return '/badges/gift_450-499.svg';
  if (count >= 400) return '/badges/gift_400-449.svg';
  if (count >= 300) return '/badges/gift_300-349.svg';
  if (count >= 250) return '/badges/gift_250-299.svg';
  if (count >= 200) return '/badges/gift_200-249.svg';
  if (count >= 150) return '/badges/gift_150-199.svg';
  if (count >= 100) return '/badges/gift_100-149.svg';
  if (count >= 25) return '/badges/gift_25-99.svg';
  if (count >= 10) return '/badges/gift_10-24.svg';
  if (count >= 5) return '/badges/gift_5-9.svg';
  return '/badges/gift_1-4.svg';
}

const SIMPLE_KICK_BADGES: Record<string, string> = {
  broadcaster: '/badges/broadcaster.svg',
  moderator: '/badges/moderator.svg',
  vip: '/badges/vip.svg',
  founder: '/badges/founder.svg',
  og: '/badges/og.svg',
  verified: '/badges/verified.svg',
  staff: '/badges/staff.svg',
};

/* YouTube role badges — StreamNook OverlayChat.tsx YT_ROLE_BADGES:
   inline SVG data-URIs (blue mod shield #3ea6ff, grey verified check).
   Owner gets no badge — the whole name renders as a gold pill instead. */
const YT_ICON_BADGES: Record<string, string> = {
  moderator: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3ea6ff"><path d="M12 2 4 5.5V12c0 4.7 3.4 8.6 8 10 4.6-1.4 8-5.3 8-10V5.5Zm5.3 6.1-6.5 6.9-3.6-3.4 1.2-1.3 2.4 2.2 5.3-5.7Z"/></svg>'),
  verified: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#999999"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.5-3.9-3.9 1.4-1.4 2.5 2.5 5.9-5.9 1.4 1.4Z"/></svg>'),
};

/* StreamNook YT_BADGE_ORDER: verified → moderator → member */
const YT_BADGE_ORDER: Record<string, number> = { verified: 0, moderator: 1, subscriber: 2 };

/* Official Twitch badge UUIDs (unified-chat-lite app.js TWITCH_BADGE_IDS) */
const TWITCH_BADGE_IDS: Record<string, string> = {
  broadcaster: '5527c58c-fb7d-422d-b71b-f309dcb85cc1',
  moderator: '3267646d-33f0-4b17-b3df-f923a41db1d0',
  vip: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
  partner: 'd12a2e27-16f6-41d0-ab77-b780518f00a3',
  subscriber: '5d9f2208-5dd8-11e7-8513-2ff4adfae661',
  founder: '511b78a9-ab37-472f-9569-457753bbe7d3',
  premium: 'bbbe0db0-a598-423e-86d0-f9fb98ca1933',
  turbo: 'bd444ec6-8f34-4bf9-91f4-af1e3428d80f',
  staff: 'd97c37bd-a6f5-4c38-8f57-4e4bef88af34',
  'sub-gifter': 'f1d8486f-eb2e-4553-b44f-4d614617afc1',
};

/* StreamNook: the YouTube channel owner gets no badge — their whole
   name renders as a gold pill (#ffd600 bg, dark text) instead. */
export function isYouTubeOwner(msg: UnifiedMessage): boolean {
  return msg.platform === 'youtube' && msg.badges.some(b => b.type === 'owner');
}

export function renderBadges(
  msg: UnifiedMessage,
  subscriberBadges: KickChannel['subscriber_badges'],
): React.ReactNode[] {
  const out: React.ReactNode[] = [];

  // StreamNook: verified → moderator → member; owner has no badge
  // (the name renders as a gold pill instead — see isYouTubeOwner)
  const badges = msg.platform === 'youtube'
    ? [...msg.badges]
        .filter(b => b.type !== 'owner')
        .sort((a, b) => (YT_BADGE_ORDER[a.type] ?? 9) - (YT_BADGE_ORDER[b.type] ?? 9))
    : msg.badges;

  for (let i = 0; i < badges.length; i++) {
    const b = badges[i];
    const key = `b-${i}-${b.type}`;
    if (b.url) {
      // TikTok badge art is frequently non-square (fan club, top gifter):
      // lock height only so it aligns with square badges without squishing
      const wide = msg.platform === 'tiktok';
      out.push(<img key={key} className={wide ? 'ck-badge-img ck-badge-wide' : 'ck-badge-img'} src={b.url} alt={b.type} />);
      continue;
    }
    if (msg.platform === 'kick') {
      const simple = SIMPLE_KICK_BADGES[b.type];
      if (simple) { out.push(<img key={key} className="ck-badge-img" src={simple} alt={b.type} />); continue; }
      if (b.type === 'subscriber') {
        const sorted = [...subscriberBadges].sort((a, c) => c.months - a.months);
        const match = sorted.find(sb => (b.count ?? 0) >= sb.months);
        out.push(<img key={key} className="ck-badge-img" src={match?.badge_image.src ?? '/badges/subscriber.svg'} alt="subscriber" />);
        continue;
      }
      if (b.type === 'sub_gifter') { out.push(<img key={key} className="ck-badge-img" src={kickGifterSrc(b.count ?? 0)} alt="gifter" />); continue; }
      if (b.type === 'gift_rank') {
        const rank = b.count ?? 1;
        out.push(<img key={key} className="ck-badge-img" src={rank <= 1 ? '/badges/gift-rank-1.png' : rank === 2 ? '/badges/gift-rank-2.png' : '/badges/gift-rank-3.png'} alt={b.type} />);
        continue;
      }
      if (b.type === 'kicks_rank') {
        const rank = b.count ?? 1;
        out.push(<img key={key} className="ck-badge-img" src={rank <= 1 ? '/badges/kicks-rank-1.png' : rank === 2 ? '/badges/kicks-rank-2.png' : '/badges/kicks-rank-3.png'} alt={b.type} />);
        continue;
      }
    } else if (msg.platform === 'twitch') {
      const uuid = TWITCH_BADGE_IDS[b.type];
      if (uuid) {
        out.push(<img key={key} className="ck-badge-img" src={`https://static-cdn.jtvnw.net/badges/v1/${uuid}/2`} alt={b.type} />);
        continue;
      }
    } else {
      const yt = YT_ICON_BADGES[b.type];
      if (yt) { out.push(<img key={key} className="ck-badge-img" src={yt} alt={b.type} />); continue; }
      if (b.type === 'moderator') { out.push(<img key={key} className="ck-badge-img" src="/badges/moderator.svg" alt="moderator" />); continue; }
      if (b.type === 'subscriber') { out.push(<img key={key} className="ck-badge-img" src="/badges/subscriber.svg" alt="subscriber" />); continue; }
    }
  }
  return out;
}
