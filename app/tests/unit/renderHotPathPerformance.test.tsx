import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import { renderBadges, renderMessageText, type MentionContext } from '@/lib/render';
import type { KickChannel, SevenTVEmote } from '@/lib/kick';
import type { UnifiedMessage } from '@/lib/types';

const message: UnifiedMessage = {
  platform: 'twitch',
  id: 'hot-path',
  senderId: 'user-1',
  username: 'user',
  color: '#ffffff',
  badges: [],
  text: 'Wave',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
};

const emote = (image: string): SevenTVEmote => ({
  name: 'Wave',
  image,
  height: 32,
  width: 32,
  zeroWidth: false,
  upscale: false,
});

class CountingColorMap extends Map<string, string> {
  writes = 0;

  override set(key: string, value: string): this {
    this.writes++;
    return super.set(key, value);
  }
}

const config = {
  sevenTVEmotesEnabled: false,
  sevenTVCosmeticsEnabled: false,
  paintShadows: true,
};

describe('render hot-path caches', () => {
  it('preserves first-match semantics when a 7TV set contains duplicate names', () => {
    const set = [emote('https://cdn.example/first.webp'), emote('https://cdn.example/second.webp')];
    const nodes = renderMessageText(message, set);
    const { container } = render(<>{nodes}</>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/first.webp');
  });

  it('keeps 7TV and mention rendering on the no-native-emote fast path', () => {
    const mentions: MentionContext = {
      enabled: true,
      colors: new Map([['other', '#12ab34']]),
    };
    const nodes = renderMessageText(
      { ...message, text: '@Other Wave', emotes: [] },
      [emote('https://cdn.example/wave.webp')],
      mentions,
    );
    const { container } = render(<>{nodes}</>);

    expect(container.querySelector('strong')?.textContent).toBe('@Other');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/wave.webp');
  });

  it('keeps YouTube badge filtering and display order stable across repeated renders', () => {
    const youtube: UnifiedMessage = {
      ...message,
      platform: 'youtube',
      badges: [
        { type: 'subscriber' },
        { type: 'owner' },
        { type: 'verified' },
        { type: 'moderator' },
      ],
    };

    for (let pass = 0; pass < 2; pass++) {
      const { container, unmount } = render(<>{renderBadges(youtube, [])}</>);
      expect([...container.querySelectorAll('img')].map((img) => img.alt)).toEqual([
        'verified',
        'moderator',
        'subscriber',
      ]);
      unmount();
    }
  });

  it('keeps Kick subscriber tier selection stable with an unsorted tier catalog', () => {
    const tiers: KickChannel['subscriber_badges'] = [
      { id: 1, months: 1, badge_image: { src: 'https://cdn.example/1.png' } },
      { id: 12, months: 12, badge_image: { src: 'https://cdn.example/12.png' } },
      { id: 6, months: 6, badge_image: { src: 'https://cdn.example/6.png' } },
    ];
    const kick: UnifiedMessage = {
      ...message,
      platform: 'kick',
      badges: [{ type: 'subscriber', count: 8, version: '8' }],
    };

    for (let pass = 0; pass < 2; pass++) {
      const { container, unmount } = render(<>{renderBadges(kick, tiers)}</>);
      expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/6.png');
      unmount();
    }
  });

  it('writes one mention-color key when upstream and display names are identical', () => {
    const colors = new CountingColorMap();
    const mentions: MentionContext = { enabled: true, colors };

    const parsed = buildParsedMessage(message, config, NO_COSMETICS, mentions, 1);

    expect(parsed.identity.color).toBe('#ffffff');
    expect(colors.writes).toBe(1);
    expect(colors.get('user')).toBe('#ffffff');
  });

  it('still records both YouTube handle and display-name aliases', () => {
    const colors = new CountingColorMap();
    const mentions: MentionContext = { enabled: true, colors };
    const youtube: UnifiedMessage = {
      ...message,
      platform: 'youtube',
      id: 'youtube-hot-path',
      senderId: 'channel-1',
      username: '@Creator',
    };

    const parsed = buildParsedMessage(youtube, config, NO_COSMETICS, mentions, 1);

    expect(parsed.identity.username).toBe('Creator');
    expect(colors.writes).toBe(2);
    expect(colors.get('@creator')).toBe('#ffffff');
    expect(colors.get('creator')).toBe('#ffffff');
  });
  it('colors mentions with trailing punctuation on the real render path', () => {
    const mentions: MentionContext = {
      enabled: true,
      colors: new Map([['other', '#12ab34']]),
    };

    for (const text of ['@Other!', '@Other?', '@Other:', '@Other,', '@Other.', '@Other;', '@Other)']) {
      const { container, unmount } = render(<>{renderMessageText({ ...message, text, emotes: [] }, [], mentions)}</>);
      expect(container.querySelector('strong')?.textContent).toBe(text);
      unmount();
    }
  });
});
