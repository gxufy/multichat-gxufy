/*
 * Live refresh delivery for open overlays (server-sent events).
 *
 * Each overlay holds one connection to /api/overlay/live. While at least one is
 * open, the server checks the refresh state (the "refresh all" stamp and the
 * recent "refresh one channel" list) every OVERLAY_LIVE_CHECK_MS and pushes it
 * to every connection the moment it changes; the owner's refresh request also
 * pushes straight away. A comment line every OVERLAY_LIVE_HEARTBEAT_MS keeps
 * proxies (Cloudflare closes idle connections after 100 s) from dropping them.
 *
 * Commands sent from Owner tools ride along, but each connection only gets the
 * ones for the channels its overlay said it shows (`?c=platform:channel`), so
 * nobody else sees them. Otherwise the state carries only the stamp, public
 * channel names and the server time. Nothing about any viewer is read or kept.
 */
import { normalizeChatChannel } from '../channelValidation';
import {
  overlayRefreshChannelKey,
  overlayRefreshTargetMatches,
  type OverlayChannel,
  type OverlayOwnerCommand,
} from '../overlayRefreshWatcher';
import type { Platform } from '../types';
import { openSupporterStore } from './supporterStore';

export const OVERLAY_LIVE_CHECK_MS = 1_000;
export const OVERLAY_LIVE_HEARTBEAT_MS = 25_000;
/** Open connections allowed at once, in total and from one address. */
export const OVERLAY_LIVE_MAX_CONNECTIONS = 20_000;
export const OVERLAY_LIVE_MAX_PER_CLIENT = 30;
/** Most channels one overlay can name (it shows at most four platforms). */
export const OVERLAY_LIVE_MAX_CHANNELS = 8;

const CHANNEL_PLATFORMS: readonly Platform[] = ['twitch', 'kick', 'youtube', 'tiktok'];

/** `c=twitch:name` query values → the channels an overlay shows (bad ones dropped). */
export function parseOverlayChannelParams(value: unknown): OverlayChannel[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const out: OverlayChannel[] = [];
  for (const item of raw.slice(0, OVERLAY_LIVE_MAX_CHANNELS)) {
    if (typeof item !== 'string') continue;
    const at = item.indexOf(':');
    if (at <= 0) continue;
    const platform = item.slice(0, at) as Platform;
    if (!CHANNEL_PLATFORMS.includes(platform)) continue;
    const channel = normalizeChatChannel(platform, item.slice(at + 1));
    if (channel) out.push({ platform, channel: overlayRefreshChannelKey(channel) });
  }
  return out;
}

/** The owner's commands meant for an overlay showing these channels. */
export function ownerCommandsFor(
  commands: readonly OverlayOwnerCommand[],
  channels: readonly OverlayChannel[],
): OverlayOwnerCommand[] {
  if (!channels.length) return [];
  return commands.filter((command) => overlayRefreshTargetMatches(command, channels));
}

/** The part of a response the hub writes to. */
export type OverlayLiveSink = {
  write(chunk: string): unknown;
  end(): unknown;
};

type LiveState = { token: number; targets: unknown[]; commands: OverlayOwnerCommand[] };
type SinkInfo = { clientKey: string; channels: OverlayChannel[] };

type Hub = {
  sinks: Map<OverlayLiveSink, SinkInfo>;
  perClient: Map<string, number>;
  lastKey: string;
  check: ReturnType<typeof setInterval> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  reading: boolean;
};

const hub: Hub = ((globalThis as Record<string, unknown>).__flosschatOverlayLiveHub ??= {
  sinks: new Map(),
  perClient: new Map(),
  lastKey: '',
  check: null,
  heartbeat: null,
  reading: false,
}) as Hub;

async function readState(now: number): Promise<LiveState> {
  const store = openSupporterStore();
  if (!store) return { token: 0, targets: [], commands: [] };
  try {
    return {
      token: await store.overlayRefreshToken(),
      targets: await store.overlayRefreshTargets(now),
      commands: await store.overlayOwnerCommands(now),
    };
  } catch {
    return { token: 0, targets: [], commands: [] };
  }
}

function frame(state: LiveState, info: SinkInfo, now: number): string {
  const body = { ...state, commands: ownerCommandsFor(state.commands, info.channels), now };
  return `event: state\ndata: ${JSON.stringify(body)}\n\n`;
}

function send(sink: OverlayLiveSink, chunk: string): void {
  try {
    sink.write(chunk);
  } catch {
    removeOverlayLiveSink(sink);
  }
}

/** Read the state and push it to everyone if it changed (or if forced). */
export async function pushOverlayLiveState(force = false): Promise<void> {
  if (hub.reading || hub.sinks.size === 0) return;
  hub.reading = true;
  try {
    const now = Date.now();
    const state = await readState(now);
    const key = JSON.stringify(state);
    if (!force && key === hub.lastKey) return;
    hub.lastKey = key;
    for (const [sink, info] of [...hub.sinks]) send(sink, frame(state, info, now));
  } finally {
    hub.reading = false;
  }
}

function startTimers(): void {
  if (!hub.check) {
    hub.check = setInterval(() => { void pushOverlayLiveState(); }, OVERLAY_LIVE_CHECK_MS);
    hub.check.unref?.();
  }
  if (!hub.heartbeat) {
    hub.heartbeat = setInterval(() => {
      for (const sink of [...hub.sinks.keys()]) send(sink, ': keep-alive\n\n');
    }, OVERLAY_LIVE_HEARTBEAT_MS);
    hub.heartbeat.unref?.();
  }
}

function stopTimersIfIdle(): void {
  if (hub.sinks.size > 0) return;
  if (hub.check) clearInterval(hub.check);
  if (hub.heartbeat) clearInterval(hub.heartbeat);
  hub.check = null;
  hub.heartbeat = null;
  hub.lastKey = '';
}

/** False when the server or this address already has as many as it allows. */
export function overlayLiveHasRoom(clientKey: string): boolean {
  if (hub.sinks.size >= OVERLAY_LIVE_MAX_CONNECTIONS) return false;
  return (hub.perClient.get(clientKey) ?? 0) < OVERLAY_LIVE_MAX_PER_CLIENT;
}

/** Start sending to a new connection: first the current state, then changes. */
export async function addOverlayLiveSink(
  sink: OverlayLiveSink,
  clientKey: string,
  channels: OverlayChannel[] = [],
): Promise<void> {
  const info: SinkInfo = { clientKey, channels };
  hub.sinks.set(sink, info);
  hub.perClient.set(clientKey, (hub.perClient.get(clientKey) ?? 0) + 1);
  startTimers();
  const now = Date.now();
  const state = await readState(now);
  if (hub.sinks.has(sink)) send(sink, frame(state, info, now));
}

export function removeOverlayLiveSink(sink: OverlayLiveSink): void {
  const clientKey = hub.sinks.get(sink)?.clientKey;
  if (clientKey === undefined) return;
  hub.sinks.delete(sink);
  const left = (hub.perClient.get(clientKey) ?? 1) - 1;
  if (left > 0) hub.perClient.set(clientKey, left);
  else hub.perClient.delete(clientKey);
  stopTimersIfIdle();
}

export function overlayLiveConnectionCount(): number {
  return hub.sinks.size;
}

export function __resetOverlayLiveHubForTests(): void {
  for (const sink of [...hub.sinks.keys()]) removeOverlayLiveSink(sink);
  hub.perClient.clear();
  hub.lastKey = '';
  hub.reading = false;
  stopTimersIfIdle();
}
