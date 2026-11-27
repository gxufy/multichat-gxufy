/* The stored stand-in emote list (lib/emoteListStore). */
import { describe, expect, it } from 'vitest';
import {
  STORED_EMOTES_MAX_AGE_MS,
  STORED_EMOTES_MAX_CHANNELS,
  STORED_EMOTES_MAX_CHARS,
  STORED_EMOTES_PREFIX,
  readStoredEmotes,
  storeEmotes,
} from '@/lib/emoteListStore';
import type { SevenTVEmote } from '@/lib/kick';

class MemoryStorage {
  map = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string) { this.map.delete(key); }
}

const emote = (name: string, extra: Partial<SevenTVEmote> = {}): SevenTVEmote => ({
  name, image: `https://cdn.7tv.app/emote/${name}/4x.webp`, width: 112, height: 112, zeroWidth: false, upscale: false, ...extra,
});
const T0 = 1_800_000_000_000;

describe('stored emote lists', () => {
  it('gives back what was stored for the same channel, and nothing for others', () => {
    const storage = new MemoryStorage();
    const list = [
      emote('KEKW', { activeFlags: 65_536, host: '//cdn.7tv.app/emote/01ABC', files: [{ name: '1x.webp', width: 28, height: 28 }] }),
      { name: 'PogU', image: 'https://cdn.betterttv.net/emote/abc/3x', width: 28, height: 28, zeroWidth: false, upscale: true },
    ];
    expect(storeEmotes('twitch', '641972806', list, T0, storage)).toBe(true);
    expect(readStoredEmotes('twitch', '641972806', T0 + 1_000, storage)).toEqual(list);
    expect(readStoredEmotes('kick', '641972806', T0, storage)).toBeNull();
    expect(readStoredEmotes('twitch', '1', T0, storage)).toBeNull();
  });

  it('forgets a list after a week', () => {
    const storage = new MemoryStorage();
    storeEmotes('kick', '123', [emote('a')], T0, storage);
    expect(readStoredEmotes('kick', '123', T0 + STORED_EMOTES_MAX_AGE_MS, storage)).not.toBeNull();
    expect(readStoredEmotes('kick', '123', T0 + STORED_EMOTES_MAX_AGE_MS + 1, storage)).toBeNull();
    expect(storage.getItem(`${STORED_EMOTES_PREFIX}kick:123`)).toBeNull();
  });

  it('keeps only the most recent channels', () => {
    const storage = new MemoryStorage();
    for (let i = 0; i <= STORED_EMOTES_MAX_CHANNELS; i += 1) storeEmotes('twitch', String(100 + i), [emote(`e${i}`)], T0 + i, storage);
    expect(readStoredEmotes('twitch', '100', T0 + 10, storage)).toBeNull();
    expect(readStoredEmotes('twitch', String(100 + STORED_EMOTES_MAX_CHANNELS), T0 + 10, storage)).not.toBeNull();
    expect([...storage.map.keys()].filter((key) => !key.endsWith('index'))).toHaveLength(STORED_EMOTES_MAX_CHANNELS);
  });

  it('drops anything that is not a sound emote (bad URL, odd fields), keeping the rest', () => {
    const storage = new MemoryStorage();
    storage.setItem(`${STORED_EMOTES_PREFIX}twitch:5`, JSON.stringify({ at: T0, emotes: [
      emote('good'),
      { ...emote('script'), image: 'javascript:alert(1)' },
      { ...emote('http'), image: 'http://cdn.7tv.app/x.webp' },
      { ...emote('size'), width: -1 },
      { ...emote('host'), host: '//evil.example/emote/1' },
      'nope',
    ] }));
    const read = readStoredEmotes('twitch', '5', T0, storage)!;
    expect(read.map((item) => item.name)).toEqual(['good', 'host']);
    expect(read[1].host).toBeUndefined();
    storage.setItem(`${STORED_EMOTES_PREFIX}twitch:6`, '{broken');
    expect(readStoredEmotes('twitch', '6', T0, storage)).toBeNull();
  });

  it('skips a list too big to store, and survives full or blocked storage', () => {
    const storage = new MemoryStorage();
    const huge = Array.from({ length: 4_000 }, (_, i) => emote(`emote_${i}_${'x'.repeat(60)}`, {
      image: `https://cdn.7tv.app/emote/${'y'.repeat(400)}/${i}.webp`,
    }));
    expect(JSON.stringify(huge).length).toBeGreaterThan(STORED_EMOTES_MAX_CHARS);
    expect(storeEmotes('twitch', '7', huge, T0, storage)).toBe(false);
    storage.failWrites = true;
    expect(storeEmotes('twitch', '7', [emote('a')], T0, storage)).toBe(false);
    expect(readStoredEmotes('twitch', '7', T0, storage)).toBeNull();
    expect(storeEmotes('twitch', '7', [emote('a')], T0, null)).toBe(false);
    expect(readStoredEmotes('twitch', 'bad id!', T0, storage)).toBeNull();
  });
});
