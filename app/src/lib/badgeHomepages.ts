/*
 * Where a badge or a painted name leads, and what it is called: the homepage
 * of the service that gives the badge (FFZ, BTTV, Chatterino, Moltorino, ...);
 * Twitch's own badges → their page on Stream Database; 7TV badges and paints
 * → their page on 7database; JilTV paints → jiltv.app; 7TV emotes → their
 * page on 7tv.app. Used by the generator's preview frames only:
 * hovering shows a small hint with the name and the site, clicking opens the
 * page in a new tab. The OBS overlays never attach this.
 *
 * A provider without a homepage here has no link: its badge only shows its
 * name.
 */
import type { MessageCosmetics } from './messageCosmetics';
import { shownPaintSource } from './paintChoice';
import { twitchFallbackBadgeSrc } from './twitchBadgeArt';
import type { Platform, UnifiedBadge, UnifiedMessage } from './types';

/** By community provider key (`community:<provider>:…`). */
export const BADGE_PROVIDER_HOMEPAGES: Readonly<Record<string, string>> = {
  '7tv': 'https://7database.com',
  chatterino: 'https://chatterino.com',
  homies: 'https://chatterinohomies.com',
  'custom-homies': 'https://chatterinohomies.com',
  moltorino: 'https://moltorino.com',
  ffz: 'https://www.frankerfacez.com',
  ffzap: 'https://ffzap.com',
  bttv: 'https://betterttv.com',
  polandbot: 'https://devpoland.xyz',
  badgehq: 'https://www.badgehq.xyz',
  bchat: 'https://bchat.itsbr0dyy.dev',
  bluzyrino: 'https://bluzyrino.com',
  solrino: 'https://solrino.solrino-badge-server.workers.dev',
  turteg: 'https://turteg.xslash.ovh',
  folhinha: 'https://folhinhabot.com',
  dankchat: 'https://github.com/flex3r/DankChat',
  chatty: 'https://chatty.github.io',
  chatsen: 'https://chatsen.app',
  streamnook: 'https://streamnook.app',
  jilchat: 'https://jil.chat',
  jiltv: 'https://jiltv.app',
  limerino: 'https://limerino.com',
  enhancer: 'https://enhancer.at',
  previews: 'https://previews-app.com',
  chatlee: 'https://chatlee.lol',
  uchat: 'https://unii.dev',
  yautc: 'https://fiszh.github.io/YAUTC/',
  /* FlossChat's own supporter badge: our supporter page. */
  gxufy: '/support',
};

const STREAM_DATABASE = 'https://www.streamdatabase.com/twitch/global-badges';
const SEVEN_DATABASE = 'https://7database.com';
const SEVENTV_ID = /^[A-Za-z0-9]{10,40}$/;

/** A 7TV badge's or paint's page on 7database (it uses 7TV's own ids). */
export function sevenTVDatabaseUrl(kind: 'badge' | 'paint', id: string): string {
  return SEVENTV_ID.test(id) ? `${SEVEN_DATABASE}/${kind}/${id}` : SEVEN_DATABASE;
}

/** The 7TV id in a badge's or emote's art address (cdn.7tv.app/<kind>/<id>/…), or null. */
function sevenTVIdFromArt(src: string, kind: 'badge' | 'emote'): string | null {
  try {
    const url = new URL(src, 'https://flosschat.invalid/');
    if (url.hostname !== 'cdn.7tv.app') return null;
    const [, first, id = ''] = url.pathname.split('/');
    return first === kind && SEVENTV_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A 7TV emote's page on 7tv.app. */
export function sevenTVEmoteUrl(id: string): string {
  return SEVENTV_ID.test(id) ? `https://7tv.app/emotes/${id}` : 'https://7tv.app';
}

/**
 * A Twitch badge's page on Stream Database: /twitch/global-badges/<set>/<version>.
 * Subscriber badges are the channel's own art, so they lead to the general
 * Subscriber page; a badge without a usable version to the badge list.
 */
export function twitchBadgeDatabaseUrl(badge: Pick<UnifiedBadge, 'type' | 'version'>): string {
  const set = badge.type.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(set)) return STREAM_DATABASE;
  if (set === 'subscriber') return `${STREAM_DATABASE}/subscriber/0`;
  const version = (badge.version ?? '').trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(version) ? `${STREAM_DATABASE}/${set}/${version}` : STREAM_DATABASE;
}

const PLATFORM_HOMEPAGES: Readonly<Record<Platform, string>> = {
  twitch: 'https://www.twitch.tv',
  kick: 'https://kick.com',
  youtube: 'https://www.youtube.com',
  tiktok: 'https://www.tiktok.com',
};

/** Where one badge of a message on `platform` leads, or null. */
export function badgeHomepage(badge: Pick<UnifiedBadge, 'type' | 'version' | 'url'>, platform: Platform): string | null {
  const type = badge.type.trim().toLowerCase();
  if (type.startsWith('community:')) {
    const provider = type.split(':', 3)[1] ?? '';
    const sevenTVId = provider === '7tv' && badge.url ? sevenTVIdFromArt(badge.url, 'badge') : null;
    if (sevenTVId) return sevenTVDatabaseUrl('badge', sevenTVId);
    return BADGE_PROVIDER_HOMEPAGES[provider] ?? null;
  }
  if (platform === 'twitch') return twitchBadgeDatabaseUrl(badge);
  return PLATFORM_HOMEPAGES[platform] ?? null;
}

/** What a hovered badge or painted name is called and where it leads. */
export interface PreviewHover {
  readonly link: string | null;
  readonly name: string | null;
}

/** Built from the preview's messages and cosmetics: badges by the address of
 * their drawn image, painted names by the chatter's name (lower case). */
export interface PreviewHoverIndex {
  readonly badges: ReadonlyMap<string, PreviewHover>;
  readonly paints: ReadonlyMap<string, PreviewHover>;
}

const PAINT_WORD = /\bpaint$/i;

/** "Android" → "Android paint"; a name that already ends in "paint" stays. */
function paintLabel(name: string | undefined, unnamed: string): string {
  const text = name?.trim() ?? '';
  if (!text) return unnamed;
  return PAINT_WORD.test(text) ? text : `${text} paint`;
}

export function previewHoverIndex(
  messages: readonly UnifiedMessage[],
  cosmetics?: Pick<MessageCosmetics, 'badges' | 'paints' | 'entitlements' | 'paintSources'>,
): PreviewHoverIndex {
  const badges = new Map<string, PreviewHover>();
  const paints = new Map<string, PreviewHover>();
  for (const message of messages) {
    for (const badge of message.badges ?? []) {
      const link = badgeHomepage(badge, message.platform);
      if (!link) continue;
      /* A Twitch badge without its own art address is drawn with Twitch's
         common art for its set (see twitchBadgeArt). */
      const drawn = !badge.url && message.platform === 'twitch' ? twitchFallbackBadgeSrc(badge.type) : null;
      for (const src of [badge.url, badge.fallbackUrl, drawn]) {
        if (src && !badges.has(src)) badges.set(src, { link, name: null });
      }
    }
  }
  /* 7TV badges: every one the preview knows, by its art. */
  for (const badge of cosmetics?.badges ?? []) {
    if (!badges.has(badge.image)) badges.set(badge.image, { link: sevenTVDatabaseUrl('badge', badge.id), name: badge.name ?? null });
  }
  /* Paints: by the name of the chatter wearing one, the one their name shows
     when they wear both (paintChoice.ts). */
  const paintById = new Map((cosmetics?.paints ?? []).map((paint) => [paint.id, paint]));
  for (const message of messages) {
    const key = message.username.trim().toLowerCase();
    if (!key || paints.has(key)) continue;
    const sender = `${message.platform}:${message.senderId}`;
    const sevenTVId = cosmetics && (message.platform === 'twitch' || message.platform === 'kick') && message.senderId
      ? cosmetics.entitlements[sender]?.paint
      : undefined;
    const sevenTV = sevenTVId ? paintById.get(sevenTVId) : undefined;
    const jiltv = message.platform === 'twitch' ? message.jiltvPaint : undefined;
    const shown = shownPaintSource(Boolean(sevenTV), Boolean(jiltv), cosmetics?.paintSources?.get(sender));
    if (shown === '7tv' && sevenTV) {
      paints.set(key, { link: sevenTVDatabaseUrl('paint', sevenTV.id), name: paintLabel(sevenTV.name, '7TV paint') });
    } else if (shown === 'jiltv' && jiltv) {
      paints.set(key, { link: BADGE_PROVIDER_HOMEPAGES.jiltv ?? null, name: paintLabel(jiltv.name, 'JilTV paint') });
    }
  }
  return { badges, paints };
}

/** Where a drawn badge's art alone says it leads (Twitch's badge art → the
 * Stream Database list, 7TV's → its 7database page). */
function linkForBadgeArt(src: string): string | null {
  try {
    const url = new URL(src, 'https://flosschat.invalid/');
    if (url.hostname === 'static-cdn.jtvnw.net' && url.pathname.startsWith('/badges/')) return STREAM_DATABASE;
  } catch {
    return null;
  }
  const sevenTVId = sevenTVIdFromArt(src, 'badge');
  return sevenTVId ? sevenTVDatabaseUrl('badge', sevenTVId) : null;
}

/** A readable name from a badge image's alt text ("sub_gifter" → "Sub gifter");
 * raw provider keys ("community:ffz:3") are not names. */
function nameFromAlt(alt: string | null): string | null {
  const text = (alt ?? '').trim();
  if (!text || text.includes(':')) return null;
  if (text.toLowerCase() === '7tv badge') return '7TV badge';
  const words = text.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const BADGE_IMAGE = 'img.ck-badge-img';
const EMOTE_IMAGE = 'img.ck-emote';
const PAINTED_NAME = '.ck-name-paint, .gx-event-name-paint';
const HOVER_TARGET = `${BADGE_IMAGE}, ${EMOTE_IMAGE}, ${PAINTED_NAME}`;

/** The chatter name a painted name element shows (without the ':'). */
function paintedNameText(element: Element): string {
  const shown = element.getAttribute('data-gx-glyph')
    ?? element.querySelector('.gx-paint-foreground')?.textContent
    ?? element.textContent
    ?? '';
  return shown.replace(/:\s*$/, '').trim().toLowerCase();
}

/**
 * The hover for one element under the pointer: a badge image (its link from
 * the index or its art, its name from the index, its own title or alt text),
 * a 7TV emote, or a 7TV-painted name. `title` is the badge's title text, which the hover
 * takes off the element (see attachPreviewBadgeLinks).
 */
export function previewHoverFor(element: Element, title: string | null, index: PreviewHoverIndex): PreviewHover | null {
  if (element.matches(BADGE_IMAGE)) {
    const src = element.getAttribute('src') ?? '';
    const known = index.badges.get(src);
    const link = known?.link ?? (src ? linkForBadgeArt(src) : null);
    /* Titles join the provider and the badge with two spaces ("bChat  Supporters"). */
    const name = (known?.name || title || nameFromAlt(element.getAttribute('alt')) || '').replace(/\s+/g, ' ').trim();
    return link || name ? { link, name: name || null } : null;
  }
  if (element.matches(EMOTE_IMAGE)) {
    /* 7TV emotes only: their page on 7tv.app, named by the emote's own name. */
    const id = sevenTVIdFromArt(element.getAttribute('src') ?? '', 'emote');
    const name = (element.getAttribute('alt') ?? '').trim();
    return id ? { link: sevenTVEmoteUrl(id), name: name || null } : null;
  }
  if (element.matches(PAINTED_NAME)) return index.paints.get(paintedNameText(element)) ?? null;
  return null;
}

/** The site a link is on, as the hover hint names it: the host without
 * "www.", plus the path for one of our own pages. */
export function badgeLinkLabel(link: string, here: string): string {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^www\./, '');
    const own = url.origin === new URL(here).origin;
    return own && url.pathname !== '/' ? `${host}${url.pathname}` : host;
  } catch {
    return '';
  }
}

const HINT_STYLE = [
  'position:fixed', 'z-index:2147483647', 'pointer-events:none', 'white-space:nowrap',
  'font-family:system-ui,-apple-system,"Segoe UI",sans-serif', 'font-weight:600', 'line-height:1',
  'color:rgba(255,255,255,.92)', 'background:rgba(16,16,20,.88)', 'border:1px solid rgba(255,255,255,.14)',
  'border-radius:999px', 'box-shadow:0 2px 8px rgba(0,0,0,.35)', 'opacity:0',
  'transition:opacity .15s ease', 'left:0', 'top:0',
].join(';');
const HINT_SITE_STYLE = 'font-weight:500;color:rgba(255,255,255,.58)';

/**
 * In a preview frame: hovering a badge, a 7TV emote or a 7TV-painted name shows, after a
 * short moment, a small hint above it with its name and the site it leads to
 * ("Haiti · 7database.com ↗"); a linked one shows a pointer and opens its
 * page in a new tab when clicked. The browser's own title tooltip is taken
 * off the hovered badge (its text goes into the hint), so only one shows.
 * Nothing else in the drawn rows changes (the cursor is set on the document
 * root; the hint is its own element). The hint is sized against the frame's
 * own scale, so it reads the same in a scaled-down preview. Moving straight
 * from one to the next keeps it up. Returns a stop function.
 */
export function attachPreviewBadgeLinks(
  doc: Document,
  resolve: (element: Element, title: string | null) => PreviewHover | null,
): () => void {
  const win = doc.defaultView;
  const here = (): string => doc.location?.href ?? 'https://flosschat.invalid/';
  /* Title texts taken off badges, so the browser's tooltip doesn't also show. */
  const titles = new WeakMap<Element, string>();
  const takeTitle = (element: Element): string | null => {
    const own = element.getAttribute('title');
    if (own !== null) {
      titles.set(element, own);
      element.removeAttribute('title');
      return own;
    }
    return titles.get(element) ?? null;
  };
  const targetOf = (target: EventTarget | null): Element | null =>
    target && typeof (target as Element).closest === 'function' ? (target as Element).closest(HOVER_TARGET) : null;
  const hoverOf = (element: Element | null): { link: string | null; name: string | null } | null => {
    if (!element) return null;
    const found = resolve(element, takeTitle(element));
    if (!found) return null;
    let link: string | null = null;
    if (found.link) {
      try {
        const url = new URL(found.link, here());
        link = url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
      } catch {
        link = null;
      }
    }
    return link || found.name ? { link, name: found.name } : null;
  };
  let hint: HTMLElement | null = null;
  let hovered: Element | null = null;
  let follow: number | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;

  /* How much the parent page scales this frame (the generator draws the
     overlay at OBS size, then scales it down). */
  const frameScale = (): number => {
    try {
      const frame = win?.frameElement;
      const width = frame?.getBoundingClientRect().width ?? 0;
      const scale = width && win?.innerWidth ? width / win.innerWidth : 1;
      return scale > 0.1 && scale < 10 ? scale : 1;
    } catch {
      return 1;
    }
  };
  const place = () => {
    if (!hint || !hovered || !hovered.isConnected) {
      hide();
      return;
    }
    /* A redraw may put the title back while the pointer rests on it. */
    if (hovered.hasAttribute('title')) takeTitle(hovered);
    const scale = frameScale();
    const gap = 6 / scale;
    const box = hovered.getBoundingClientRect();
    const width = hint.offsetWidth;
    const height = hint.offsetHeight;
    const viewport = win?.innerWidth ?? 0;
    const left = Math.max(4 / scale, Math.min(viewport - width - 4 / scale, box.left + box.width / 2 - width / 2));
    const above = box.top - height - gap;
    const top = above >= 2 / scale ? above : box.bottom + gap;
    hint.style.left = `${left}px`;
    hint.style.top = `${top}px`;
    follow = typeof win?.requestAnimationFrame === 'function' ? win.requestAnimationFrame(place) : null;
  };
  const fill = (into: HTMLElement, hover: { link: string | null; name: string | null }) => {
    into.replaceChildren();
    const site = hover.link ? badgeLinkLabel(hover.link, here()) : '';
    if (hover.name) into.append(hover.name);
    if (site) {
      const part = doc.createElement('span');
      part.style.cssText = HINT_SITE_STYLE;
      part.textContent = `${hover.name ? ' · ' : 'View on '}${site} ↗`;
      into.append(part);
    }
  };
  const show = (element: Element, hover: { link: string | null; name: string | null }) => {
    if (!hint) {
      hint = doc.createElement('div');
      hint.className = 'gx-badge-link-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.style.cssText = HINT_STYLE;
      if (win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) hint.style.transition = 'none';
      doc.body.appendChild(hint);
    }
    const scale = frameScale();
    hint.style.fontSize = `${11 / scale}px`;
    hint.style.padding = `${4 / scale}px ${8 / scale}px`;
    fill(hint, hover);
    hovered = element;
    if (follow !== null) win?.cancelAnimationFrame?.(follow);
    place();
    if (showTimer !== null) clearTimeout(showTimer);
    showTimer = null;
    /* Moving from one straight to the next keeps the hint up. */
    if (hint.style.opacity === '1') return;
    /* Otherwise a short moment first, so sweeping across the line stays quiet. */
    showTimer = setTimeout(() => {
      showTimer = null;
      if (hint && hovered === element) hint.style.opacity = '1';
    }, 120);
  };
  function hide() {
    hovered = null;
    if (showTimer !== null) clearTimeout(showTimer);
    showTimer = null;
    if (follow !== null) win?.cancelAnimationFrame?.(follow);
    follow = null;
    if (hint) hint.style.opacity = '0';
  }

  const onOver = (event: Event) => {
    const element = targetOf(event.target);
    if (!element) return;
    const hover = hoverOf(element);
    doc.documentElement.style.cursor = hover?.link ? 'pointer' : '';
    if (hover) show(element, hover);
    else hide();
  };
  const onOut = (event: Event) => {
    const element = targetOf(event.target);
    if (!element) return;
    const next = targetOf((event as PointerEvent).relatedTarget ?? null);
    /* Still inside it, or straight onto the next one: its own pointerover follows. */
    if (next === element || (next && hoverOf(next))) return;
    doc.documentElement.style.cursor = '';
    hide();
  };
  const onClick = (event: Event) => {
    const link = hoverOf(targetOf(event.target))?.link;
    if (!link) return;
    event.preventDefault();
    hide();
    win?.open(link, '_blank', 'noopener,noreferrer');
  };
  doc.addEventListener('pointerover', onOver);
  doc.addEventListener('pointerout', onOut);
  doc.addEventListener('click', onClick);
  return () => {
    doc.removeEventListener('pointerover', onOver);
    doc.removeEventListener('pointerout', onOut);
    doc.removeEventListener('click', onClick);
    doc.documentElement.style.cursor = '';
    hide();
    hint?.remove();
    hint = null;
  };
}
