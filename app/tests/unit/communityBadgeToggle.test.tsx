import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_GENERATOR_DEFAULT_CHANNELS,
  buildMultichatQuery,
  safeParseMultichatConfig,
} from '@/lib/multichatConfig';
import {
  buildParsedMessage,
  NO_COSMETICS,
  type MessageCosmetics,
} from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

function parsedConfig(query: Record<string, string>) {
  const result = safeParseMultichatConfig(query);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('unreachable');
  return result.data;
}

const message: UnifiedMessage = {
  platform: 'twitch',
  id: 'community-toggle-test',
  senderId: '42',
  username: 'viewer',
  color: '#ffffff',
  badges: [
    { type: 'moderator', url: 'https://example.com/native-mod.png' },
    { type: 'community:chatterino:test', url: 'https://example.com/community.png' },
  ],
  text: 'hello',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
};

function badgeMarkup(showCommunityBadges: boolean): string {
  const mentions = { enabled: false, colors: new Map<string, string>() };
  const parsed = buildParsedMessage(
    message,
    {
      sevenTVEmotesEnabled: true,
      sevenTVCosmeticsEnabled: true,
      showCommunityBadges,
      paintShadows: true,
    },
    NO_COSMETICS,
    mentions,
    1,
  );
  return renderToStaticMarkup(
    React.createElement(React.Fragment, null, ...parsed.identity.badges),
  );
}

describe('community badge visibility', () => {
  it('defaults on for old URLs and generator state', () => {
    expect(parsedConfig({ kick: 'channel' }).showCommunityBadges).toBe(true);
    expect(MULTICHAT_GENERATOR_DEFAULTS.showCommunityBadges).toBe(true);
  });

  it('serializes only the off state', () => {
    const on = buildMultichatQuery(
      { ...MULTICHAT_GENERATOR_DEFAULT_CHANNELS, twitch: 'channel' },
      MULTICHAT_GENERATOR_DEFAULTS,
    );
    const off = buildMultichatQuery(
      { ...MULTICHAT_GENERATOR_DEFAULT_CHANNELS, twitch: 'channel' },
      { ...MULTICHAT_GENERATOR_DEFAULTS, showCommunityBadges: false },
    );

    expect(on).not.toContain('showCommunityBadges=');
    expect(off).toContain('showCommunityBadges=false');
    expect(parsedConfig({ twitch: 'channel', showCommunityBadges: 'false' }).showCommunityBadges)
      .toBe(false);
  });

  it('hides only community badges when off', () => {
    const on = badgeMarkup(true);
    const off = badgeMarkup(false);

    expect(on).toContain('native-mod.png');
    expect(on).toContain('community.png');
    expect(off).toContain('native-mod.png');
    expect(off).not.toContain('community.png');
  });

  it('does not render a catalogued 7TV badge without a matching user entitlement', () => {
    const cosmetics: MessageCosmetics = {
      ...NO_COSMETICS,
      badges: [
        { id: 'purple-star', image: 'https://cdn.7tv.app/purple-star.png' },
        { id: 'blue-shield', image: 'https://cdn.7tv.app/blue-shield.png' },
      ],
      entitlements: {
        'twitch:42': { badge: 'purple-star' },
        'twitch:99': { badge: 'blue-shield' },
      },
    };
    const parse = (senderId: string) => buildParsedMessage(
      { ...message, id: `message-${senderId}`, senderId, badges: [] },
      {
        sevenTVEmotesEnabled: true,
        sevenTVCosmeticsEnabled: true,
        showCommunityBadges: true,
        paintShadows: true,
      },
      cosmetics,
      { enabled: false, colors: new Map<string, string>() },
      1,
    );
    const markup = (senderId: string) => renderToStaticMarkup(
      React.createElement(React.Fragment, null, ...parse(senderId).identity.badges),
    );

    expect(markup('42')).toContain('purple-star.png');
    expect(markup('42')).not.toContain('blue-shield.png');
    expect(markup('99')).toContain('blue-shield.png');
    expect(markup('99')).not.toContain('purple-star.png');
    expect(markup('777')).toBe('');
  });
});
