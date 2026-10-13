import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/multichat.tsx'),
  'utf8',
);

describe('Twitch pinned native emote wiring', () => {
  it('passes validated native pin emotes into UnifiedMessage', () => {
    const start = SOURCE.indexOf('function toUnifiedTwitchPin(');
    expect(start).toBeGreaterThan(-1);

    const end = SOURCE.indexOf('/* The query schema', start);
    expect(end).toBeGreaterThan(start);

    const region = SOURCE.slice(start, end);

    expect(region).toContain('emotes: pin.emotes');
    expect(region).not.toContain('emotes: []');
  });

  it('keeps Twitch pin text unchanged alongside the native offsets', () => {
    const start = SOURCE.indexOf('function toUnifiedTwitchPin(');
    expect(start).toBeGreaterThan(-1);

    const end = SOURCE.indexOf('/* The query schema', start);
    const region = SOURCE.slice(start, end);

    expect(region).toContain('text: pin.text');
    expect(region).toContain('emotes: pin.emotes');
  });
});
