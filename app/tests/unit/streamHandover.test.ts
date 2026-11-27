/* Deploy handover for the chat hubs (lib/server/streamHandover): each copy
 * notes the chats it serves; a copy that starts held opens the other copy's. */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hubs = vi.hoisted(() => ({
  held: false,
  kick: [] as Array<{ channelId: number; chatroomId: number; subscribers: number }>,
  youtube: [] as Array<{ channel: string; subscribers: number }>,
  tiktok: [] as Array<{ user: string; subscribers: number }>,
  opened: [] as string[],
  closed: [] as string[],
  refuse: new Set<string>(),
}));

function opener(name: string) {
  return (...args: unknown[]) => {
    const key = `${name}:${args.filter((arg) => typeof arg !== 'function').join(':')}`;
    if (hubs.refuse.has(key)) throw new Error('full');
    hubs.opened.push(key);
    return () => hubs.closed.push(key);
  };
}

vi.mock('@/lib/server/drain', () => ({ isHeld: () => hubs.held }));
vi.mock('@/lib/server/kickRealtimeHub', () => ({
  kickRealtimeHubChannels: () => hubs.kick,
  subscribeKickRealtime: vi.fn(opener('kick')),
}));
vi.mock('@/lib/server/youtubeHub', () => ({
  youtubeHubChannels: () => hubs.youtube,
  subscribeYouTube: vi.fn(opener('youtube')),
}));
vi.mock('@/lib/tiktokHub', () => ({
  tiktokHubChannels: () => hubs.tiktok,
  subscribe: vi.fn(opener('tiktok')),
}));

import {
  STREAM_HANDOVER_FRESH_MS,
  STREAM_HANDOVER_HOLD_MS,
  STREAM_HANDOVER_MAX_PER_PLATFORM,
  STREAM_HANDOVER_WATCH_EVERY_MS,
  STREAM_HANDOVER_WATCH_MS,
  STREAM_HANDOVER_WRITE_MS,
  readServedStreams,
  servedStreams,
  startStreamHandover,
  stopStreamHandover,
  streamHandoverFiles,
} from '@/lib/server/streamHandover';

let signals = '';
const NOW = 1_800_000_000_000;

function peerFile(body: object, written = NOW, modified = NOW) {
  const file = join(signals, 'b.streams.json');
  writeFileSync(file, JSON.stringify({ written, ...body }));
  utimesSync(file, modified / 1000, modified / 1000);
  return file;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  signals = mkdtempSync(join(tmpdir(), 'signals-'));
  vi.stubEnv('FLOSSCHAT_DRAIN_FILE', join(signals, 'a.draining'));
  vi.stubEnv('FLOSSCHAT_SLOT', 'a');
  hubs.held = false;
  hubs.kick = [];
  hubs.youtube = [];
  hubs.tiktok = [];
  hubs.opened = [];
  hubs.closed = [];
  hubs.refuse = new Set();
});

afterEach(() => {
  stopStreamHandover();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(signals, { recursive: true, force: true });
});

describe('the chats a copy serves', () => {
  it('names its own file and the other slot\'s next to the drain file', () => {
    expect(streamHandoverFiles()).toEqual({ own: join(signals, 'a.streams.json'), peer: join(signals, 'b.streams.json') });
    vi.stubEnv('FLOSSCHAT_SLOT', '');
    expect(streamHandoverFiles()).toBeNull();
    vi.stubEnv('FLOSSCHAT_SLOT', 'b');
    vi.stubEnv('FLOSSCHAT_DRAIN_FILE', '');
    expect(streamHandoverFiles()).toBeNull();
  });

  it('writes them at start and every few seconds', () => {
    hubs.kick = [{ channelId: 7, chatroomId: 70, subscribers: 2 }];
    hubs.youtube = [{ channel: 'LofiGirl', subscribers: 1 }];
    startStreamHandover();
    const read = () => JSON.parse(readFileSync(join(signals, 'a.streams.json'), 'utf8'));
    expect(read()).toEqual({ written: NOW, kick: [{ channelId: 7, chatroomId: 70 }], youtube: ['LofiGirl'], tiktok: [] });
    hubs.tiktok = [{ user: 'creator', subscribers: 3 }];
    vi.advanceTimersByTime(STREAM_HANDOVER_WRITE_MS);
    expect(read()).toMatchObject({ written: NOW + STREAM_HANDOVER_WRITE_MS, tiktok: ['creator'] });
  });

  it('counts a chat it only holds open for a handover once an overlay is on it too', () => {
    hubs.held = true;
    peerFile({ kick: [{ channelId: 7, chatroomId: 70 }], youtube: [], tiktok: [] });
    hubs.kick = [{ channelId: 7, chatroomId: 70, subscribers: 1 }];
    startStreamHandover();
    expect(servedStreams().kick).toEqual([]);
    hubs.kick = [{ channelId: 7, chatroomId: 70, subscribers: 2 }];
    expect(servedStreams().kick).toEqual([{ channelId: 7, chatroomId: 70 }]);
  });
});

describe('a copy that starts held', () => {
  it('opens every chat the other copy serves, and closes them after a minute', () => {
    hubs.held = true;
    peerFile({ kick: [{ channelId: 7, chatroomId: 70 }], youtube: ['@LofiGirl'], tiktok: ['creator'] });
    startStreamHandover();
    expect(hubs.opened).toEqual(['kick:7:70', 'youtube:LofiGirl', 'tiktok:creator']);
    vi.advanceTimersByTime(STREAM_HANDOVER_HOLD_MS - 1);
    expect(hubs.closed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(hubs.closed).toEqual(['kick:7:70', 'youtube:LofiGirl', 'tiktok:creator']);
  });

  it('picks up chats the other copy takes on while the deploy runs, each once', () => {
    hubs.held = true;
    peerFile({ kick: [], youtube: ['first'], tiktok: [] });
    startStreamHandover();
    peerFile({ kick: [], youtube: ['first', 'second'], tiktok: [] }, NOW + 1_000, NOW + 1_000);
    vi.advanceTimersByTime(STREAM_HANDOVER_WATCH_EVERY_MS);
    expect(hubs.opened).toEqual(['youtube:first', 'youtube:second']);
    /* Then it stops looking. */
    vi.advanceTimersByTime(STREAM_HANDOVER_WATCH_MS);
    peerFile({ kick: [], youtube: ['third'], tiktok: [] }, Date.now(), Date.now());
    vi.advanceTimersByTime(STREAM_HANDOVER_WATCH_EVERY_MS * 3);
    expect(hubs.opened).not.toContain('youtube:third');
  });

  it('skips a chat it cannot open and opens the rest', () => {
    hubs.held = true;
    hubs.refuse.add('kick:7:70');
    peerFile({ kick: [{ channelId: 7, chatroomId: 70 }, { channelId: 8, chatroomId: 80 }], youtube: [], tiktok: [] });
    startStreamHandover();
    expect(hubs.opened).toEqual(['kick:8:80']);
  });

  it('takes nothing over when it was not started held (a restart, a reboot)', () => {
    peerFile({ kick: [{ channelId: 7, chatroomId: 70 }], youtube: ['LofiGirl'], tiktok: [] });
    startStreamHandover();
    vi.advanceTimersByTime(STREAM_HANDOVER_WATCH_MS);
    expect(hubs.opened).toEqual([]);
  });
});

describe('the other copy\'s file', () => {
  it('is ignored when old, missing, from the future or not ours', () => {
    expect(readServedStreams(join(signals, 'b.streams.json'))).toBeNull();
    const old = peerFile({ kick: [], youtube: ['x'], tiktok: [] }, NOW - STREAM_HANDOVER_FRESH_MS - 1);
    expect(readServedStreams(old)).toBeNull();
    const touchedLongAgo = peerFile({ kick: [], youtube: ['x'], tiktok: [] }, NOW, NOW - STREAM_HANDOVER_FRESH_MS - 1);
    expect(readServedStreams(touchedLongAgo)).toBeNull();
    const ahead = peerFile({ kick: [], youtube: ['x'], tiktok: [] }, NOW + STREAM_HANDOVER_FRESH_MS + 1);
    expect(readServedStreams(ahead)).toBeNull();
    writeFileSync(old, 'not json');
    expect(readServedStreams(old)).toBeNull();
    writeFileSync(old, 'x'.repeat(70 * 1024));
    expect(readServedStreams(old)).toBeNull();
  });

  it('keeps only valid chats, at most one hub\'s worth per platform', () => {
    const many = Array.from({ length: STREAM_HANDOVER_MAX_PER_PLATFORM + 5 }, (_, i) => `creator${i}`);
    const file = peerFile({
      kick: [{ channelId: 7, chatroomId: 70 }, { channelId: -1, chatroomId: 1 }, { channelId: 1.5, chatroomId: 2 }, 'x'],
      youtube: ['@LofiGirl', 'not a channel!', 42],
      tiktok: many,
    });
    expect(readServedStreams(file)).toEqual({
      kick: [{ channelId: 7, chatroomId: 70 }],
      youtube: ['LofiGirl'],
      tiktok: many.slice(0, STREAM_HANDOVER_MAX_PER_PLATFORM),
    });
  });
});
