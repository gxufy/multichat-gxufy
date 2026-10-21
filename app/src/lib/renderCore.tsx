
import React from 'react';
import twemoji from 'twemoji';
import type { SevenTVEmote, ParsedMessage, KickChannel } from './kick';
import type { UnifiedMessage, Platform } from './types';
import { handleAssetError, handleAssetErrorWithFallback } from './render/imageFallback';
import { TWITCH_PLATFORM_ICON_SRC } from './platformAssets';


export const PROVIDERS: Record<Platform, { color: string; label: string }> = {
  twitch: { color: '#9147ff', label: 'Twitch' },
  kick: { color: '#53fc18', label: 'Kick' },
  youtube: { color: '#ff0000', label: 'YouTube' },
  tiktok: { color: '#00f2ea', label: 'TikTok' },
};

/* Platform marks for the source tag:
   - Twitch / TikTok: user-supplied brand PNGs (public/platform-*.png)
   - Kick / YouTube: official vector marks */
export const PROVIDER_ICON_OPTICS: Record<Platform, { scale: number; offsetY: number }> = {
  /* Scales are relative to the shared 1.15em box. YouTube's wide silhouette
     needs less fill than the denser Twitch/Kick/TikTok marks. */
  twitch: { scale: 0.96, offsetY: 0 },
  kick: { scale: 0.86, offsetY: 0 },
  youtube: { scale: 0.97, offsetY: 0 },
  tiktok: { scale: 0.96, offsetY: 0 },
};

function providerIconStyle(platform: Platform): React.CSSProperties {
  const { scale, offsetY } = PROVIDER_ICON_OPTICS[platform];
  return {
    width: '100%',
    height: '100%',
    display: 'block',
    overflow: 'visible',
    objectFit: 'contain',
    transform: `translateY(${offsetY}em) scale(${scale})`,
    transformOrigin: 'center',
  };
}
function providerIcon(p: Platform): React.ReactNode {
  switch (p) {
    case 'twitch':
      return <img src={TWITCH_PLATFORM_ICON_SRC} alt="Twitch" style={providerIconStyle(p)} decoding="async" />;
    case 'tiktok':
      return <img src="/platform-tiktok.png" alt="TikTok" style={providerIconStyle(p)} decoding="async" />;
    case 'kick':
      // Kick's dense K receives a small optical reduction inside the shared box.
      return (
        <svg viewBox="0 0 24 24" fill="#53FC19" style={providerIconStyle(p)}>
          <path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/>
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" style={providerIconStyle(p)}>
          <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
          <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12z"/>
        </svg>
      );
  }
}

export type SourceTagMode = 'none' | 'dot' | 'label' | 'icon';


export function sourceTag(platform: Platform, mode: SourceTagMode, iconShadowFilter = ''): React.ReactNode {
  if (mode === 'none') return null;
  const meta = PROVIDERS[platform];
  if (mode === 'dot') {
    return (
      /* Decorative: the dot repeats no text, so it stays out of the a11y tree. */
      <span key="srctag" data-source-tag="dot" data-platform={platform} aria-hidden="true" style={{
        display:'inline-block', width:'0.5em', height:'0.5em',
        borderRadius:9999, backgroundColor:meta.color,
        marginRight:'0.4em', verticalAlign:'middle',
      }} />
    );
  }
  if (mode === 'icon') {
    return (
      /* Decorative for the same reason — the brand mark carries no unique text.
         providerIcon's <img> already uses an empty-intent alt via aria-hidden. */
      <span key="srctag" data-source-tag="icon" data-platform={platform} aria-hidden="true"
        style={{ display:'inline-flex', width:'1.15em', height:'1.15em', flex:'0 0 1.15em',
                 alignItems:'center', justifyContent:'center', lineHeight:0,
                 overflow:'visible', verticalAlign:'-0.2em', marginRight:'0.4em',
                 ...(iconShadowFilter ? { filter:iconShadowFilter } : {}) }}>
        {providerIcon(platform)}
      </span>
    );
  }
  /* The label's visible text is the platform name, so it is left readable — no
     aria-label duplicating what is already on screen. */
  return (
    <span key="srctag" data-source-tag="label" data-platform={platform} style={{
      fontSize:'0.72em', fontWeight:700, color:meta.color,
      backgroundColor:`color-mix(in srgb, ${meta.color} 16%, transparent)`,
      padding:'0.12em 0.4em', borderRadius:'0.4em', marginRight:'0.4em',
      verticalAlign:'middle',
    }}>{meta.label}</span>
  );
}


const NAME_PALETTE = ['#ff4f4f', '#ff8c42', '#ffd23f', '#9ee493', '#4fd1c5', '#4f9dff', '#7c6cff', '#c77dff', '#ff6fae', '#f25c54', '#43aa8b', '#577590', '#e07a5f', '#81b29a'];
const TWITCH_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];

function decimalStringModulo(value: string, divisor: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  let remainder = 0;
  for (let index = 0; index < value.length; index += 1) {
    remainder = (remainder * 10 + value.charCodeAt(index) - 48) % divisor;
  }
  return remainder;
}

export function fallbackColor(platform: Platform, username: string, senderId?: string): string {
  if (platform === 'youtube' || platform === 'tiktok') {
    // FNV-1a over the stable user id (falls back to name)
    const key = senderId || username;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i) & 0xff;
      hash = Math.imul(hash, 16777619);
    }
    return NAME_PALETTE[(hash >>> 0) % NAME_PALETTE.length];
  }
  if (platform === 'twitch') {
    /* No-colour Twitch users use their immutable numeric user id.
       Decimal string modulo stays exact even if an id outgrows JS safe integers. */
    const senderIndex = senderId
      ? decimalStringModulo(senderId, TWITCH_COLORS.length)
      : null;
    if (senderIndex !== null) return TWITCH_COLORS[senderIndex];

    // Historical restored rows may not have a sender id; retain the old stable fallback.
    if (!username) return TWITCH_COLORS[0];
    return TWITCH_COLORS[(username.charCodeAt(0) + username.charCodeAt(username.length - 1)) % TWITCH_COLORS.length];
  }
  return '#ffffff';
}


export function readableColor(hex: string): string {
  const value = hex.trim();
  const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!match) return '';

  const supplied = value.startsWith('#') ? value : `#${match[1]}`;
  const raw = match[1];
  const rgbHex = raw.length <= 4
    ? raw.slice(0, 3).split('').map((part) => `${part}${part}`).join('')
    : raw.slice(0, 6);
  const alphaHex = raw.length === 4
    ? `${raw[3]}${raw[3]}`
    : raw.length === 8
      ? raw.slice(6, 8)
      : '';
  const number = Number.parseInt(rgbHex, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (r: number, g: number, b: number) => (
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  );
  const minimumLuminance = 0.18;

  /* Bright provider colours are identity data and stay byte-for-byte intact.
     Only colours that would disappear into a dark video scene are lifted. */
  if (luminance(red, green, blue) >= minimumLuminance) return supplied;

  const redUnit = red / 255;
  const greenUnit = green / 255;
  const blueUnit = blue / 255;
  const maximum = Math.max(redUnit, greenUnit, blueUnit);
  const minimum = Math.min(redUnit, greenUnit, blueUnit);
  const delta = maximum - minimum;
  let hue = 0;
  let saturation = 0;
  const initialLightness = (maximum + minimum) / 2;

  if (delta > 0) {
    saturation = initialLightness > 0.5
      ? delta / (2 - maximum - minimum)
      : delta / (maximum + minimum);
    if (maximum === redUnit) {
      hue = ((greenUnit - blueUnit) / delta + (greenUnit < blueUnit ? 6 : 0)) / 6;
    } else if (maximum === greenUnit) {
      hue = ((blueUnit - redUnit) / delta + 2) / 6;
    } else {
      hue = ((redUnit - greenUnit) / delta + 4) / 6;
    }
  }

  const hueToRgb = (p: number, q: number, input: number) => {
    let channel = input;
    if (channel < 0) channel += 1;
    if (channel > 1) channel -= 1;
    if (channel < 1 / 6) return p + (q - p) * 6 * channel;
    if (channel < 1 / 2) return q;
    if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
    return p;
  };
  const rgbAtLightness = (lightness: number): [number, number, number] => {
    if (saturation === 0) return [lightness, lightness, lightness];
    const q = lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    return [
      hueToRgb(p, q, hue + 1 / 3),
      hueToRgb(p, q, hue),
      hueToRgb(p, q, hue - 1 / 3),
    ];
  };

  /* Raise HSL lightness only as far as needed. Binary search avoids a fixed
     pastelizing offset while retaining the provider hue and saturation. */
  let low = initialLightness;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidate = (low + high) / 2;
    const [r, g, b] = rgbAtLightness(candidate);
    if (luminance(r * 255, g * 255, b * 255) < minimumLuminance) low = candidate;
    else high = candidate;
  }

  const toHex = (channel: number) => Math.round(channel * 255)
    .toString(16)
    .padStart(2, '0');
  const [adjustedRed, adjustedGreen, adjustedBlue] = rgbAtLightness(high);
  return `#${toHex(adjustedRed)}${toHex(adjustedGreen)}${toHex(adjustedBlue)}${alphaHex}`;
}

function emoteRawImg(
  key: string,
  src: string,
  alt: string,
  upscale = false,
  providerClass = '',
): React.ReactNode {
  return <img key={key} className={`ck-emote${upscale ? ' ck-upscale' : ''}${providerClass ? ` ${providerClass}` : ''}`} src={src} alt={alt} loading="eager" decoding="async" onError={handleAssetError} />;
}

function emoteImg(
  key: string,
  src: string,
  alt: string,
  upscale = false,
  providerClass = '',
): React.ReactNode {
  return emoteRawImg(key, src, alt, upscale, providerClass);
}

export type EmoteEffect =
  | 'squishX'
  | 'wide'
  | 'flipX'
  | 'flipY'
  | 'shake'
  | 'rotateRight'
  | 'rotateLeft'
  | 'rotateHalf'
  | 'rainbow'
  | 'halfFlipX'
  | 'cursed'
  | 'hyper'
  | 'slide'
  | 'jam'
  | 'bounce'
  | 'spin'
  | 'arrive'
  | 'leave';

export const BTTV_EMOTE_EFFECT_TOKENS = {
  'z!': 'squishX',
  'w!': 'wide',
  'v!': 'flipX',
  's!': 'shake',
  'r!': 'rotateRight',
  'l!': 'rotateLeft',
  'd!': 'rotateHalf',
  'p!': 'rainbow',
  'h!': 'halfFlipX',
  'c!': 'cursed',
} as const satisfies Readonly<Record<string, EmoteEffect>>;

export const FFZ_EMOTE_EFFECT_TOKENS = {
  ffzX: 'flipX',
  ffzY: 'flipY',
  ffzW: 'wide',
  ffzRainbow: 'rainbow',
  ffzHyper: 'hyper',
  ffzSlide: 'slide',
  ffzCursed: 'cursed',
  ffzJam: 'jam',
  ffzBounce: 'bounce',
  ffzSpin: 'spin',
  ffzArrive: 'arrive',
  ffzLeave: 'leave',
} as const satisfies Readonly<Record<string, EmoteEffect>>;

const EMOTE_EFFECT_TOKEN_NAMES = new Set([
  ...Object.keys(BTTV_EMOTE_EFFECT_TOKENS),
  ...Object.keys(FFZ_EMOTE_EFFECT_TOKENS),
]);

const EFFECT_CLASS: Readonly<Record<EmoteEffect, string>> = {
  squishX: 'gx-emote-effect-squish-x',
  wide: 'gx-emote-effect-wide',
  flipX: 'gx-emote-effect-flip-x',
  flipY: 'gx-emote-effect-flip-y',
  shake: 'gx-emote-effect-shake',
  rotateRight: 'gx-emote-effect-rotate-right',
  rotateLeft: 'gx-emote-effect-rotate-left',
  rotateHalf: 'gx-emote-effect-rotate-half',
  rainbow: 'gx-emote-effect-rainbow',
  halfFlipX: 'gx-emote-effect-half-flip-x',
  cursed: 'gx-emote-effect-cursed',
  hyper: 'gx-emote-effect-hyper',
  slide: 'gx-emote-effect-slide',
  jam: 'gx-emote-effect-jam',
  bounce: 'gx-emote-effect-bounce',
  spin: 'gx-emote-effect-spin',
  arrive: 'gx-emote-effect-arrive',
  leave: 'gx-emote-effect-leave',
};

const ANIMATED_EFFECTS = new Set<EmoteEffect>([
  'shake', 'rainbow', 'hyper', 'slide', 'jam', 'bounce', 'spin', 'arrive', 'leave',
]);

/* Every badge <img> goes through here so the load-failure fallback is attached
   in one place rather than repeated at each of the badge sites below. */
function badgeImg(
  key: string,
  src: string,
  alt: string,
  className = 'ck-badge-img',
  backgroundColor?: string,
  fallbackUrl?: string,
  title?: string,
): React.ReactNode {
  return (
    <img
      key={key}
      className={className}
      src={src}
      alt={alt}
      title={title}
      decoding="async"
      data-fallback-src={fallbackUrl && fallbackUrl !== src ? fallbackUrl : undefined}
      style={backgroundColor ? { backgroundColor } : undefined}
      onError={fallbackUrl && fallbackUrl !== src ? handleAssetErrorWithFallback : handleAssetError}
    />
  );
}

const EMOTES_BY_NAME = new WeakMap<SevenTVEmote[], Map<string, SevenTVEmote>>();

function emotesByName(emotes: SevenTVEmote[]): Map<string, SevenTVEmote> {
  const cached = EMOTES_BY_NAME.get(emotes);
  if (cached) return cached;
  const lookup = new Map<string, SevenTVEmote>();
  /* Array.find used to choose the first duplicate. Keep that exact behavior. */
  for (const emote of emotes) {
    if (!lookup.has(emote.name)) lookup.set(emote.name, emote);
  }
  EMOTES_BY_NAME.set(emotes, lookup);
  return lookup;
}

/* Word-level 7TV swap for a plain-text segment, with zero-width
   emotes overlaying the previous emote — behavior carried over from the
   original parseMessageText. */
function render7TVSegment(segment: string, emotes: SevenTVEmote[], keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const words = segment.split(' ');
  const lookup = emotesByName(emotes);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const emote = lookup.get(word);
    if (!emote) {
      nodes.push(i !== words.length - 1 ? word + ' ' : word);
      continue;
    }
    const zeroWidths: React.ReactNode[] = [];
    while (i + 1 < words.length) {
      const next = lookup.get(words[i + 1]);
      if (!next || !next.zeroWidth) break;
      zeroWidths.push(emoteRawImg(`${keyBase}-zw-${i}`, next.image, next.name, next.upscale));
      i++;
    }
    if (zeroWidths.length === 0) {
      nodes.push(emoteImg(`${keyBase}-em-${i}`, emote.image, emote.name, emote.upscale));
    } else {
      /* One grid cell holds the base plus every overlay. The base is a grid
         item, so its width resolves from the capped height and aspect ratio
         (a shrink-to-fit inline-block instead measured the emote's negative
         compaction margin into the wrapper and clipped 6px off the base).
         Overlays are absolutely positioned, so no layer — however wide —
         adds inline width or shifts the base. Geometry lives in .ck-zw* CSS
         so the overlay and OBS share one rule set. */
      nodes.push(
        <span key={`${keyBase}-zws-${i}`} className="ck-zw">
          <img className={`ck-emote ck-zw-base${emote.upscale ? ' ck-upscale' : ''}`}
               src={emote.image} alt={emote.name} onError={handleAssetError} />
          {zeroWidths.map((zw, zi) => (
            <span key={zi} className="ck-zw-layer">{zw}</span>
          ))}
        </span>
      );
    }
    if (i !== words.length - 1) nodes.push(' ');
  }
  return nodes;
}


export interface MentionContext {
  enabled: boolean;
  /** lowercase username → their display color */
  colors: Map<string, string>;
}

const TWEMOJI_ASSET_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';

function renderTwemojiSegment(segment: string, keyBase: string): React.ReactNode[] {
  if (!segment) return [];
  const parsed = twemoji.parse(segment, {
    base: TWEMOJI_ASSET_BASE,
    folder: 'svg',
    ext: '.svg',
    className: 'ck-twemoji',
  });

  const nodes: React.ReactNode[] = [];
  const imageRe = /<img\b[^>]*>/g;
  let cursor = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = imageRe.exec(parsed)) !== null) {
    if (match.index > cursor) nodes.push(parsed.slice(cursor, match.index));

    const tag = match[0];
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1]?.replace(/&amp;/g, '&');
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? '';

    if (!src) {
      nodes.push(alt);
    } else {
      nodes.push(
        <span key={`${keyBase}-tw-${index++}`} className="ck-emote-wrap ck-twemoji-wrap">
          <img
            className="ck-emote ck-twemoji"
            src={src}
            alt={alt}
            draggable={false}
            loading="eager"
            decoding="async"
            onError={(event) => {
              const img = event.currentTarget;
              const parent = img.parentNode;
              if (parent) parent.replaceChild(document.createTextNode(img.alt), img);
            }}
          />
        </span>
      );
    }
    cursor = match.index + tag.length;
  }

  if (cursor < parsed.length) nodes.push(parsed.slice(cursor));
  return nodes.length ? nodes : [segment];
}

function renderMentions(segment: string, ctx: MentionContext | undefined, keyBase: string): React.ReactNode[] {
  if (!ctx?.enabled || !segment.includes('@')) return renderTwemojiSegment(segment, keyBase);

  const nodes: React.ReactNode[] = [];
  const parts = segment.split(/(\s+)/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (/^\s+$/.test(part)) {
      nodes.push(part);
      continue;
    }

    if (part.startsWith('@')) {
      const mentionName = part.slice(1).replace(/[.,!?;:)]+$/g, '').toLowerCase();
      const color = ctx.colors.get(mentionName);
      if (color) {
        nodes.push(<strong key={`${keyBase}-m${i}`} style={{ color, fontWeight: 800 }}>{part}</strong>);
        continue;
      }
    }

    nodes.push(...renderTwemojiSegment(part, `${keyBase}-p${i}`));
  }

  return nodes;
}

/** text + platform emote offsets (+ 7TV for kick/twitch) → React nodes */
function renderMessageTextWithoutEffects(msg: UnifiedMessage, sevenTV: SevenTVEmote[], mentions?: MentionContext): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  const pushText = (segment: string, keyBase: string) => {
    if (!segment) return;
    // Platform-scoped 7TV word-swap applies to Kick, Twitch and YouTube.
    if ((msg.platform === 'kick' || msg.platform === 'twitch' || msg.platform === 'youtube') && sevenTV.length) {
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

  /* Most rows contain no provider-native emotes. In that case code-point
     materialization and sorting cannot affect the result, so skip both and feed
     the original string through the exact same 7TV/mention path. */
  if (!msg.emotes.length) {
    pushText(msg.text, 'tail');
    return nodes;
  }

  const chars = Array.from(msg.text); // codepoint-safe offsets
  const sorted = msg.emotes.length > 1
    ? [...msg.emotes].sort((a, b) => a.begin - b.begin)
    : msg.emotes;
  let cursor = 0;
  const normalizeNativeEmoteSpacing = msg.platform === 'kick' || msg.platform === 'youtube';

  for (let idx = 0; idx < sorted.length; idx++) {
    const e = sorted[idx];
    pushText(chars.slice(cursor, e.begin).join(''), `t${idx}`);

    // Kick and YouTube can report consecutive native emotes with touching
    // code-point ranges and no intervening whitespace. Keep all provider
    // whitespace intact, but separate directly adjacent native emotes once.
    if (normalizeNativeEmoteSpacing && idx > 0 && sorted[idx - 1].end === e.begin) {
      nodes.push(' ');
    }

    nodes.push(emoteImg(
      `pe-${idx}`,
      e.url,
      e.text,
      false,
      `ck-native-emote ck-native-${msg.platform}`,
    ));
    cursor = e.end;
  }
  pushText(chars.slice(cursor).join(''), 'tail');
  return nodes;
}

type EffectRenderUnit =
  | { kind: 'text'; value: string; hidden: boolean; key: string }
  | { kind: 'node'; value: React.ReactNode; key: string }
  | {
      kind: 'emote';
      value: React.ReactNode;
      key: string;
      bttv: EmoteEffect[];
      ffz: EmoteEffect[];
    };

function isEffectableEmoteNode(node: React.ReactNode): boolean {
  if (!React.isValidElement<{ className?: unknown }>(node)) return false;
  const className = typeof node.props.className === 'string' ? node.props.className : '';
  if (className.includes('ck-twemoji')) return false;
  return className.split(/\s+/).some((name) => name === 'ck-emote' || name === 'ck-zw');
}

function effectUnits(nodes: React.ReactNode[]): EffectRenderUnit[] {
  const units: EffectRenderUnit[] = [];
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (typeof node === 'string') {
      const parts = node.split(/(\s+)/);
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        if (!parts[partIndex]) continue;
        units.push({
          kind: 'text',
          value: parts[partIndex],
          hidden: false,
          key: `effect-text-${nodeIndex}-${partIndex}`,
        });
      }
    } else if (isEffectableEmoteNode(node)) {
      units.push({ kind: 'emote', value: node, key: `effect-emote-${nodeIndex}`, bttv: [], ffz: [] });
    } else {
      units.push({ kind: 'node', value: node, key: `effect-node-${nodeIndex}` });
    }
  }
  return units;
}

function addUniqueEffect(effects: EmoteEffect[], effect: EmoteEffect): void {
  if (!effects.includes(effect)) effects.push(effect);
}

function hideAdjacentWhitespace(
  units: EffectRenderUnit[],
  modifierIndex: number,
  direction: -1 | 1,
): void {
  const adjacent = units[modifierIndex + direction];
  if (adjacent?.kind === 'text' && /^\s+$/.test(adjacent.value)) adjacent.hidden = true;
}

function applyEmoteEffects(units: EffectRenderUnit[]): void {
  const pendingBttv: Array<{ effect: EmoteEffect; index: number }> = [];
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit.kind === 'text' && !/^\s+$/.test(unit.value)) {
      const bttv = BTTV_EMOTE_EFFECT_TOKENS[unit.value as keyof typeof BTTV_EMOTE_EFFECT_TOKENS];
      if (bttv) pendingBttv.push({ effect: bttv, index });
      continue;
    }
    if (unit.kind !== 'emote' || pendingBttv.length === 0) continue;
    for (const pending of pendingBttv) {
      addUniqueEffect(unit.bttv, pending.effect);
      const modifier = units[pending.index];
      if (modifier.kind === 'text') modifier.hidden = true;
      hideAdjacentWhitespace(units, pending.index, 1);
    }
    pendingBttv.length = 0;
  }

  let previousEmote: Extract<EffectRenderUnit, { kind: 'emote' }> | null = null;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (unit.kind === 'emote') {
      previousEmote = unit;
      continue;
    }
    if (unit.kind !== 'text' || /^\s+$/.test(unit.value) || !previousEmote) continue;
    const ffz = FFZ_EMOTE_EFFECT_TOKENS[unit.value as keyof typeof FFZ_EMOTE_EFFECT_TOKENS];
    if (!ffz) continue;
    addUniqueEffect(previousEmote.ffz, ffz);
    unit.hidden = true;
    hideAdjacentWhitespace(units, index, -1);
  }
}

function wrapEmoteEffects(
  unit: Extract<EffectRenderUnit, { kind: 'emote' }>,
): React.ReactNode {
  const provider = unit.bttv.length ? 'bttv' : unit.ffz.length ? 'ffz' : null;
  const effects = provider === 'bttv' ? unit.bttv : unit.ffz;
  if (!provider || effects.length === 0) return unit.value;

  let rendered = unit.value;
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    rendered = (
      <span
        className={`gx-emote-effect ${EFFECT_CLASS[effect]}${ANIMATED_EFFECTS.has(effect) ? ' gx-emote-effect-animated' : ''}`}
        data-emote-effect={effect}
      >
        {rendered}
      </span>
    );
  }
  return (
    <span
      key={unit.key}
      className="gx-emote-effect-unit"
      data-emote-effect-provider={provider}
    >
      {rendered}
    </span>
  );
}

/** text + provider emote offsets + community emotes + built-in modifiers. */
export function renderMessageText(
  msg: UnifiedMessage,
  sevenTV: SevenTVEmote[],
  mentions?: MentionContext,
): React.ReactNode[] {
  const nodes = renderMessageTextWithoutEffects(msg, sevenTV, mentions);
  if (msg.platform !== 'twitch') return nodes;

  if (!msg.text.split(/\s+/).some((token) => EMOTE_EFFECT_TOKEN_NAMES.has(token))) return nodes;

  const units = effectUnits(nodes);
  applyEmoteEffects(units);
  return units.flatMap((unit): React.ReactNode[] => {
    if (unit.kind === 'text') return unit.hidden ? [] : [unit.value];
    if (unit.kind === 'emote') return [wrapEmoteEffects(unit)];
    return [unit.value];
  });
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

/* YouTube's original inline artwork left noticeably more transparent padding
   than Twitch's CDN badges. The CSS box was already identical, but the visible
   glyph looked smaller. These marks intentionally fill almost the complete
   24x24 canvas so verified/moderator badges have the same visual footprint. */
const YT_ICON_BADGES: Record<string, string> = {
  moderator: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#3ea6ff" d="M12 1 2 4.8v6.6c0 5.8 4.2 10.6 10 12.1 5.8-1.5 10-6.3 10-12.1V4.8L12 1Zm5.8 6.2-7.4 7.9-4.2-3.9 1.7-1.8 2.5 2.3 5.7-6.1 1.7 1.6Z"/></svg>'),
  verified: 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#999999"/><path fill="#ffffff" d="m7.1 12.1 3.1 3.1 6.8-7.1 1.5 1.5-8.3 8.6-4.6-4.6 1.5-1.5Z"/></svg>'),
};


const YT_BADGE_ORDER: Record<string, number> = { verified: 0, moderator: 1, subscriber: 2 };
const SORTED_YOUTUBE_BADGES = new WeakMap<UnifiedMessage['badges'], UnifiedMessage['badges']>();
const SORTED_KICK_SUBSCRIBER_BADGES = new WeakMap<
  KickChannel['subscriber_badges'],
  KickChannel['subscriber_badges']
>();

function youtubeDisplayBadges(badges: UnifiedMessage['badges']): UnifiedMessage['badges'] {
  const cached = SORTED_YOUTUBE_BADGES.get(badges);
  if (cached) return cached;
  const sorted = [...badges]
    .filter((badge) => badge.type !== 'owner')
    .sort((a, b) => (YT_BADGE_ORDER[a.type] ?? 9) - (YT_BADGE_ORDER[b.type] ?? 9));
  SORTED_YOUTUBE_BADGES.set(badges, sorted);
  return sorted;
}

function kickSubscriberBadgesByMonths(
  badges: KickChannel['subscriber_badges'],
): KickChannel['subscriber_badges'] {
  const cached = SORTED_KICK_SUBSCRIBER_BADGES.get(badges);
  if (cached) return cached;
  const sorted = [...badges].sort((a, b) => b.months - a.months);
  SORTED_KICK_SUBSCRIBER_BADGES.set(badges, sorted);
  return sorted;
}


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


export function isYouTubeOwner(msg: UnifiedMessage): boolean {
  return msg.platform === 'youtube' && msg.badges.some(b => b.type === 'owner');
}

const COMMUNITY_BADGE_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  chatterino: 'Chatterino',
  homies: 'Chatterino Homies',
  'custom-homies': 'Chatterino Homies',
  moltorino: 'Moltorino',
  bluzyrino: 'Bluzyrino',
  ffz: 'FFZ',
  bttv: 'BTTV',
  turteg: 'Turteg',
  polandbot: 'PolandBOT',
  bchat: 'bChat',
  folhinha: 'Folhinha+',
  dankchat: 'DankChat',
  chatty: 'Chatty',
  chatsen: 'Chatsen',
  ffzap: 'FFZ:AP',
  streamnook: 'StreamNook',
  jilchat: 'JilChat',
  limerino: 'Limerino',
  previews: 'Previews',
  gxufy: 'Gxufy',
  enhancer: 'Enhancer',
};

function normalizedBadgeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function inferredCommunityBadgeName(
  providerKey: string,
  badgeId: string,
): string {
  let value = badgeId.trim();

  const providerPrefix = `${providerKey}-`;
  if (value.toLowerCase().startsWith(providerPrefix.toLowerCase())) {
    value = value.slice(providerPrefix.length);
  }

  if (!value || /^\d+$/.test(value)) return '';

  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
}

function badgeHoverTitle(
  badge: UnifiedMessage['badges'][number],
): string | undefined {
  if (!badge.type.startsWith('community:')) {
    return badge.title;
  }

  const [, providerKey = '', badgeId = ''] = badge.type.split(':');
  const provider =
    COMMUNITY_BADGE_PROVIDER_LABELS[providerKey]
    ?? providerKey
    ?? 'Community';

  const explicitTitle = badge.title?.trim() ?? '';
  const detail =
    explicitTitle
    || inferredCommunityBadgeName(providerKey, badgeId);

  if (!detail) return `${provider} badge`;

  if (
    normalizedBadgeLabel(detail).includes(
      normalizedBadgeLabel(provider),
    )
  ) {
    return detail;
  }

  return `${provider}  ${detail}`;
}

export function renderBadges(
  msg: UnifiedMessage,
  subscriberBadges: KickChannel['subscriber_badges'],
): React.ReactNode[] {
  const out: React.ReactNode[] = [];


  // (the name renders as a gold pill instead — see isYouTubeOwner)
  const badges = msg.platform === 'youtube'
    ? youtubeDisplayBadges(msg.badges)
    : msg.badges;

  for (let i = 0; i < badges.length; i++) {
    const b = badges[i];
    const key = `b-${i}-${b.type}`;
    if (b.url) {
      // TikTok badge art is frequently non-square (fan club, top gifter):
      // lock height only so it aligns with square badges without squishing
      const wide = msg.platform === 'tiktok';
      out.push(badgeImg(
        key,
        b.url,
        b.title ?? b.type,
        wide ? 'ck-badge-img ck-badge-wide' : 'ck-badge-img',
        b.backgroundColor,
        b.fallbackUrl,
        badgeHoverTitle(b),
      ));
      continue;
    }
    if (msg.platform === 'kick') {
      const simple = SIMPLE_KICK_BADGES[b.type];
      if (simple) { out.push(badgeImg(key, simple, b.type)); continue; }
      if (b.type === 'subscriber') {
        const match = kickSubscriberBadgesByMonths(subscriberBadges)
          .find(sb => (b.count ?? 0) >= sb.months);
        out.push(badgeImg(key, match?.badge_image.src ?? '/badges/subscriber.svg', 'subscriber'));
        continue;
      }
      if (b.type === 'sub_gifter') { out.push(badgeImg(key, kickGifterSrc(b.count ?? 0), 'gifter')); continue; }
      if (b.type === 'gift_rank') {
        const rank = b.count ?? 1;
        out.push(badgeImg(key, rank <= 1 ? '/badges/gift-rank-1.png' : rank === 2 ? '/badges/gift-rank-2.png' : '/badges/gift-rank-3.png', b.type));
        continue;
      }
      if (b.type === 'kicks_rank') {
        const rank = b.count ?? 1;
        out.push(badgeImg(key, rank <= 1 ? '/badges/kicks-rank-1.png' : rank === 2 ? '/badges/kicks-rank-2.png' : '/badges/kicks-rank-3.png', b.type));
        continue;
      }
    } else if (msg.platform === 'twitch') {
      const uuid = TWITCH_BADGE_IDS[b.type];
      if (uuid) {
        out.push(badgeImg(
          key,
          `https://static-cdn.jtvnw.net/badges/v1/${uuid}/2`,
          b.title ?? b.type,
          'ck-badge-img',
          undefined,
          undefined,
          b.title ?? b.type,
        ));
        continue;
      }
    } else {
      const yt = YT_ICON_BADGES[b.type];
      if (yt) { out.push(badgeImg(key, yt, b.type)); continue; }
      if (b.type === 'moderator') { out.push(badgeImg(key, '/badges/moderator.svg', 'moderator')); continue; }
      if (b.type === 'subscriber') { out.push(badgeImg(key, '/badges/subscriber.svg', 'subscriber')); continue; }
    }
  }
  return out;
}
