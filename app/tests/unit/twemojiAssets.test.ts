import { afterEach, describe, expect, it } from 'vitest';
import { messageTextParts } from '@/lib/renderCore';
import { TWEMOJI_14_ASSET_BASE, TWEMOJI_17_ASSET_BASE, twemojiSvgUrl } from '@/lib/twemojiAssets';
import { clearDrawn, drawParts } from '../fixtures/drawParts';
import type { UnifiedMessage } from '@/lib/types';

afterEach(clearDrawn);

function chat(text: string): UnifiedMessage {
  return {
    platform: 'twitch',
    id: 'emoji-test',
    senderId: 'user-1',
    username: 'user',
    color: '#ffffff',
    badges: [],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function emojiImages(text: string) {
  const { container } = drawParts(messageTextParts(chat(text), []));
  return [...container.querySelectorAll<HTMLImageElement>('img.ck-twemoji')].map((img) => ({
    alt: img.getAttribute('alt'),
    src: img.getAttribute('src'),
  }));
}

describe('emoji art', () => {
  it('keeps the art emoji already had, including the ones the newer Twemoji redrew', () => {
    /* 😀, and 🥺 / 🤡 / 👨‍👩‍👧, which Twemoji 17 redrew. */
    for (const icon of ['1f600', '1f97a', '1f921', '1f468-200d-1f469-200d-1f467']) {
      expect(twemojiSvgUrl(icon)).toBe(`${TWEMOJI_14_ASSET_BASE}svg/${icon}.svg`);
    }
  });

  it('draws emoji added since Twemoji 14 from the newer art', () => {
    /* 🫨 shaking face, 🩷 pink heart, 🐦‍🔥 phoenix. */
    for (const icon of ['1fae8', '1fa77', '1f426-200d-1f525']) {
      expect(twemojiSvgUrl(icon)).toBe(`${TWEMOJI_17_ASSET_BASE}svg/${icon}.svg`);
    }
  });

  it('turns newer emoji in chat into images instead of leaving them as text', () => {
    expect(emojiImages('hi 🫨 🩷 🐦‍🔥 😀 🥺')).toEqual([
      { alt: '🫨', src: `${TWEMOJI_17_ASSET_BASE}svg/1fae8.svg` },
      { alt: '🩷', src: `${TWEMOJI_17_ASSET_BASE}svg/1fa77.svg` },
      { alt: '🐦‍🔥', src: `${TWEMOJI_17_ASSET_BASE}svg/1f426-200d-1f525.svg` },
      { alt: '😀', src: `${TWEMOJI_14_ASSET_BASE}svg/1f600.svg` },
      { alt: '🥺', src: `${TWEMOJI_14_ASSET_BASE}svg/1f97a.svg` },
    ]);
  });
});
