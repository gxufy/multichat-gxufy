import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ChatOverlay from '@/components/overlay/ChatOverlay';
import { SAMPLE_COSMETICS } from '@/features/multichat/samples';
import {
  buildParsedMessage,
  NO_COSMETICS,
} from '@/lib/multichatMessageModel';
import {
  loadRestoredMultichatMessages,
  saveRestoredMultichatMessages,
} from '@/lib/multichatMessagePersistence';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { fallbackColor, readableColor } from '@/lib/render';
import type { UnifiedMessage } from '@/lib/types';

const config = MultichatQuerySchema.parse({
  twitch: 'gxufy',
  animation: 'none',
  entryAnimation: 'none',
});

function message(
  id: string,
  username: string,
  color: string,
  text = 'ordinary message body',
  senderId = `sender-${id}`,
): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId,
    senderUsername: username.toLowerCase(),
    username,
    color,
    badges: [],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function cssRgb(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected a six-digit color, received ${hex}`);
  return `rgb(${Number.parseInt(match[1], 16)}, ${Number.parseInt(match[2], 16)}, ${Number.parseInt(match[3], 16)})`;
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('ordinary username and message colors', () => {
  it('preserves already-readable provider colors byte-for-byte', () => {
    expect(readableColor('#1E90FF')).toBe('#1E90FF');
    expect(readableColor('#FF69B4')).toBe('#FF69B4');
    expect(readableColor('00FF7F')).toBe('#00FF7F');
  });

  it('lifts only unreadably dark colors while retaining their hue identity', () => {
    const mentions = { enabled: true, colors: new Map<string, string>() };

    const blue = buildParsedMessage(
      message('blue', 'BlueUser', '#000080'),
      config,
      NO_COSMETICS,
      mentions,
      1,
    );
    const black = buildParsedMessage(
      message('black', 'BlackUser', '#000000'),
      config,
      NO_COSMETICS,
      mentions,
      2,
    );

    expect(blue.identity.color).not.toBe('#000080');
    expect(black.identity.color).not.toBe('#000000');
    expect(mentions.colors.get('blueuser')).toBe(blue.identity.color);

    const [, red, green, blueChannel] = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
      .exec(blue.identity.color) ?? [];
    expect(red).toBe(green);
    expect(Number.parseInt(blueChannel, 16)).toBeGreaterThan(Number.parseInt(red, 16));

    const blackMatch = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
      .exec(black.identity.color);
    expect(blackMatch?.[1]).toBe(blackMatch?.[2]);
    expect(blackMatch?.[2]).toBe(blackMatch?.[3]);
    expect(Number.parseInt(blackMatch?.[1] ?? '00', 16)).toBeGreaterThan(96);
  });

  it('preserves valid Twitch colors instead of selecting an id fallback', () => {
    const red = buildParsedMessage(
      message('juggparis', 'juggparis', '#FF0000', 'red', '1310848144'),
      config,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );
    const goldenrod = buildParsedMessage(
      message('zindarianx', 'zindarianx', '#DAA520', 'gold', '1367443756'),
      config,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      2,
    );

    expect(red.identity.color).toBe('#FF0000');
    expect(goldenrod.identity.color).toBe('#DAA520');
  });

  it('uses the Twitch user-id fallback for spider8moth', () => {
    const selected = fallbackColor('twitch', 'spider8moth', '1534242046');
    const parsed = buildParsedMessage(
      message('spider8moth', 'spider8moth', '', 'no provider color', '1534242046'),
      config,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );

    expect(selected).toBe('#0000FF');
    expect(parsed.identity.color).toBe(readableColor('#0000FF'));
    expect(parsed.identity.color).not.toBe('#0000FF');
  });

  it('uses integer-safe Twitch id modulo independently of username casing', () => {
    expect(fallbackColor('twitch', 'spider8moth', '1534242046')).toBe('#0000FF');
    expect(fallbackColor('twitch', 'SPIDER8MOTH', '1534242046')).toBe('#0000FF');
    expect(fallbackColor('twitch', 'AnyName', '9007199254740993')).toBe('#B22222');
  });

  it('falls back safely to the historical username rule for unusable Twitch ids', () => {
    const expected = fallbackColor('twitch', 'FallbackUser');
    expect(fallbackColor('twitch', 'FallbackUser', '')).toBe(expected);
    expect(fallbackColor('twitch', 'FallbackUser', 'not-a-number')).toBe(expected);
    expect(fallbackColor('twitch', 'FallbackUser', '-1')).toBe(expected);
  });

  it('falls back deterministically when the provider color is missing or malformed', () => {
    for (const [id, color] of [['missing', ''], ['malformed', 'not-a-color']] as const) {
      const raw = message(id, 'FallbackUser', color, 'ordinary message body', '1534242046');
      const parsed = buildParsedMessage(
        raw,
        config,
        NO_COSMETICS,
        { enabled: true, colors: new Map() },
        1,
      );

      expect(parsed.identity.color).toBe(readableColor(
        fallbackColor(raw.platform, raw.username, raw.senderId),
      ));
    }
  });

  it('retains the Twitch user id and fallback color across persistence restoration', () => {
    const raw = message(
      'stored-spider8moth',
      'spider8moth',
      '',
      'persisted no-color message',
      '1534242046',
    );
    const parsed = buildParsedMessage(
      raw,
      config,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );
    const key = 'test:twitch-color-restore';

    saveRestoredMultichatMessages(window.sessionStorage, key, [parsed]);
    const [restored] = loadRestoredMultichatMessages(window.sessionStorage, key);
    const rebuilt = buildParsedMessage(
      restored.raw,
      config,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      2,
    );

    expect(restored.raw.senderId).toBe('1534242046');
    expect(rebuilt.identity.color).toBe(readableColor('#0000FF'));
  });

  it('leaves non-Twitch fallback selection unchanged', () => {
    expect(fallbackColor('kick', 'FallbackUser', 'stable-id')).toBe('#ffffff');
    expect(fallbackColor('youtube', 'FallbackUser', 'stable-id')).toBe('#ffd23f');
    expect(fallbackColor('tiktok', 'FallbackUser', 'stable-id')).toBe('#ffd23f');
  });

  it('keeps mention coloring tied to the normalized source color', () => {
    const mentions = { enabled: true, colors: new Map<string, string>() };
    const source = buildParsedMessage(
      message('source', 'DarkUser', '#000080'),
      config,
      NO_COSMETICS,
      mentions,
      1,
    );
    const reply = buildParsedMessage(
      message('mention', 'OtherUser', '#FF69B4', '@DarkUser hello'),
      config,
      NO_COSMETICS,
      mentions,
      2,
    );

    const { container } = render(<>{reply.message}</>);
    const mention = container.querySelector('strong') as HTMLElement;
    expect(mention.textContent).toBe('@DarkUser');
    expect(mention.style.color).toBe(cssRgb(source.identity.color));
  });

  it('uses configured fontColor for the ordinary body without tinting it from the name', () => {
    const styledConfig = MultichatQuerySchema.parse({
      twitch: 'gxufy',
      animation: 'none',
      entryAnimation: 'none',
      fontColor: '123456',
    });
    const parsed = buildParsedMessage(
      message('font', 'RedUser', '#FF0000'),
      styledConfig,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );
    const { container } = render(
      <ChatOverlay
        config={styledConfig}
        messages={[parsed]}
        fadingIds={new Set()}
        showLoader={false}
      />,
    );

    expect((container.querySelector('.ck-name') as HTMLElement).style.color)
      .toBe('rgb(255, 0, 0)');
    expect((container.querySelector('#chat_container') as HTMLElement).style.color)
      .toBe('rgb(18, 52, 86)');
    const bodyForeground = container.querySelector(
      '.ck-body .gx-reference-glyph-foreground',
    ) as HTMLElement;
    const nameForeground = container.querySelector(
      '.ck-name .gx-reference-glyph-foreground',
    ) as HTMLElement;

    expect(bodyForeground.textContent)
      .toBe('ordinary');
    expect(nameForeground.textContent).toBe('RedUser:');
    expect(bodyForeground.closest('.ck-body')).not.toBeNull();
    expect(nameForeground.closest('.ck-name')).not.toBeNull();
    expect(bodyForeground.style.opacity).toBe('');
    expect(nameForeground.style.opacity).toBe('');
  });

  it('leaves the 7TV paint and paint-shadow path unchanged', () => {
    const paintConfig = MultichatQuerySchema.parse({
      twitch: 'gxufy',
      animation: 'none',
      entryAnimation: 'none',
      sevenTVCosmeticsEnabled: 'true',
    });
    const parsed = buildParsedMessage(
      {
        ...message('paint', 'PaintedUser', '#000000'),
        senderId: 'sample-paint-sender',
      },
      paintConfig,
      SAMPLE_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );

    expect(parsed.identity.background).toContain('linear-gradient');
    expect(parsed.identity.filter).toContain('drop-shadow');

    const { container } = render(
      <ChatOverlay
        config={paintConfig}
        messages={[parsed]}
        fadingIds={new Set()}
        showLoader={false}
      />,
    );
    const paintedName = container.querySelector('.ck-name-paint') as HTMLElement;
    expect(paintedName).not.toBeNull();
    expect(paintedName.querySelector('.gx-reference-glyph')).toBeNull();
    expect(paintedName.style.filter).toBe('');

    const paintedForeground =
      paintedName.querySelector('.gx-paint-foreground') as HTMLElement;

    expect(paintedForeground).not.toBeNull();
    expect(paintedForeground.style.filter).toContain('drop-shadow');
    expect(paintedName.querySelector('.gx-paint-edge')).not.toBeNull();
  });
});
