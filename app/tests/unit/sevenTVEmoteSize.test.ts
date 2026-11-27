import { afterEach, describe, expect, it } from 'vitest';
import { mapSevenTVEmote } from '@/lib/kick';
import {
  pickSevenTVEmoteFile,
  resetSevenTVEmoteTargetHeightForTests,
  setSevenTVEmoteTargetHeight,
  sevenTVEmoteSource,
} from '@/lib/sevenTVEmoteSize';

const FILES = [
  { name: '1x.webp', width: 48, height: 32, format: 'WEBP' },
  { name: '2x.webp', width: 96, height: 64, format: 'WEBP' },
  { name: '3x.webp', width: 144, height: 96, format: 'WEBP' },
  { name: '4x.webp', width: 192, height: 128, format: 'WEBP' },
  { name: '4x.avif', width: 192, height: 128, format: 'AVIF' },
];

const active = (files = FILES) => ({
  id: 'slot', name: 'wide', flags: 0,
  data: { id: 'EMOTEID', flags: 0, host: { url: '//cdn.7tv.app/emote/EMOTEID', files } },
});

afterEach(() => resetSevenTVEmoteTargetHeightForTests());

describe('7TV emote sizing', () => {
  it('keeps the largest file as the image and records the sized WEBP files', () => {
    const emote = mapSevenTVEmote(active());
    expect(emote.image).toBe('https://cdn.7tv.app/emote/EMOTEID/4x.webp');
    expect(emote.host).toBe('https://cdn.7tv.app/emote/EMOTEID');
    expect(emote.files?.map((file) => file.name)).toEqual(['1x.webp', '2x.webp', '3x.webp', '4x.webp']);
  });

  it('downloads 2x for medium chat instead of 4x, with its shape for the reserved space', () => {
    setSevenTVEmoteTargetHeight(58);
    expect(sevenTVEmoteSource(mapSevenTVEmote(active()))).toEqual({
      src: 'https://cdn.7tv.app/emote/EMOTEID/2x.webp', width: 96, height: 64,
    });
  });

  it('steps up for larger text and caps at the largest file', () => {
    setSevenTVEmoteTargetHeight(82);
    expect(sevenTVEmoteSource(mapSevenTVEmote(active())).src).toMatch(/3x\.webp$/);
    setSevenTVEmoteTargetHeight(400);
    expect(sevenTVEmoteSource(mapSevenTVEmote(active())).src).toMatch(/4x\.webp$/);
    expect(pickSevenTVEmoteFile([])).toBeNull();
  });

  it('falls back to the stored image for an emote without trusted sized files', () => {
    const untrusted = mapSevenTVEmote({ ...active(), data: { ...active().data, host: { url: '//evil.example/x', files: FILES } } });
    expect(untrusted.host).toBeUndefined();
    expect(sevenTVEmoteSource(untrusted).src).toBe('https://cdn.7tv.app/emote/EMOTEID/4x.webp');
  });
});
