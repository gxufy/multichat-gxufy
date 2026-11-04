import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  applySevenTVEmoteSetUpdate,
  mapSevenTVEmote,
  SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL,
  SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_SUBSCRIBER,
  type SevenTVEmote,
} from '@/lib/kick';
import { renderMessageText } from '@/lib/render';
import type { UnifiedMessage } from '@/lib/types';

function activeEmote(name: string, flags: number) {
  return {
    id: '01TESTBANGER000000000000000',
    name,
    flags,
    data: {
      flags: 0,
      host: {
        files: [
          {},
          { width: 32, height: 32 },
        ],
      },
    },
  };
}

function nativeMessage(platform: UnifiedMessage['platform'] = 'twitch'): UnifiedMessage {
  return {
    platform,
    id: 'banger-collision',
    senderId: '672238954',
    username: 'viewer',
    color: '#ffffff',
    badges: [],
    text: 'BANGER',
    emotes: [{
      begin: 0,
      end: 6,
      text: 'BANGER',
      url: 'https://cdn.example/native-twitch-banger.webp',
    }],
    timestamp: 1,
    kind: 'chat',
  };
}

function sevenTV(flags: number): SevenTVEmote {
  return {
    name: 'BANGER',
    image: 'https://cdn.example/seventv-banger.webp',
    height: 32,
    width: 32,
    zeroWidth: false,
    upscale: false,
    activeFlags: flags,
  };
}

describe('7TV active-emote Twitch collision overrides', () => {
  it('preserves active-set override flags during initial mapping', () => {
    const mapped = mapSevenTVEmote(activeEmote(
      'BANGER',
      SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL,
    ));

    expect(mapped.activeFlags).toBe(
      SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL,
    );
  });

  it('preserves active-set override flags through live pushed and updated set events', () => {
    const pushed = applySevenTVEmoteSetUpdate([], {
      pushed: [{
        value: activeEmote(
          'BANGER',
          SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL,
        ),
      }],
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.activeFlags).toBe(
      SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL,
    );

    const updated = applySevenTVEmoteSetUpdate(pushed, {
      updated: [{
        old_value: { name: 'BANGER' },
        value: activeEmote(
          'BANGER',
          SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_SUBSCRIBER,
        ),
      }],
    });

    expect(updated[0]?.activeFlags).toBe(
      SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_SUBSCRIBER,
    );
  });

  it('keeps the Twitch-native image when the matching 7TV slot has no override flag', () => {
    const { container } = render(
      <>{renderMessageText(nativeMessage(), [sevenTV(0)])}</>,
    );

    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(
      'https://cdn.example/native-twitch-banger.webp',
    );
    expect(image.classList).toContain('ck-native-twitch');
    expect(image.classList).not.toContain('ck-7tv-twitch-override');
  });

  it.each([
    SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL,
    SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_SUBSCRIBER,
    SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL | 1,
  ])('uses the matching 7TV image when active flags request a Twitch override (%s)', (flags) => {
    const { container } = render(
      <>{renderMessageText(nativeMessage(), [sevenTV(flags)])}</>,
    );

    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(
      'https://cdn.example/seventv-banger.webp',
    );
    expect(image.getAttribute('alt')).toBe('BANGER');
    expect(image.classList).toContain('ck-7tv-twitch-override');
    expect(image.classList).not.toContain('ck-native-twitch');
  });

  it('does not apply Twitch-specific override flags to another platform', () => {
    const { container } = render(
      <>{renderMessageText(
        nativeMessage('kick'),
        [sevenTV(SEVENTV_ACTIVE_EMOTE_FLAG_OVERRIDE_TWITCH_GLOBAL)],
      )}</>,
    );

    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(
      'https://cdn.example/native-twitch-banger.webp',
    );
    expect(image.classList).toContain('ck-native-kick');
  });
});
