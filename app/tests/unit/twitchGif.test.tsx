import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { parseTwitchGifTag } from '@/lib/twitchGif';
import {
  DEFAULT_TWITCH_GIF_SIZE_PX,
  MAX_TWITCH_GIF_SIZE_PX,
  MIN_TWITCH_GIF_SIZE_PX,
  normalizeTwitchGifSize,
} from '@/lib/twitchGifConfig';
import type { UnifiedMessage } from '@/lib/types';

function twitchMessage(overrides: Partial<UnifiedMessage> = {}): UnifiedMessage {
  return {
    platform: 'twitch',
    id: 'gif-1',
    senderId: '42',
    username: 'viewer',
    color: '#ffffff',
    badges: [],
    text: 'fallback message',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
    gifUrl: 'https://cdn.example.test/native.gif',
    ...overrides,
  };
}

function build(message: UnifiedMessage, query: Record<string, string>) {
  const cfg = MultichatQuerySchema.parse(query);
  return buildParsedMessage(
    message,
    cfg,
    NO_COSMETICS,
    { enabled: false, colors: new Map() },
    1,
  );
}

describe('Twitch GIF tag handling', () => {
  it('extracts only an HTTPS asset URL from Twitch GIF metadata', () => {
    expect(parseTwitchGifTag('1:https://cdn.example.test/a.gif')).toBe(
      'https://cdn.example.test/a.gif',
    );
    expect(parseTwitchGifTag('metadata https://cdn.example.test/a.webp')).toBe(
      'https://cdn.example.test/a.webp',
    );
    expect(parseTwitchGifTag('1:http://cdn.example.test/a.gif')).toBeUndefined();
    expect(parseTwitchGifTag('not-a-url')).toBeUndefined();
  });

  it('bounds the independent GIF size and defaults to 100px', () => {
    expect(normalizeTwitchGifSize(undefined)).toBe(DEFAULT_TWITCH_GIF_SIZE_PX);
    expect(normalizeTwitchGifSize('180.4')).toBe(180);
    expect(normalizeTwitchGifSize('1')).toBe(MIN_TWITCH_GIF_SIZE_PX);
    expect(normalizeTwitchGifSize('9999')).toBe(MAX_TWITCH_GIF_SIZE_PX);
  });

  it('keeps fallback text while GIFs are disabled', () => {
    const parsed = build(twitchMessage(), { gifs: 'false' });
    const view = render(<div>{parsed.message}</div>);
    expect(view.queryByRole('img', { name: 'GIF' })).toBeNull();
    expect(view.container.textContent).toContain('fallback message');
  });

  it('replaces the Twitch body with the native GIF at the selected size', () => {
    const parsed = build(twitchMessage(), { gifs: 'true', gifSize: '180' });
    const view = render(<div>{parsed.message}</div>);
    const image = view.getByRole('img', { name: 'GIF' }) as HTMLImageElement;
    expect(image.src).toBe('https://cdn.example.test/native.gif');
    expect(image.style.maxHeight).toBe('180px');
    expect(view.container.textContent).not.toContain('fallback message');
  });

  it('never substitutes GIF metadata on non-Twitch messages', () => {
    const parsed = build(
      twitchMessage({ platform: 'kick', gifUrl: 'https://cdn.example.test/native.gif' }),
      { gifs: 'true', gifSize: '180' },
    );
    const view = render(<div>{parsed.message}</div>);
    expect(view.queryByRole('img', { name: 'GIF' })).toBeNull();
    expect(view.container.textContent).toContain('fallback message');
  });
});
