/* Preview badges and 7TV-painted names: their name and site on hover, their page on click. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BADGE_PROVIDER_HOMEPAGES,
  attachPreviewBadgeLinks,
  badgeHomepage,
  badgeLinkLabel,
  previewHoverFor,
  previewHoverIndex,
  sevenTVDatabaseUrl,
  sevenTVEmoteUrl,
  twitchBadgeDatabaseUrl,
  type PreviewHoverIndex,
} from '@/lib/badgeHomepages';
import type { MessageCosmetics } from '@/lib/messageCosmetics';
import type { UnifiedMessage } from '@/lib/types';

const message: UnifiedMessage = {
  platform: 'twitch',
  id: 'm',
  senderId: '1',
  username: 'Xslash58',
  color: '#fff',
  badges: [
    { type: 'moderator', version: '1' },
    { type: 'bits', version: '1000', url: 'https://static-cdn.jtvnw.net/badges/v1/0d85a29e-79ad-4c63-a285-3acd2c66f2ba/3' },
    { type: 'community:ffz:sub', url: 'https://cdn.frankerfacez.com/badge/3/4' },
    { type: 'community:moltorino:supporter', url: 'https://api.moltorino.com/badges/assets/supporter/3x.webp', fallbackUrl: 'https://api.moltorino.com/badges/assets/supporter/still.webp' },
    { type: 'community:turteg:x', url: 'https://i.xslash.ovh/turtegbot/badges/x/4x.webp' },
    { type: 'community:gxufy:supporter', url: '/badges/gxufy/supporter/4x.png' },
  ],
  text: 'hi',
  emotes: [],
  timestamp: 0,
  kind: 'chat',
};

const painted: UnifiedMessage = { ...message, id: 'p', senderId: '2', username: 'Gxufy', badges: [] };

const cosmetics: Pick<MessageCosmetics, 'badges' | 'paints' | 'entitlements'> = {
  badges: [
    { id: '01KV06K03RKQPRF10KTMZXBBSC', image: 'https://cdn.7tv.app/badge/01KV06K03RKQPRF10KTMZXBBSC/3x.webp', name: 'Haiti' },
    { id: '01GAFGGTF8000E8VNG1S1RMTC1', image: 'https://cdn.7tv.app/badge/01GAFGGTF8000E8VNG1S1RMTC1/3x.webp' },
  ],
  paints: [
    { id: '01JHXJFACX42RV996VE9933TB8', name: 'Emerald Doppler', func: 'LINEAR_GRADIENT', repeat: false, shadows: [], stops: [] },
  ],
  entitlements: { 'twitch:2': { paint: '01JHXJFACX42RV996VE9933TB8', badge: '01KV06K03RKQPRF10KTMZXBBSC' } },
};

function badgeImage(src: string, alt = '', title?: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'ck-badge-img';
  img.setAttribute('src', src);
  img.setAttribute('alt', alt);
  if (title) img.setAttribute('title', title);
  return img;
}

describe('badge links', () => {
  it('know each provider, Twitch badges on Stream Database and 7TV on 7database', () => {
    expect(badgeHomepage({ type: 'community:7tv:x' }, 'twitch')).toBe('https://7database.com');
    expect(badgeHomepage({ type: 'community:7tv:x', url: 'https://cdn.7tv.app/badge/01GAFGGTF8000E8VNG1S1RMTC1/3x.webp' }, 'twitch'))
      .toBe('https://7database.com/badge/01GAFGGTF8000E8VNG1S1RMTC1');
    expect(badgeHomepage({ type: 'community:bttv:pro' }, 'twitch')).toBe('https://betterttv.com');
    expect(badgeHomepage({ type: 'community:bchat:supporters' }, 'twitch')).toBe('https://bchat.itsbr0dyy.dev');
    expect(badgeHomepage({ type: 'community:custom-homies:x' }, 'twitch')).toBe('https://chatterinohomies.com');
    expect(badgeHomepage({ type: 'moderator', version: '1' }, 'twitch')).toBe('https://www.streamdatabase.com/twitch/global-badges/moderator/1');
    expect(badgeHomepage({ type: 'subscriber' }, 'kick')).toBe('https://kick.com');
    expect(badgeHomepage({ type: 'community:turteg:x' }, 'twitch')).toBe('https://turteg.xslash.ovh');
    expect(badgeHomepage({ type: 'community:bluzyrino:x' }, 'twitch')).toBe('https://bluzyrino.com');
    expect(badgeHomepage({ type: 'community:unknown-provider:x' }, 'twitch')).toBeNull();
  });

  it('send Twitch badges to their Stream Database page', () => {
    const base = 'https://www.streamdatabase.com/twitch/global-badges';
    expect(twitchBadgeDatabaseUrl({ type: 'glhf-pledge', version: '1' })).toBe(`${base}/glhf-pledge/1`);
    expect(twitchBadgeDatabaseUrl({ type: 'bits', version: '1000' })).toBe(`${base}/bits/1000`);
    expect(twitchBadgeDatabaseUrl({ type: 'founder', version: '0' })).toBe(`${base}/founder/0`);
    expect(twitchBadgeDatabaseUrl({ type: 'predictions', version: 'blue-1' })).toBe(`${base}/predictions/blue-1`);
    /* Sub badges are each channel's own art: the general Subscriber page. */
    expect(twitchBadgeDatabaseUrl({ type: 'subscriber', version: '3012' })).toBe(`${base}/subscriber/0`);
    expect(twitchBadgeDatabaseUrl({ type: 'moderator' })).toBe(base);
    expect(twitchBadgeDatabaseUrl({ type: 'moderator', version: '../1' })).toBe(base);
    expect(twitchBadgeDatabaseUrl({ type: 'a/b', version: '1' })).toBe(base);
  });

  it('send 7TV badges and paints to their 7database page', () => {
    expect(sevenTVDatabaseUrl('badge', '01KV06K03RKQPRF10KTMZXBBSC')).toBe('https://7database.com/badge/01KV06K03RKQPRF10KTMZXBBSC');
    expect(sevenTVDatabaseUrl('paint', '01JHXJFACX42RV996VE9933TB8')).toBe('https://7database.com/paint/01JHXJFACX42RV996VE9933TB8');
    expect(sevenTVDatabaseUrl('paint', '../x')).toBe('https://7database.com');
  });

  it('only link to https pages (or our own supporter page)', () => {
    for (const [provider, url] of Object.entries(BADGE_PROVIDER_HOMEPAGES)) {
      expect(url.startsWith('https://') || (provider === 'gxufy' && url === '/support'), provider).toBe(true);
    }
  });

  it('name the site for the hover hint', () => {
    expect(badgeLinkLabel('https://www.streamdatabase.com/twitch/global-badges/moderator/1', 'https://flosschat.com/multichat')).toBe('streamdatabase.com');
    expect(badgeLinkLabel('https://7database.com/paint/x', 'https://flosschat.com/multichat')).toBe('7database.com');
    expect(badgeLinkLabel('https://flosschat.com/support', 'https://flosschat.com/multichat')).toBe('flosschat.com/support');
    expect(badgeLinkLabel('not a link', 'https://flosschat.com/')).toBe('');
  });
});

describe('preview hover index', () => {
  const index = previewHoverIndex([message, painted], cosmetics);

  it('finds a drawn badge by its address, its still art, or its art host', () => {
    const at = (src: string, alt = '', title: string | null = null) => previewHoverFor(badgeImage(src, alt), title, index);
    expect(at('https://cdn.frankerfacez.com/badge/3/4', 'community:ffz:sub', 'FFZ Subscriber')).toEqual({ link: 'https://www.frankerfacez.com', name: 'FFZ Subscriber' });
    expect(at('https://api.moltorino.com/badges/assets/supporter/still.webp')?.link).toBe('https://moltorino.com');
    /* Twitch's common art for a badge drawn without its own address. */
    expect(at('https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3', 'moderator', 'Moderator'))
      .toEqual({ link: 'https://www.streamdatabase.com/twitch/global-badges/moderator/1', name: 'Moderator' });
    expect(at('https://static-cdn.jtvnw.net/badges/v1/0d85a29e-79ad-4c63-a285-3acd2c66f2ba/3')?.link).toBe('https://www.streamdatabase.com/twitch/global-badges/bits/1000');
    expect(at('https://static-cdn.jtvnw.net/badges/v1/ffffffff-0000-0000-0000-000000000000/3')?.link).toBe('https://www.streamdatabase.com/twitch/global-badges');
    expect(at('/badges/gxufy/supporter/4x.png')?.link).toBe('/support');
  });

  it('names 7TV badges from 7TV, and links them to 7database', () => {
    expect(previewHoverFor(badgeImage('https://cdn.7tv.app/badge/01KV06K03RKQPRF10KTMZXBBSC/3x.webp', '7tv badge'), '7TV badge', index))
      .toEqual({ link: 'https://7database.com/badge/01KV06K03RKQPRF10KTMZXBBSC', name: 'Haiti' });
    /* Without a name from 7TV the badge's own title is used. */
    expect(previewHoverFor(badgeImage('https://cdn.7tv.app/badge/01GAFGGTF8000E8VNG1S1RMTC1/3x.webp', '7tv badge'), '7TV badge', index))
      .toEqual({ link: 'https://7database.com/badge/01GAFGGTF8000E8VNG1S1RMTC1', name: '7TV badge' });
    /* Art the preview doesn't know: its 7database page by the id in the address. */
    expect(previewHoverFor(badgeImage('https://cdn.7tv.app/badge/01HHF46WW0000FZJESD3JH08B4/3x.webp', '7tv badge'), null, index))
      .toEqual({ link: 'https://7database.com/badge/01HHF46WW0000FZJESD3JH08B4', name: '7TV badge' });
  });

  it('shows a name without a link for a provider without a homepage, and nothing for an unnamed one', () => {
    expect(previewHoverFor(badgeImage('https://i.xslash.ovh/turtegbot/badges/x/4x.webp', 'community:turteg:x'), 'Turteg Contributor', index))
      .toEqual({ link: 'https://turteg.xslash.ovh', name: 'Turteg Contributor' });
    expect(previewHoverFor(badgeImage('https://badges.example.org/x/4x.webp', 'community:unknown-provider:x'), 'Someone Contributor', index))
      .toEqual({ link: null, name: 'Someone Contributor' });
    expect(previewHoverFor(badgeImage('https://badges.example.org/x/4x.webp', 'community:unknown-provider:x'), null, index)).toBeNull();
    expect(previewHoverFor(badgeImage('/badges/kick/sub_gifter.svg', 'sub_gifter'), null, index)).toEqual({ link: null, name: 'Sub gifter' });
    /* One space between the provider and the badge, as written in a sentence. */
    expect(previewHoverFor(badgeImage('https://itsbr0dyy.dev/badges/supporter.webp', 'community:bchat:supporters'), 'bChat  Supporters', index)?.name).toBe('bChat Supporters');
  });

  it('finds a 7TV-painted name (chat line or event) by the chatter, with the paint name', () => {
    document.body.innerHTML = `
      <span class="ck-name ck-chat-name ck-name-paint"><span class="gx-paint-edge">Gxufy:</span><span class="gx-paint-foreground">Gxufy:</span></span>
      <span class="gx-event-name gx-sub-name gx-event-name-paint" data-gx-glyph="gxufy"><span class="gx-event-name-paint-fg">gxufy</span></span>
      <span class="ck-name ck-chat-name ck-name-paint"><span class="gx-paint-foreground">Xslash58:</span></span>
      <span class="ck-name ck-chat-name">Gxufy:</span>`;
    const [chat, event, other, plain] = Array.from(document.body.children);
    const emerald = { link: 'https://7database.com/paint/01JHXJFACX42RV996VE9933TB8', name: 'Emerald Doppler paint' };
    expect(previewHoverFor(chat!, null, index)).toEqual(emerald);
    expect(previewHoverFor(event!, null, index)).toEqual(emerald);
    /* Painted but not by 7TV here (no entitlement), or not painted at all. */
    expect(previewHoverFor(other!, null, index)).toBeNull();
    expect(previewHoverFor(plain!, null, index)).toBeNull();
    document.body.innerHTML = '';
  });

  it('sends 7TV emotes to their 7tv.app page, by the emote name; other emotes stay quiet', () => {
    const emote = (src: string, alt: string) => {
      const img = document.createElement('img');
      img.className = 'ck-emote';
      img.setAttribute('src', src);
      img.setAttribute('alt', alt);
      return img;
    };
    expect(previewHoverFor(emote('https://cdn.7tv.app/emote/01F6ME9FRG0005TFYTWP1H8R42/4x.webp', 'catJam'), null, index))
      .toEqual({ link: 'https://7tv.app/emotes/01F6ME9FRG0005TFYTWP1H8R42', name: 'catJam' });
    expect(previewHoverFor(emote('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0', 'Kappa'), null, index)).toBeNull();
    expect(previewHoverFor(emote('https://cdn.betterttv.net/emote/5f1b0186cf6d2144653d2970/3x', 'catJAM'), null, index)).toBeNull();
    expect(previewHoverFor(emote('https://cdn.7tv.app/badge/01F6ME9FRG0005TFYTWP1H8R42/4x.webp', 'x'), null, index)).toBeNull();
    expect(sevenTVEmoteUrl('../x')).toBe('https://7tv.app');
  });

  it('works without cosmetics, and says "7TV paint" for a paint without a name', () => {
    const bare = previewHoverIndex([message]);
    expect(bare.paints.size).toBe(0);
    const unnamed = previewHoverIndex([painted], { ...cosmetics, paints: [{ ...cosmetics.paints[0]!, name: undefined }] });
    expect(unnamed.paints.get('gxufy')?.name).toBe('7TV paint');
  });

  it('names the paint the name shows: 7TV first, JilTV once the chatter asked for it', () => {
    const jiltvPaint = { id: '01M5TCPBHMFJ8BX1VCFQWEP8ST', name: 'Android', texture: 'https://cdn.jiltv.app/paints/a.webp', shadows: [] };
    const jiltvHint = { link: 'https://jiltv.app', name: 'Android paint' };
    const sevenTVHint = { link: 'https://7database.com/paint/01JHXJFACX42RV996VE9933TB8', name: 'Emerald Doppler paint' };
    expect(previewHoverIndex([{ ...painted, jiltvPaint }]).paints.get('gxufy')).toEqual(jiltvHint);
    /* Wearing both, 7TV's is drawn, so the hint names it. */
    expect(previewHoverIndex([{ ...painted, jiltvPaint }], cosmetics).paints.get('gxufy')).toEqual(sevenTVHint);
    /* After asking for JilTV here, the JilTV one. */
    const asked = { ...cosmetics, paintSources: new Map([[`twitch:${painted.senderId}`, 'jiltv' as const]]) };
    expect(previewHoverIndex([{ ...painted, jiltvPaint }], asked).paints.get('gxufy')).toEqual(jiltvHint);
    /* JilTV paints are Twitch only. */
    expect(previewHoverIndex([{ ...painted, platform: 'kick', jiltvPaint }]).paints.size).toBe(0);
  });
});

describe('preview hover', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.style.cursor = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function draw() {
    document.body.innerHTML = `
      <div class="gx-message-row"><span class="ck-bw">
        <img class="ck-badge-img" src="https://cdn.frankerfacez.com/badge/3/4" alt="community:ffz:sub" title="FFZ Subscriber">
        <img class="ck-badge-img" src="https://badges.example.org/x/4x.webp" alt="community:unknown-provider:x" title="Someone Contributor">
        <img class="ck-badge-img" src="/badges/gxufy/supporter/4x.png" alt="FlossChat" title="FlossChat Supporter">
        <img class="ck-badge-img" src="https://badges.example.org/y/4x.webp" alt="community:unknown-provider:y">
      </span><span class="ck-name ck-chat-name ck-name-paint"><span class="gx-paint-foreground">Gxufy:</span></span><span class="ck-chat-text">hi <img class="ck-emote" src="https://cdn.7tv.app/emote/01F6ME9FRG0005TFYTWP1H8R42/4x.webp" alt="catJam"></span></div>`;
    const imgs = Array.from(document.querySelectorAll('img'));
    return { ffz: imgs[0]!, other: imgs[1]!, ours: imgs[2]!, unnamed: imgs[3]!, emote: imgs[4]!, name: document.querySelector('.ck-name-paint')!, text: document.querySelector('.ck-chat-text')! };
  }
  const hint = () => document.querySelector<HTMLElement>('.gx-badge-link-hint');
  const over = (el: Element) => el.dispatchEvent(new Event('pointerover', { bubbles: true }));
  const out = (el: Element, to: Element | null = null) => el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: to }));
  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const attach = (messages: UnifiedMessage[] = [message, painted]) => {
    const index: PreviewHoverIndex = previewHoverIndex(messages, cosmetics);
    return attachPreviewBadgeLinks(document, (element, title) => previewHoverFor(element, title, index));
  };

  it('opens the page in a new tab, shows a pointer only for links, and leaves the rest alone', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const stop = attach();
    const { ffz, other, ours, emote, name, text } = draw();

    over(ffz);
    expect(document.documentElement.style.cursor).toBe('pointer');
    click(ffz);
    expect(open).toHaveBeenCalledWith('https://www.frankerfacez.com/', '_blank', 'noopener,noreferrer');
    out(ffz);
    expect(document.documentElement.style.cursor).toBe('');

    over(other);
    expect(document.documentElement.style.cursor).toBe('');
    click(other);
    expect(open).toHaveBeenCalledTimes(1);

    click(ours);
    expect(open).toHaveBeenLastCalledWith(new URL('/support', document.location.href).href, '_blank', 'noopener,noreferrer');

    over(name.firstElementChild!);
    expect(document.documentElement.style.cursor).toBe('pointer');
    click(name.firstElementChild!);
    expect(open).toHaveBeenLastCalledWith('https://7database.com/paint/01JHXJFACX42RV996VE9933TB8', '_blank', 'noopener,noreferrer');

    click(text);
    expect(open).toHaveBeenCalledTimes(3);
    click(emote);
    expect(open).toHaveBeenLastCalledWith('https://7tv.app/emotes/01F6ME9FRG0005TFYTWP1H8R42', '_blank', 'noopener,noreferrer');

    stop();
    click(ffz);
    expect(open).toHaveBeenCalledTimes(4);
  });

  it('replaces the browser tooltip with one small hint: name, then the site', () => {
    vi.useFakeTimers();
    const stop = attach();
    const { ffz, other, ours, unnamed, emote, name } = draw();

    over(ffz);
    /* The title is taken off, so the browser's own tooltip never shows. */
    expect(ffz.hasAttribute('title')).toBe(false);
    expect(hint()!.textContent).toBe('FFZ Subscriber · frankerfacez.com ↗');
    expect(hint()!.getAttribute('aria-hidden')).toBe('true');
    expect(hint()!.style.pointerEvents).toBe('none');
    expect(hint()!.style.opacity).toBe('0');
    vi.advanceTimersByTime(130);
    expect(hint()!.style.opacity).toBe('1');

    /* Straight on to the next: the hint stays up and changes. */
    out(ffz, other);
    over(other);
    expect(hint()!.style.opacity).toBe('1');
    expect(other.hasAttribute('title')).toBe(false);
    expect(hint()!.textContent).toBe('Someone Contributor');

    out(other, ours);
    over(ours);
    expect(hint()!.textContent).toBe(`FlossChat Supporter · ${document.location.hostname}/support ↗`);

    out(ours, name);
    over(name.firstElementChild!);
    expect(hint()!.style.opacity).toBe('1');
    expect(hint()!.textContent).toBe('Emerald Doppler paint · 7database.com ↗');

    /* A 7TV emote in the message: its name, 7tv.app. */
    out(name.firstElementChild!, emote);
    over(emote);
    expect(hint()!.textContent).toBe('catJam \u00b7 7tv.app \u2197');
    out(emote, name.firstElementChild!);
    over(name.firstElementChild!);
    expect(hint()!.textContent).toBe('Emerald Doppler paint \u00b7 7database.com \u2197');

    /* Moving inside the painted name keeps it. */
    out(name.firstElementChild!, name);
    expect(hint()!.style.opacity).toBe('1');
    out(name);
    expect(hint()!.style.opacity).toBe('0');

    /* Nothing to say: no hint; a quick pass does not flash one. */
    over(unnamed);
    vi.advanceTimersByTime(200);
    expect(hint()!.style.opacity).toBe('0');
    over(ffz);
    out(ffz);
    vi.advanceTimersByTime(200);
    expect(hint()!.style.opacity).toBe('0');

    /* The name still comes back after a redraw put the title back and took it off again. */
    ffz.setAttribute('title', 'FFZ Subscriber');
    over(ffz);
    expect(hint()!.textContent).toBe('FFZ Subscriber · frankerfacez.com ↗');
    out(ffz);
    over(ffz);
    expect(hint()!.textContent).toBe('FFZ Subscriber · frankerfacez.com ↗');

    stop();
    expect(hint()).toBeNull();
  });
});
