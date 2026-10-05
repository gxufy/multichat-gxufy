import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

const message: UnifiedMessage = {
  platform: 'twitch',
  id: 'badge-layout-renderer',
  senderId: '42',
  username: 'viewer',
  color: '#ffffff',
  badges: [
    { type: 'moderator', url: 'https://example.com/native.png' },
    { type: 'community:uchat:test', url: 'https://example.com/uchat.png' },
    { type: 'community:bttv:test', url: 'https://example.com/bttv.png' },
    { type: 'community:ffz:test', url: 'https://example.com/ffz.png' },
  ],
  text: 'hello',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
};

function markup(badgeLayout?: string): string {
  const parsed = buildParsedMessage(
    message,
    {
      sevenTVEmotesEnabled: true,
      sevenTVCosmeticsEnabled: true,
      showCommunityBadges: true,
      paintShadows: true,
      ...(badgeLayout === undefined ? {} : { badgeLayout }),
    },
    NO_COSMETICS,
    { enabled: false, colors: new Map<string, string>() },
    1,
  );
  return renderToStaticMarkup(
    React.createElement(React.Fragment, null, ...parsed.identity.badges),
  );
}

describe('badge layout renderer', () => {
  it('preserves the historical default provider order when badgeLayout is omitted', () => {
    const html = markup();
    expect(html.indexOf('native.png')).toBeLessThan(html.indexOf('uchat.png'));
    expect(html.indexOf('uchat.png')).toBeLessThan(html.indexOf('ffz.png'));
    expect(html.indexOf('ffz.png')).toBeLessThan(html.indexOf('bttv.png'));
  });

  it('reorders providers and removes hidden providers in the production renderer', () => {
    const html = markup('bttv,!ffz,platform,uchat');
    expect(html).not.toContain('ffz.png');
    expect(html.indexOf('bttv.png')).toBeLessThan(html.indexOf('native.png'));
    expect(html.indexOf('native.png')).toBeLessThan(html.indexOf('uchat.png'));
  });
});
