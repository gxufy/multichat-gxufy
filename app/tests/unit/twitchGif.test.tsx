import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { parseTwitchGifTag } from '@/lib/twitchGif';
import {
  loadRestoredMultichatMessages,
  saveRestoredMultichatMessages,
} from '@/lib/multichatMessagePersistence';
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
    text: 'before X after',
    emotes: [],
    timestamp: 1,
    kind: 'chat',
    twitchGifs: [{
      start: 7,
      end: 8,
      id: 'native-1',
      url: 'https://cdn.example.com/native.gif',
    }],
    ...overrides,
  };
}

function build(message: UnifiedMessage, query: Record<string, string> = {}) {
  return buildParsedMessage(
    message,
    MultichatQuerySchema.parse(query),
    NO_COSMETICS,
    { enabled: false, colors: new Map() },
    1,
  );
}

describe('Twitch GIF tag handling', () => {
  it('parses inclusive code-point ranges into sorted, exclusive structured entries', () => {
    expect(parseTwitchGifTag(
      '6-6|second|https://cdn.example.com/b.gif,2-2|first|https://cdn.example.com/a.gif',
      'A X B Y C',
    )).toEqual([
      { start: 2, end: 3, id: 'first', url: 'https://cdn.example.com/a.gif' },
      { start: 6, end: 7, id: 'second', url: 'https://cdn.example.com/b.gif' },
    ]);
  });

  it('keeps valid entries while rejecting malformed, HTTP, out-of-range, and overlapping entries', () => {
    expect(parseTwitchGifTag([
      'bad-entry',
      '0-0|http|http://cdn.example.com/a.gif',
      '99-100|far|https://cdn.example.com/far.gif',
      '2-3|kept|https://cdn.example.com/kept.gif',
      '3-4|overlap|https://cdn.example.com/overlap.gif',
      '6-6|also-kept|https://cdn.example.com/also.gif',
    ].join(','), 'A X B Y C')).toEqual([
      { start: 2, end: 4, id: 'kept', url: 'https://cdn.example.com/kept.gif' },
      { start: 6, end: 7, id: 'also-kept', url: 'https://cdn.example.com/also.gif' },
    ]);
  });

  it('treats offsets as Unicode code points rather than UTF-16 code units', () => {
    expect(parseTwitchGifTag(
      '1-1|emoji|https://cdn.example.com/emoji.gif',
      'A😀B',
    )).toEqual([
      { start: 1, end: 2, id: 'emoji', url: 'https://cdn.example.com/emoji.gif' },
    ]);
  });

  it('bounds the independent GIF size and defaults to 100px', () => {
    expect(normalizeTwitchGifSize(undefined)).toBe(DEFAULT_TWITCH_GIF_SIZE_PX);
    expect(normalizeTwitchGifSize('180.4')).toBe(180);
    expect(normalizeTwitchGifSize('1')).toBe(MIN_TWITCH_GIF_SIZE_PX);
    expect(normalizeTwitchGifSize('9999')).toBe(MAX_TWITCH_GIF_SIZE_PX);
  });

  it('renders one GIF in place while preserving surrounding text even with gifs=false', () => {
    const parsed = build(twitchMessage(), { gifs: 'false', gifSize: '180' });
    const view = render(<div>{parsed.message}</div>);
    const image = view.getByRole('img', { name: 'GIF' }) as HTMLImageElement;
    expect(image.src).toBe('https://cdn.example.com/native.gif');
    expect(image.style.maxHeight).toBe('180px');
    expect(view.container.textContent).toBe('before  after');
  });

  it('renders multiple GIFs and preserves text between them', () => {
    const parsed = build(twitchMessage({
      text: 'A X B Y C',
      twitchGifs: [
        { start: 2, end: 3, id: 'one', url: 'https://cdn.example.com/one.gif' },
        { start: 6, end: 7, id: 'two', url: 'https://cdn.example.com/two.gif' },
      ],
    }));
    const view = render(<div>{parsed.message}</div>);
    expect(view.getAllByRole('img', { name: 'GIF' })).toHaveLength(2);
    expect(view.container.textContent).toBe('A  B  C');
  });

  it('renders Unicode ranges and keeps native and community emotes around a GIF', () => {
    const unicode = render(<div>{build(twitchMessage({
      text: 'A😀B',
      twitchGifs: [{ start: 1, end: 2, id: 'emoji', url: 'https://cdn.example.com/emoji.gif' }],
    })).message}</div>);
    expect(unicode.container.textContent).toBe('AB');
    unicode.unmount();

    const source = twitchMessage({
      text: 'Kappa X OMEGALUL',
      emotes: [{ begin: 0, end: 5, text: 'Kappa', url: 'https://cdn.example.com/kappa.png' }],
      twitchGifs: [{ start: 6, end: 7, id: 'middle', url: 'https://cdn.example.com/middle.gif' }],
    });
    const parsed = buildParsedMessage(
      source,
      MultichatQuerySchema.parse({}),
      {
        ...NO_COSMETICS,
        emotes: {
          twitch: [{
            name: 'OMEGALUL',
            image: 'https://cdn.example.com/omegalul.webp',
            height: 32,
            width: 32,
            zeroWidth: false,
            upscale: false,
          }],
        },
      },
      { enabled: false, colors: new Map() },
      1,
    );
    const view = render(<div>{parsed.message}</div>);
    expect(view.getByRole('img', { name: 'Kappa' })).toBeTruthy();
    expect(view.getByRole('img', { name: 'GIF' })).toBeTruthy();
    expect(view.getByRole('img', { name: 'OMEGALUL' })).toBeTruthy();
  });

  it('renders a legacy restored gifUrl safely regardless of the retired toggle', () => {
    const parsed = build(twitchMessage({
      text: 'legacy fallback',
      twitchGifs: undefined,
      gifUrl: 'https://cdn.example.com/legacy.gif',
    }), { gifs: 'false' });
    const view = render(<div>{parsed.message}</div>);
    expect(view.getByRole('img', { name: 'GIF' }).getAttribute('src'))
      .toBe('https://cdn.example.com/legacy.gif');
    expect(view.container.textContent).not.toContain('legacy fallback');
  });

  it('never substitutes Twitch GIF metadata on non-Twitch messages', () => {
    const parsed = build(twitchMessage({ platform: 'kick' }));
    const view = render(<div>{parsed.message}</div>);
    expect(view.queryByRole('img', { name: 'GIF' })).toBeNull();
    expect(view.container.textContent).toContain('before X after');
  });

  it('round-trips structured metadata through the existing version-1 persistence envelope', () => {
    const parsed = build(twitchMessage());
    const key = 'test:twitch-gif-persistence';
    window.sessionStorage.removeItem(key);
    saveRestoredMultichatMessages(window.sessionStorage, key, [parsed]);
    expect(loadRestoredMultichatMessages(window.sessionStorage, key)[0]?.raw.twitchGifs)
      .toEqual(twitchMessage().twitchGifs);
  });
});
