// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { USED_BY_STREAMERS, usedByAssetPath, usedByChannelUrl } from '@/features/usedBy';

const PUBLIC_DIR = path.resolve(__dirname, '../../../web/public/used-by');

const profile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/twitchProfileClient', () => ({ fetchTwitchProfile: profile }));

describe('Used by: the clip files', () => {
  it('lists them in the chosen order', () => {
    expect(USED_BY_STREAMERS.map((streamer) => streamer.login)).toEqual([
      'kaicenat', 'stableronaldo', 'silky', 'plaqueboymax', 'symfuhny', '2xrakai', 'yourragegaming', 'reemknocks', 'agent00', 'rayasianboy', 'kelo',
    ]);
  });

  it('lists each streamer once, by Twitch login and id', () => {
    const logins = USED_BY_STREAMERS.map((streamer) => streamer.login);
    expect(new Set(logins).size).toBe(logins.length);
    expect(new Set(USED_BY_STREAMERS.map((streamer) => streamer.id)).size).toBe(logins.length);
    for (const streamer of USED_BY_STREAMERS) {
      expect(streamer.login).toMatch(/^[a-z0-9_]{3,25}$/);
      expect(streamer.id).toMatch(/^[1-9]\d{0,19}$/);
      expect(streamer.name.toLowerCase()).toBe(streamer.login);
    }
  });

  /* The clips (.mp4) live on the server (~/flosschat/media/used-by, linked
     into each release) and on the owner's computer, not in the public
     repository; the posters stay in the repository. */
  const clipsHere = fs.existsSync(PUBLIC_DIR) && fs.readdirSync(PUBLIC_DIR).some((file) => file.endsWith('.mp4'));

  it('has a poster for every streamer (and, where the clips are, a clip and a tile copy), and nothing else', () => {
    const expected = USED_BY_STREAMERS.flatMap(({ login }) => (clipsHere
      ? [`${login}.mp4`, `${login}-tile.mp4`, `${login}.webp`]
      : [`${login}.webp`])).sort();
    expect(fs.readdirSync(PUBLIC_DIR).sort()).toEqual(expected);
  });

  it('keeps every file small enough to load quickly', () => {
    let total = 0;
    for (const { login } of USED_BY_STREAMERS) {
      const size = (file: string) => fs.statSync(path.join(PUBLIC_DIR, file)).size;
      expect(size(`${login}.webp`), `${login} poster`).toBeLessThanOrEqual(80_000);
      if (!clipsHere) continue;
      expect(size(`${login}.mp4`), `${login} clip`).toBeLessThanOrEqual(30_000_000);
      expect(size(`${login}-tile.mp4`), `${login} tile`).toBeLessThanOrEqual(8_000_000);
      expect(size(`${login}-tile.mp4`), `${login} tile is smaller`).toBeLessThan(size(`${login}.mp4`));
      total += size(`${login}.mp4`) + size(`${login}-tile.mp4`);
    }
    expect(total).toBeLessThanOrEqual(140_000_000);
  });

  it('builds versioned file paths and channel links', () => {
    expect(usedByAssetPath('kelo', 'clip')).toMatch(/^\/used-by\/kelo\.mp4\?v=\w+$/);
    expect(usedByAssetPath('kelo', 'tile')).toMatch(/^\/used-by\/kelo-tile\.mp4\?v=\w+$/);
    expect(usedByAssetPath('kelo', 'poster')).toMatch(/^\/used-by\/kelo\.webp\?v=\w+$/);
    expect(usedByChannelUrl('kelo')).toBe('https://www.twitch.tv/kelo');
  });
});
