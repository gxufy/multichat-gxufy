import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
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
};

function parse(message: UnifiedMessage, overrides: Partial<typeof cfg> = {}, cosmetics = NO_COSMETICS) {
  return buildParsedMessage(message, { ...cfg, ...overrides }, cosmetics, { enabled: false, colors: new Map() }, 1);
}

describe('JilTV paint and badge in the overlay', () => {
  it('paints the name with the JilTV texture and shows the JilTV badge', () => {
    const parsed = parse(base);
    expect(parsed.identity.background).toContain('https://cdn.jiltv.app/paints/gold.webp');
    expect(parsed.identity.filter).toBe('drop-shadow(0px 0px 5px #ffb30059)');
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, ...parsed.identity.badges));
    expect(html).toContain('https://cdn.jiltv.app/badges/b1.webp');
  });

  it('respects the paint switches', () => {
    expect(parse(base, { sevenTVCosmeticsEnabled: false }).identity.background).toBe('');
    expect(parse(base, { paintShadows: false }).identity.filter).toBe('');
  });

  it('keeps 7TV first when the chatter wears a 7TV paint too', () => {
    const cosmetics = {
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
    const parsed = parse(base, {}, cosmetics);
    expect(parsed.identity.background).toContain('linear-gradient');
    expect(parsed.identity.background).not.toContain('jiltv');
  });

  it('ignores a tampered saved paint that points away from JilTV', () => {
    const parsed = parse({ ...base, jiltvPaint: { ...JILTV_PAINT, texture: 'https://evil.example/x.webp' } });
    expect(parsed.identity.background).toBe('');
  });
});
