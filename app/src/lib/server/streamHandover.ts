/*
 * Deploy handover for the chat hubs (Kick, YouTube, TikTok).
 *
 * Each server copy has its own hubs. A new copy used to open a chat only when
 * the first overlay reached it, after the old copy had told the overlays to
 * move, so whatever was said in that second or so never reached them. Instead:
 *   - every copy writes the chats it is serving (public channel names and ids
 *     only) to `<slot>.streams.json` next to its drain file, every few seconds;
 *   - a copy that starts held (a deploy or switch-back starting it) reads the
 *     other slot's file and opens those chats itself while it waits, keeping
 *     each open for a minute, so the overlays find them connected and holding
 *     what was said since;
 *   - the overlays resume from their last event, which works across copies
 *     (Kick ids and YouTube/TikTok times), so they get that gap.
 * Without a drain file and slot (development, tests) none of this runs.
 *
 * State lives on globalThis so it is shared however the server bundles it.
 */
import { readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { normalizeChatChannel } from '../channelValidation';
import { subscribe as subscribeTikTok, tiktokHubChannels } from '../tiktokHub';
import { isHeld } from './drain';
import { kickRealtimeHubChannels, subscribeKickRealtime } from './kickRealtimeHub';
import { subscribeYouTube, youtubeHubChannels } from './youtubeHub';

export const STREAM_HANDOVER_WRITE_MS = 5_000;
/** A file older than this is from a copy that is gone: nothing to take over. */
export const STREAM_HANDOVER_FRESH_MS = 30_000;
/** How long a new copy keeps each chat open for the overlays to arrive. */
export const STREAM_HANDOVER_HOLD_MS = 60_000;
/** For this long after it starts, a held copy keeps reading the other copy's
    file (an overlay may open a new chat there while the deploy runs). */
export const STREAM_HANDOVER_WATCH_MS = 45_000;
export const STREAM_HANDOVER_WATCH_EVERY_MS = 2_000;
/** At most this many chats per platform (each hub takes 32). */
export const STREAM_HANDOVER_MAX_PER_PLATFORM = 32;
const MAX_FILE_BYTES = 64 * 1024;

export type ServedStreams = {
  kick: Array<{ channelId: number; chatroomId: number }>;
  youtube: string[];
  tiktok: string[];
};

type HandoverState = {
  started: boolean;
  writer: ReturnType<typeof setInterval> | null;
  watcher: ReturnType<typeof setInterval> | null;
  /** Chats this copy opened for the handover: key → close it. */
  held: Map<string, { close: () => void; timer: ReturnType<typeof setTimeout> }>;
};

const state: HandoverState = ((globalThis as Record<string, unknown>).__flosschatStreamHandover ??= {
  started: false,
  writer: null,
  watcher: null,
  held: new Map(),
}) as HandoverState;

const kickKey = (channelId: number, chatroomId: number) => `kick:${channelId}:${chatroomId}`;
const youtubeKey = (channel: string) => `youtube:${channel.toLowerCase()}`;
const tiktokKey = (user: string) => `tiktok:${user.toLowerCase()}`;

/** This copy's file and the other slot's, or null when there is no handover. */
export function streamHandoverFiles(): { own: string; peer: string } | null {
  const drainFile = process.env.FLOSSCHAT_DRAIN_FILE?.trim() ?? '';
  const slot = process.env.FLOSSCHAT_SLOT?.trim() ?? '';
  if (!drainFile || (slot !== 'a' && slot !== 'b')) return null;
  const dir = dirname(drainFile);
  return { own: join(dir, `${slot}.streams.json`), peer: join(dir, `${slot === 'a' ? 'b' : 'a'}.streams.json`) };
}

/** The chats overlays are watching on this copy (the ones it holds open for a
    handover count only once an overlay is on them too). */
export function servedStreams(): ServedStreams {
  const viewed = (key: string, subscribers: number) => subscribers - (state.held.has(key) ? 1 : 0) > 0;
  return {
    kick: kickRealtimeHubChannels()
      .filter((c) => viewed(kickKey(c.channelId, c.chatroomId), c.subscribers))
      .map(({ channelId, chatroomId }) => ({ channelId, chatroomId }))
      .slice(0, STREAM_HANDOVER_MAX_PER_PLATFORM),
    youtube: youtubeHubChannels()
      .filter((c) => viewed(youtubeKey(c.channel), c.subscribers))
      .map((c) => c.channel)
      .slice(0, STREAM_HANDOVER_MAX_PER_PLATFORM),
    tiktok: tiktokHubChannels()
      .filter((c) => viewed(tiktokKey(c.user), c.subscribers))
      .map((c) => c.user)
      .slice(0, STREAM_HANDOVER_MAX_PER_PLATFORM),
  };
}

export function writeServedStreams(file: string, now = Date.now()): void {
  try {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ written: now, ...servedStreams() }), { mode: 0o644 });
    renameSync(temporary, file);
  } catch {
    /* A handover without the list is today's: chats open when overlays arrive. */
  }
}

const positiveId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

/** The other copy's chats, or null when its file is missing, old or not one of ours. */
export function readServedStreams(file: string, now = Date.now()): ServedStreams | null {
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES || now - info.mtimeMs > STREAM_HANDOVER_FRESH_MS) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || typeof raw.written !== 'number') return null;
    if (now - raw.written > STREAM_HANDOVER_FRESH_MS || raw.written - now > STREAM_HANDOVER_FRESH_MS) return null;
    const list = (value: unknown): unknown[] =>
      Array.isArray(value) ? value.slice(0, STREAM_HANDOVER_MAX_PER_PLATFORM) : [];
    const kick: ServedStreams['kick'] = [];
    for (const entry of list(raw.kick)) {
      const record = entry as Record<string, unknown> | null;
      const channelId = positiveId(record?.channelId);
      const chatroomId = positiveId(record?.chatroomId);
      if (channelId && chatroomId) kick.push({ channelId, chatroomId });
    }
    const names = (value: unknown, platform: 'youtube' | 'tiktok'): string[] =>
      list(value)
        .map((name) => (typeof name === 'string' ? normalizeChatChannel(platform, name) : null))
        .filter((name): name is string => Boolean(name));
    return { kick, youtube: names(raw.youtube, 'youtube'), tiktok: names(raw.tiktok, 'tiktok') };
  } catch {
    return null;
  }
}

function holdOpen(key: string, open: () => () => void): void {
  if (state.held.has(key)) return;
  let close: () => void;
  try {
    close = open();
  } catch {
    return; /* full or not valid: the overlays open it themselves */
  }
  const timer = setTimeout(() => {
    state.held.delete(key);
    close();
  }, STREAM_HANDOVER_HOLD_MS);
  (timer as { unref?: () => void }).unref?.();
  state.held.set(key, { close, timer });
}

const ignore = () => {};

/** Open the other copy's chats here, each for STREAM_HANDOVER_HOLD_MS. */
export function holdStreamsOpen(served: ServedStreams): void {
  for (const { channelId, chatroomId } of served.kick) {
    holdOpen(kickKey(channelId, chatroomId), () => subscribeKickRealtime(channelId, chatroomId, ignore));
  }
  for (const channel of served.youtube) holdOpen(youtubeKey(channel), () => subscribeYouTube(channel, ignore));
  for (const user of served.tiktok) holdOpen(tiktokKey(user), () => subscribeTikTok(user, ignore));
}

/** Start writing this copy's chats and, when it starts held, take over the
    other copy's. Returns a function that stops it all. */
export function startStreamHandover(): () => void {
  const files = streamHandoverFiles();
  if (!files || state.started) return stopStreamHandover;
  state.started = true;
  const write = () => writeServedStreams(files.own);
  write();
  state.writer = setInterval(write, STREAM_HANDOVER_WRITE_MS);
  (state.writer as { unref?: () => void }).unref?.();
  if (isHeld()) {
    const startedAt = Date.now();
    const look = () => {
      const served = readServedStreams(files.peer);
      if (served) holdStreamsOpen(served);
      if (Date.now() - startedAt >= STREAM_HANDOVER_WATCH_MS && state.watcher) {
        clearInterval(state.watcher);
        state.watcher = null;
      }
    };
    look();
    state.watcher = setInterval(look, STREAM_HANDOVER_WATCH_EVERY_MS);
    (state.watcher as { unref?: () => void }).unref?.();
  }
  return stopStreamHandover;
}

export function stopStreamHandover(): void {
  if (state.writer) clearInterval(state.writer);
  if (state.watcher) clearInterval(state.watcher);
  state.writer = null;
  state.watcher = null;
  for (const { close, timer } of state.held.values()) {
    clearTimeout(timer);
    close();
  }
  state.held.clear();
  state.started = false;
}
