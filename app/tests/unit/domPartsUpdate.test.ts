/*
 * Updating a drawn row (lib/render/domParts.ts mountParts().update, what the
 * overlay and the generator preview use) keeps the nodes that are
 * still wanted, the way React reconciles, instead of redrawing the row's HTML.
 * A redraw re-created every image: animated emotes and badges restarted, and a
 * badge whose art had failed showed its empty space again until it failed
 * again, moving the rest of the line every time the row updated (the twitching
 * Xslash58 line in the generator preview: his UChat badge art is a 404).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatOverlayView } from '@/lib/chatOverlayView';
import { MsgLine } from '@/lib/render/chatRows';
import { mountParts } from '@/lib/render/domParts';
import { badgeParts } from '@/lib/renderCore';
import { FAILED_IMAGE_MEMORY_MS, imageKnownToFail, resetAssetErrorLog } from '@/lib/render/imageFallback';
import type { ParsedMessage } from '@/lib/kick';
import type { MultichatConfig } from '@/lib/multichatConfig';
import type { UnifiedMessage } from '@/lib/types';
import { CONFIGS, EVENT_CONFIGS, parsedEvents, parsedFor } from '../fixtures/overlayCorpus';

/* The Hype Train card takes its animations' phase from the clock: one clock for every drawing. */
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-22T12:00:00.000Z'));
});
afterEach(() => {
  resetAssetErrorLog();
  vi.restoreAllMocks();
});

function line(msg: ParsedMessage, config: MultichatConfig) {
  const view = chatOverlayView(config, { sourceTagExplicit: true });
  return [MsgLine({
    msg,
    sz: view.sz,
    emoteMaxH: view.emoteMaxH,
    emoteMaxW: view.emoteMaxW,
    paintEdgeShadow: view.paintEdgeShadow,
    hideNames: config.hideNames ?? false,
    tagMode: view.tagMode,
    showAvatar: config.showAvatars ?? false,
    showSharedSource: view.showSharedSource,
    replyStyle: config.replyStyle,
  })];
}

function fresh(parts: ReturnType<typeof line>): HTMLDivElement {
  const target = document.createElement('div');
  mountParts(target, parts);
  return target;
}

/** Same DOM as a fresh draw (attribute order aside, as isEqualNode judges). */
function expectSameDom(target: Element, parts: ReturnType<typeof line>, label: string) {
  const expected = fresh(parts);
  if (!target.isEqualNode(expected)) expect(target.innerHTML, label).toBe(expected.innerHTML);
  expect(target.isEqualNode(expected), label).toBe(true);
}

const hasBadgeImage = (message: ParsedMessage) => message.identity.badges.some(
  (badge) => typeof badge === 'object' && badge !== null && 'tag' in badge && badge.tag === 'img',
);

describe('updating a drawn row', () => {
  const names = Object.keys(CONFIGS);

  it('ends with exactly the DOM a fresh draw makes, for every corpus row under every pair of configurations', () => {
    let compared = 0;
    for (const from of names) {
      for (const to of names) {
        if (from === to) continue;
        const a = parsedFor({ ...CONFIGS[from]!, animation: 'none' });
        const b = parsedFor({ ...CONFIGS[to]!, animation: 'none' });
        const byId = new Map(b.parsed.map((message) => [message.id, message] as const));
        for (const message of a.parsed) {
          const next = byId.get(message.id);
          if (!next) continue;
          const target = document.createElement('div');
          const mounted = mountParts(target, line(message, a.config));
          mounted.update(line(next, b.config));
          expectSameDom(target, line(next, b.config), `${message.id}: ${from} -> ${to}`);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it('also for event rows (except the stateful-slot rows, which keep their own path)', async () => {
    const a = await parsedEvents(EVENT_CONFIGS['events-default']!);
    const b = await parsedEvents(EVENT_CONFIGS['events-multi-large-hidenames']!);
    const byId = new Map(b.parsed.map((message) => [message.id, message] as const));
    let compared = 0;
    for (const message of a.parsed) {
      const next = byId.get(message.id);
      if (!next) continue;
      const target = document.createElement('div');
      const mounted = mountParts(target, line(message, a.config));
      mounted.update(line(next, b.config));
      expectSameDom(target, line(next, b.config), message.id);
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(15);
  });

  it('leaves the DOM untouched when the row is drawn the same again (a new but equal message object)', () => {
    const { config, parsed } = parsedFor({ ...CONFIGS.default!, animation: 'none' });
    for (const message of parsed) {
      const target = document.createElement('div');
      const mounted = mountParts(target, line(message, config));
      const observer = new MutationObserver(() => undefined);
      observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
      mounted.update(line({ ...message }, config));
      expect(observer.takeRecords(), message.id).toHaveLength(0);
      observer.disconnect();
    }
  });

  it('keeps the same image elements when other parts of the row change (animations do not restart)', () => {
    const { config, parsed } = parsedFor({ ...CONFIGS.default!, animation: 'none' });
    const withImages = parsed.filter(hasBadgeImage);
    expect(withImages.length).toBeGreaterThan(3);
    for (const message of withImages) {
      const target = document.createElement('div');
      const mounted = mountParts(target, line(message, config));
      const before = Array.from(target.querySelectorAll('img'));
      mounted.update(line({ ...message, identity: { ...message.identity, color: '#123456' } }, config));
      const after = Array.from(target.querySelectorAll('img'));
      expect(after.length, message.id).toBe(before.length);
      after.forEach((image, index) => expect(image, `${message.id} image ${index}`).toBe(before[index]));
    }
  });

  it('keeps a failed badge hidden through updates instead of showing its space again', () => {
    const { config, parsed } = parsedFor({ ...CONFIGS.default!, animation: 'none' });
    const message = parsed.find(hasBadgeImage)!;
    const target = document.createElement('div');
    const mounted = mountParts(target, line(message, config));
    const badge = target.querySelector<HTMLImageElement>('img.ck-badge-img')!;
    const src = badge.getAttribute('src');
    badge.dispatchEvent(new Event('error'));
    expect(badge.style.display).toBe('none');

    const shownAgain = () => Array.from(target.querySelectorAll<HTMLImageElement>('img'))
      .filter((image) => image.getAttribute('src') === src && image.style.display !== 'none');
    mounted.update(line({ ...message }, config));
    expect(target.querySelector('img.ck-badge-img')).toBe(badge);
    expect(shownAgain()).toHaveLength(0);
    mounted.update(line({ ...message, identity: { ...message.identity, color: '#abcdef' } }, config));
    expect(shownAgain()).toHaveLength(0);
  });

  it('keeps an image on its fallback art through updates', () => {
    const { config, parsed } = parsedFor({ ...CONFIGS.default!, animation: 'none' });
    const message = parsed.find(hasBadgeImage)!;
    const raw: UnifiedMessage = {
      platform: 'twitch', id: 'f', senderId: '1', username: 'u', color: '#fff', text: 'hi', emotes: [], timestamp: 0, kind: 'chat',
      badges: [{ type: 'community:test:x', url: 'https://cdn.example/animated.webp', fallbackUrl: 'https://cdn.example/still.webp', title: 'Test' }],
    };
    const withFallback = { ...message, identity: { ...message.identity, badges: badgeParts(raw, []) } } as ParsedMessage;
    const target = document.createElement('div');
    const mounted = mountParts(target, line(withFallback, config));
    const image = target.querySelector<HTMLImageElement>('img[data-fallback-src]')!;
    image.dispatchEvent(new Event('error'));
    expect(image.getAttribute('src')).toBe('https://cdn.example/still.webp');
    mounted.update(line({ ...withFallback, identity: { ...withFallback.identity, color: '#abcdef' } }, config));
    const after = target.querySelector<HTMLImageElement>('img.ck-badge-img')!;
    expect(after).toBe(image);
    expect(after.getAttribute('src')).toBe('https://cdn.example/still.webp');
  });
});

describe('badge art known to be broken', () => {
  const chat = (badges: UnifiedMessage['badges']): UnifiedMessage => ({
    platform: 'twitch', id: 'm', senderId: '1', username: 'u', color: '#fff', badges, text: 'hi', emotes: [], timestamp: 0, kind: 'chat',
  });
  const srcs = (message: UnifiedMessage) => badgeParts(message, []).map((badge) => badge.attrs?.src);

  it('is left out of rows drawn after it failed, and its still art is used when that works', () => {
    const broken = { type: 'community:uchat:contributor_0', url: 'https://cdn.unii.dev/badges/UChat/contributor_0/static/4x.webp', title: 'UChat Contributor' };
    const animated = { type: 'community:uchat:dev_uni', url: 'https://cdn.example/animated.webp', fallbackUrl: 'https://cdn.example/still.webp', title: 'Dev' };
    const good = { type: 'community:other:x', url: 'https://cdn.example/good.webp', title: 'Good' };
    expect(srcs(chat([broken, animated, good]))).toEqual([broken.url, animated.url, good.url]);

    /* Two of them fail on the page. */
    const target = document.createElement('div');
    mountParts(target, badgeParts(chat([broken, animated, good]), []));
    const images = Array.from(target.querySelectorAll('img'));
    images[0]!.dispatchEvent(new Event('error'));
    images[1]!.dispatchEvent(new Event('error'));
    expect(imageKnownToFail(broken.url)).toBe(true);
    expect(imageKnownToFail(animated.url)).toBe(true);
    expect(imageKnownToFail(animated.fallbackUrl)).toBe(false);

    expect(srcs(chat([broken, animated, good]))).toEqual([animated.fallbackUrl, good.url]);
    const still = badgeParts(chat([animated]), [])[0]!;
    expect(still.attrs?.['data-fallback-src']).toBeUndefined();

    /* The still art fails too: the badge is left out. */
    const again = document.createElement('div');
    mountParts(again, [still]);
    again.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(srcs(chat([broken, animated, good]))).toEqual([good.url]);
  });

  it('is tried again after a while (a one-off network failure is not permanent)', () => {
    const target = document.createElement('div');
    const url = 'https://cdn.example/blip.webp';
    mountParts(target, badgeParts(chat([{ type: 'community:x:y', url, title: 'Blip' }]), []));
    target.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(imageKnownToFail(url)).toBe(true);
    expect(imageKnownToFail(url, Date.now() + FAILED_IMAGE_MEMORY_MS + 1)).toBe(false);
    expect(srcs(chat([{ type: 'community:x:y', url, title: 'Blip' }]))).toEqual([url]);
  });
});
