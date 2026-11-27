import { describe, expect, it } from 'vitest';
import {
  PAINT_CHOICES_MAX,
  createPaintChoices,
  parsePaintChoice,
  shownPaintSource,
} from '@/lib/paintChoice';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
  key() { return null; }
  get length() { return this.items.size; }
}

const storage = () => new MemoryStorage() as unknown as Storage & MemoryStorage;

describe('which paint a name shows', () => {
  it('is 7TV for a chatter wearing both, unless they asked for JilTV', () => {
    expect(shownPaintSource(true, true, undefined)).toBe('7tv');
    expect(shownPaintSource(true, true, '7tv')).toBe('7tv');
    expect(shownPaintSource(true, true, 'jiltv')).toBe('jiltv');
  });

  it('is the one they wear when they wear one, whatever they asked for', () => {
    expect(shownPaintSource(true, false, 'jiltv')).toBe('7tv');
    expect(shownPaintSource(false, true, '7tv')).toBe('jiltv');
    expect(shownPaintSource(false, true, undefined)).toBe('jiltv');
    expect(shownPaintSource(false, false, 'jiltv')).toBeNull();
  });

  it('reads the command word', () => {
    expect(parsePaintChoice('7TV')).toBe('7tv');
    expect(parsePaintChoice('jiltv')).toBe('jiltv');
    expect(parsePaintChoice('auto')).toBe('auto');
    expect(parsePaintChoice('default')).toBe('auto');
    expect(parsePaintChoice(undefined)).toBeNull();
    expect(parsePaintChoice('rainbow')).toBeNull();
  });
});

describe('paint choices in a channel', () => {
  it('keeps the chatter’s own choice until they change it or say auto', () => {
    const choices = createPaintChoices('', null);
    expect(choices.sources.get('twitch:1')).toBeUndefined();
    expect(choices.choose('twitch:1', 'jiltv')).toBe(true);
    expect(choices.sources.get('twitch:1')).toBe('jiltv');
    /* The same again: nothing changes. */
    expect(choices.choose('twitch:1', 'jiltv')).toBe(false);
    expect(choices.choose('twitch:1', '7tv')).toBe(true);
    expect(choices.sources.get('twitch:1')).toBe('7tv');
    expect(choices.choose('twitch:1', 'auto')).toBe(true);
    expect(choices.sources.has('twitch:1')).toBe(false);
    expect(choices.choose('twitch:1', 'auto')).toBe(false);
  });

  it('remembers choices for the channel', () => {
    const store = storage();
    const first = createPaintChoices('twitch:streamer', store);
    first.choose('twitch:1', 'jiltv');
    const later = createPaintChoices('twitch:streamer', store);
    expect(later.sources.get('twitch:1')).toBe('jiltv');
    /* Another channel starts empty. */
    expect(createPaintChoices('twitch:other', store).sources.size).toBe(0);
  });

  it('keeps at most the newest choices, and shrugs off unreadable storage', () => {
    const store = storage();
    const choices = createPaintChoices('twitch:busy', store);
    for (let i = 0; i <= PAINT_CHOICES_MAX; i += 1) choices.choose(`twitch:${i}`, 'jiltv');
    const saved = JSON.parse(store.getItem('flosschat:paint-choices:twitch:busy')!);
    expect(Object.keys(saved)).toHaveLength(PAINT_CHOICES_MAX);
    expect(saved['twitch:0']).toBeUndefined();

    store.setItem('flosschat:paint-choices:twitch:broken', '{nope');
    expect(createPaintChoices('twitch:broken', store).sources.size).toBe(0);
    store.setItem('flosschat:paint-choices:twitch:odd', JSON.stringify({ 'twitch:1': 'rainbow', '<b>': '7tv', 'twitch:2': 'jiltv' }));
    expect([...createPaintChoices('twitch:odd', store).sources]).toEqual([['twitch:2', 'jiltv']]);

    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    const choicesWithoutStorage = createPaintChoices('twitch:x', blocked);
    expect(choicesWithoutStorage.choose('twitch:1', 'jiltv')).toBe(true);
    expect(choicesWithoutStorage.sources.get('twitch:1')).toBe('jiltv');
  });
});
