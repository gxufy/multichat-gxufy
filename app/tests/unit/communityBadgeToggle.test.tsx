import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MULTICHAT_GENERATOR_DEFAULT_CHANNELS,
  buildMultichatQuery,
  safeParseMultichatConfig,
} from '@/lib/multichatConfig';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
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
});
