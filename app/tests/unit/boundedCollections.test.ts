import { describe, expect, it } from 'vitest';
import { BoundedMap, BoundedSet } from '@/lib/boundedCollections';

describe('bounded per-chatter memory', () => {
  it('a map forgets the oldest tenth once past its limit, keeping recent writes', () => {
    const map = new BoundedMap<string, number>(10);
    for (let i = 0; i < 10; i += 1) map.set(String(i), i);
    map.set('0', 100);
    expect(map.size).toBe(10);
    map.set('10', 10);
    expect([...map.keys()]).toEqual(['3', '4', '5', '6', '7', '8', '9', '0', '10']);
    expect(map.get('0')).toBe(100);
    expect(map.get('1')).toBeUndefined();
  });

  it('a set does the same', () => {
    const set = new BoundedSet<string>(10);
    for (let i = 0; i < 11; i += 1) set.add(String(i));
    expect(set.size).toBe(9);
    expect(set.has('0')).toBe(false);
    expect(set.has('10')).toBe(true);
  });

  it('stays flat and fast over a very long, very busy stream', () => {
    const set = new BoundedSet<string>(50_000);
    const map = new BoundedMap<string, string>(20_000);
    const started = performance.now();
    for (let i = 0; i < 500_000; i += 1) {
      set.add(`twitch:${i}`);
      map.set(`viewer${i}`, '#ff0000');
    }
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(set.size).toBeLessThanOrEqual(50_000);
    expect(map.size).toBeLessThanOrEqual(20_000);
    expect(set.has('twitch:499999')).toBe(true);
    expect(set.has('twitch:0')).toBe(false);
  });
});
