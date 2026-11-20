/* "Hide all badges": usernames only, on every platform, with paints kept. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_GENERATOR_DEFAULT_CHANNELS,
  buildMultichatQuery,
  safeParseMultichatConfig,
} from '@/lib/multichatConfig';
import { buildParsedMessage, NO_COSMETICS, type MessageCosmetics } from '@/lib/multichatMessageModel';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';
import type { UnifiedMessage } from '@/lib/types';

const cfg = {
  sevenTVEmotesEnabled: true,
  sevenTVCosmeticsEnabled: true,
  showCommunityBadges: true,
  paintShadows: true,
};

/* Every kind of badge a line can carry: native, community, FlossChat, JilTV,
   plus a 7TV badge and a 7TV paint from cosmetics. */
const cosmetics: MessageCosmetics = {
  ...NO_COSMETICS,
  badges: [{ id: 'star', image: 'https://cdn.7tv.app/star.png' }],
  paints: [{
    id: 'paint', func: 'LINEAR_GRADIENT', angle: 90, repeat: false, shadows: [],
    stops: [{ color: 0xff0000ff, at: 0 }, { color: 0x0000ffff, at: 1 }],
  }],
  entitlements: { 'twitch:42': { badge: 'star', paint: 'paint' } },
};

function line(platform: UnifiedMessage['platform']): UnifiedMessage {
  return {
    platform,
    id: `hide-badges-${platform}`,
    senderId: '42',
    username: 'Viewer',
    color: '#ff8800',
    badges: [
      { type: 'broadcaster', url: 'https://example.com/broadcaster.png' },
      { type: 'moderator', url: 'https://example.com/moderator.png' },
      { type: 'subscriber', url: 'https://example.com/sub.png' },
      { type: 'community:chatterino:x', url: 'https://example.com/chatterino.png' },
      { type: 'community:ffz:y', url: 'https://example.com/ffz.png' },
      { type: 'community:gxufy:supporter', url: '/badges/gxufy/supporter/1x.webp' },
      { type: 'community:jiltv:b1', url: 'https://cdn.jiltv.app/badges/b1.webp' },
    ],
    text: 'hello',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

const parse = (message: UnifiedMessage, hideBadges?: boolean) => buildParsedMessage(
  message,
  hideBadges === undefined ? cfg : { ...cfg, hideBadges },
  cosmetics,
  { enabled: false, colors: new Map<string, string>() },
  1,
);
const markup = (nodes: React.ReactNode[]) => renderToStaticMarkup(React.createElement(React.Fragment, null, ...nodes));

describe('hide all badges', () => {
  it('is off by default and stays out of the URL unless switched on', () => {
    const channels = { ...MULTICHAT_GENERATOR_DEFAULT_CHANNELS, twitch: 'channel' };
    expect(MULTICHAT_GENERATOR_DEFAULTS.hideBadges).toBe(false);
    const off = buildMultichatQuery(channels, MULTICHAT_GENERATOR_DEFAULTS);
    expect(off).not.toContain('hideBadges');
    const on = buildMultichatQuery(channels, { ...MULTICHAT_GENERATOR_DEFAULTS, hideBadges: true });
    expect(on).toContain('hideBadges=true');

    const read = (query: Record<string, string>) => {
      const result = safeParseMultichatConfig(query);
      if (!result.success) throw new Error('did not parse');
      return result.data.hideBadges;
    };
    expect(read({ twitch: 'channel' })).toBe(false);
    expect(read({ twitch: 'channel', hideBadges: 'true' })).toBe(true);
    expect(read({ twitch: 'channel', hideBadges: 'false' })).toBe(false);
    expect(read({ twitch: 'channel', hideBadges: 'yes' })).toBe(false);
  });

  it('is offered in the generator settings next to the other badge switches', () => {
    const setting = MULTICHAT_CATALOG.find((s) => s.key === 'hideBadges');
    expect(setting).toMatchObject({ param: 'hideBadges', type: 'toggle', label: 'Hide all badges', default: false });
  });

  it('keeps every badge while off (old links unchanged)', () => {
    const html = markup(parse(line('twitch')).identity.badges);
    for (const src of ['broadcaster.png', 'moderator.png', 'sub.png', 'chatterino.png', 'ffz.png', 'supporter/1x.webp', 'b1.webp', 'star.png']) {
      expect(html, src).toContain(src);
    }
    expect(markup(parse(line('twitch'), false).identity.badges)).toBe(html);
  });

  it('drops every badge on every platform, but keeps the name, its colour and the 7TV paint', () => {
    for (const platform of ['twitch', 'kick', 'youtube', 'tiktok'] as const) {
      const parsed = parse(line(platform), true);
      expect(parsed.identity.badges, platform).toEqual([]);
      expect(parsed.identity.username).toBe('Viewer');
      expect(parsed.identity.color).toBe('#ff8800');
    }
    /* Paints are part of the name, not a badge. */
    expect(parse(line('twitch'), true).identity.background).toContain('linear-gradient');
  });
});
