import { partsToHtml } from '@/lib/render/elementTree';
import { describe, expect, it } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import { MsgLine } from '@/lib/render/chatRows';
import { chatOverlayView } from '@/lib/chatOverlayView';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';
import { loadRestoredMultichatMessages, saveRestoredMultichatMessages } from '@/lib/multichatMessagePersistence';
import type { UnifiedMessage } from '@/lib/types';

const JILTV_PAINT = {
  id: '01M5Q3S869E87B1QV8ZEWEHJSJ',
  name: 'Molten Gold',
  texture: 'https://cdn.jiltv.app/paints/gold.webp',
  still: 'https://cdn.jiltv.app/paints/gold-0.webp',
  fallback: '#e7be6cff',
  shadows: [{ x: 0, y: 0, blur: 5, color: '#ffb30059' }],
};

const base: UnifiedMessage = {
  platform: 'twitch',
  id: 'jiltv-paint',
  senderId: '438697907',
  username: 'Jilence',
  color: '#ffffff',
  badges: [{ type: 'community:jiltv:b1', title: 'Founder', url: 'https://cdn.jiltv.app/badges/b1.webp' }],
  text: 'hello',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
  jiltvPaint: JILTV_PAINT,
};

const cfg = {
  sevenTVEmotesEnabled: true,
  sevenTVCosmeticsEnabled: true,
  showCommunityBadges: true,
  paintShadows: true,
  jiltvCosmeticsEnabled: true,
  jiltvPaintShadows: true,
};

function parse(message: UnifiedMessage, overrides: Partial<typeof cfg> = {}, cosmetics = NO_COSMETICS) {
  return buildParsedMessage(message, { ...cfg, ...overrides }, cosmetics, { enabled: false, colors: new Map() }, 1);
}

const SEVENTV_PAINTED = {
  ...NO_COSMETICS,
  paints: [{
    id: '7tv-paint',
    func: 'LINEAR_GRADIENT',
    angle: 90,
    repeat: false,
    shadows: [],
    stops: [{ color: 0xff0000ff, at: 0 }, { color: 0x0000ffff, at: 1 }],
  }],
  entitlements: { 'twitch:438697907': { paint: '7tv-paint' } },
};

/** The drawn row as HTML, as the overlay draws it. */
function row(parsed: ParsedMessage): string {
  const config = MultichatQuerySchema.parse({});
  const view = chatOverlayView(config, { sourceTagExplicit: true });
  const line = MsgLine({
    msg: parsed, sz: view.sz, emoteMaxH: view.emoteMaxH, emoteMaxW: view.emoteMaxW,
    paintEdgeShadow: view.paintEdgeShadow, hideNames: false, tagMode: view.tagMode, showAvatar: false,
    showSharedSource: false, replyStyle: config.replyStyle,
  });
  return partsToHtml([line]);
}

describe('JilTV paint and badge in the overlay', () => {
  it('paints the name with the JilTV texture and shows the JilTV badge', () => {
    const parsed = parse(base);
    expect(parsed.identity.background).toContain('https://cdn.jiltv.app/paints/gold.webp');
    expect(parsed.identity.filter).toBe('drop-shadow(0px 0px 5px #ffb30059)');
    const html = partsToHtml(parsed.identity.badges);
    expect(html).toContain('https://cdn.jiltv.app/badges/b1.webp');
  });

  it("has its own switches, apart from 7TV's", () => {
    expect(parse(base, { jiltvCosmeticsEnabled: false }).identity.background).toBe('');
    expect(parse(base, { jiltvPaintShadows: false }).identity.filter).toBe('');
    expect(parse(base, { jiltvPaintShadows: false }).identity.background).toContain('cdn.jiltv.app');
    /* 7TV's switches leave the JilTV paint alone. */
    expect(parse(base, { sevenTVCosmeticsEnabled: false }).identity.background).toContain('cdn.jiltv.app');
    expect(parse(base, { paintShadows: false }).identity.filter).toContain('drop-shadow');
    /* Old links without the JilTV switches keep paints and shadows on. */
    const { jiltvCosmeticsEnabled: _on, jiltvPaintShadows: _shadows, ...oldLink } = cfg;
    const old = buildParsedMessage(base, oldLink, NO_COSMETICS, { enabled: false, colors: new Map() }, 1);
    expect(old.identity.background).toContain('cdn.jiltv.app');
    expect(old.identity.filter).toContain('drop-shadow');
    /* With JilTV Cosmetics off, a chatter wearing both shows 7TV's even
       after asking for JilTV's. */
    const askedJilTV = { ...SEVENTV_PAINTED, paintSources: new Map([['twitch:438697907', 'jiltv' as const]]) };
    expect(parse(base, { jiltvCosmeticsEnabled: false }, askedJilTV).identity.background).toContain('linear-gradient');
    /* With 7TV Cosmetics off, the JilTV one shows. */
    expect(parse(base, { sevenTVCosmeticsEnabled: false }, SEVENTV_PAINTED).identity.background).toContain('cdn.jiltv.app');
  });

  it('keeps 7TV first when the chatter wears a 7TV paint too', () => {
    const parsed = parse(base, {}, SEVENTV_PAINTED);
    expect(parsed.identity.background).toContain('linear-gradient');
    expect(parsed.identity.background).not.toContain('jiltv');
    expect(parsed.identity.backgroundSize).toBeUndefined();
    expect(row(parsed)).toContain('background-size:cover');
    /* Without a 7TV paint the JilTV one shows, sized its own way. */
    expect(parse(base).identity.backgroundSize).toBe('100% 100%');
  });

  it('shows the JilTV paint once the chatter asked for it here, and 7TV again when they ask for that', () => {
    const askedJilTV = { ...SEVENTV_PAINTED, paintSources: new Map([['twitch:438697907', 'jiltv' as const]]) };
    const parsed = parse(base, {}, askedJilTV);
    expect(parsed.identity.background).toContain('cdn.jiltv.app');
    expect(parsed.identity.backgroundSize).toBe('100% 100%');
    const askedSevenTV = { ...SEVENTV_PAINTED, paintSources: new Map([['twitch:438697907', '7tv' as const]]) };
    expect(parse(base, {}, askedSevenTV).identity.background).not.toContain('jiltv');
    /* Asking for a paint they don't wear shows the one they do. */
    const noJilTV = { ...SEVENTV_PAINTED, paintSources: new Map([['twitch:438697907', 'jiltv' as const]]) };
    expect(parse({ ...base, jiltvPaint: undefined }, {}, noJilTV).identity.background).toContain('linear-gradient');
    /* Another chatter's choice changes nothing here. */
    const someoneElse = { ...SEVENTV_PAINTED, paintSources: new Map([['twitch:1', 'jiltv' as const]]) };
    expect(parse(base, {}, someoneElse).identity.background).not.toContain('jiltv');
  });

  it('shows no JilTV paint off Twitch or when it cannot be drawn', () => {
    const tampered = { ...base, jiltvPaint: { ...JILTV_PAINT, texture: 'https://evil.example/x.webp' } };
    for (const parsed of [parse(tampered), parse({ ...base, platform: 'kick' })]) {
      expect(parsed.identity.background).toBe('');
    }
  });

  it('draws a tiling JilTV paint repeated sideways, and a stretched one across the name', () => {
    const tiled = parse({ ...base, jiltvPaint: { ...JILTV_PAINT, tileWidth: 420 } });
    expect(row(tiled)).toContain('background-size:420px 100%');
    expect(row(tiled)).toContain('background-repeat:repeat-x');
    const stretched = row(parse(base));
    expect(stretched).toContain('background-size:100% 100%');
    expect(stretched).toContain('background-repeat:no-repeat');
  });

  it('draws a JilTV paint without a texture in its colour', () => {
    const { texture: _texture, still: _still, ...colourOnly } = JILTV_PAINT;
    const parsed = parse({ ...base, jiltvPaint: colourOnly });
    expect(parsed.identity.background).toBe('linear-gradient(#e7be6cff, #e7be6cff)');
  });

  it('ignores a tampered saved paint that points away from JilTV', () => {
    const parsed = parse({ ...base, jiltvPaint: { ...JILTV_PAINT, texture: 'https://evil.example/x.webp' } });
    expect(parsed.identity.background).toBe('');
  });

  it('keeps a tiling or colour-only JilTV paint across a reload', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); },
      removeItem: (key: string) => { items.delete(key); },
    } as unknown as Storage;
    const { texture: _texture, still: _still, ...colourOnly } = JILTV_PAINT;
    const tiled = { ...JILTV_PAINT, tileWidth: 420 };
    const saved = [
      { ...parse({ ...base, id: 'a', jiltvPaint: tiled }), timestamp: Date.now() },
      { ...parse({ ...base, id: 'b', jiltvPaint: colourOnly }), timestamp: Date.now() },
    ];
    saveRestoredMultichatMessages(storage, 'k', saved);
    expect(loadRestoredMultichatMessages(storage, 'k').map((message) => message.raw.jiltvPaint)).toEqual([tiled, colourOnly]);
  });
});
