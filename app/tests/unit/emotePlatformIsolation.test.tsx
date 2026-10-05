import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { buildParsedMessage, type MessageCosmetics } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import type { UnifiedMessage } from '@/lib/types';

const emote = (name: string, image: string) => ({
  name, image, height: 28, width: 28, zeroWidth: false, upscale: false,
});

const cosmetics: MessageCosmetics = {
  emotes: {
    kick: [emote('COLLIDE', 'https://cdn.example/kick.webp')],
    twitch: [emote('COLLIDE', 'https://cdn.example/twitch.webp')],
  },
  badges: [], paints: [], entitlements: {}, channel: null,
};

const message = (platform: 'kick' | 'twitch'): UnifiedMessage => ({
  platform,
  id: platform,
  senderId: platform,
  username: platform,
  color: '#ffffff',
  badges: [],
  text: 'COLLIDE',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
});

describe('platform-scoped third-party emotes', () => {
  it.each(['kick', 'twitch'] as const)('uses only the %s catalog', (platform) => {
    const config = MultichatQuerySchema.parse({ [platform]: 'channel' });
    const parsed = buildParsedMessage(
      message(platform), config, cosmetics,
      { enabled: false, colors: new Map() }, 1,
    );
    const { container } = render(<>{parsed.message}</>);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`https://cdn.example/${platform}.webp`);
  });

  it('keeps a Twitch native emote ahead of the third-party collision', () => {
    const raw = message('twitch');
    raw.emotes = [{ begin: 0, end: 7, text: 'COLLIDE', url: 'https://cdn.example/native.webp' }];
    const config = MultichatQuerySchema.parse({ twitch: 'channel' });
    const parsed = buildParsedMessage(raw, config, cosmetics, { enabled: false, colors: new Map() }, 1);
    const { container } = render(<>{parsed.message}</>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/native.webp');
  });
});
