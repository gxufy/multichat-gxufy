/*
 * Owner's refresh tools, delivered instantly.
 *
 * Every open overlay keeps one live connection to /api/overlay/live (server-sent
 * events). The server pushes its refresh state the moment it changes:
 *  - "Refresh all overlays" stores a newer stamp; an overlay that sees a stamp
 *    newer than the one it started with reloads;
 *  - "Refresh one channel" adds the channel to a short list; an overlay showing
 *    that channel reloads if the request came after it started (judged by the
 *    server's clock, so viewers' clocks don't matter).
 * Commands sent from Owner tools arrive the same way: the overlay names its
 * channels when it connects, gets only the commands for them, and runs each
 * one once (only ones sent after it started).
 * The overlay reloads straight away. A refresh of everything is spread over
 * REFRESH_ALL_SPREAD_MS so every overlay doesn't reconnect in the same
 * millisecond. If the live connection isn't open (older browser, network
 * hiccup), the overlay falls back to asking /api/overlay/refresh about once a
 * minute.
 */
import type { Platform } from './types';

/** Which platform a targeted refresh is for; 'any' matches the name on every platform. */
export type OverlayRefreshPlatform = Platform | 'any';
export const OVERLAY_REFRESH_PLATFORMS: readonly OverlayRefreshPlatform[] = [
  'any', 'twitch', 'kick', 'youtube', 'tiktok',
];

/** One "refresh this channel" the owner sent (`at` is server time, ms). */
export type OverlayRefreshTarget = {
  platform: OverlayRefreshPlatform;
  channel: string;
  at: number;
};

/** A command the owner sent to one channel's overlays (`text` has no trigger). */
export type OverlayOwnerCommand = {
  id: string;
  platform: OverlayRefreshPlatform;
  channel: string;
  text: string;
  at: number;
};

/** A channel an open overlay is showing. */
export type OverlayChannel = { platform: Platform; channel: string };

/** Same spelling rules on both sides: no leading @ or #, any letter case. */
export function overlayRefreshChannelKey(channel: string): string {
  return channel.trim().replace(/^[@#]/, '').toLowerCase();
}

/** True when a targeted refresh is meant for an overlay showing these channels. */
export function overlayRefreshTargetMatches(
  target: Pick<OverlayRefreshTarget, 'platform' | 'channel'>,
  channels: readonly OverlayChannel[],
): boolean {
  const wanted = overlayRefreshChannelKey(target.channel);
  if (!wanted) return false;
  return channels.some((shown) => (
    (target.platform === 'any' || target.platform === shown.platform)
    && overlayRefreshChannelKey(shown.channel) === wanted
  ));
}

export const REFRESH_POLL_MS = 60_000;
export const REFRESH_POLL_JITTER_MS = 15_000;
/** "Refresh all" lands within this window (random per overlay); a single
 *  channel's refresh is immediate. */
export const REFRESH_ALL_SPREAD_MS = 2_000;
export const OVERLAY_LIVE_PATH = '/api/overlay/live';
export const OVERLAY_LIVE_EVENT = 'state';

type EventSourceLike = {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
};
type EventSourceFactory = (url: string) => EventSourceLike;

export type OverlayRefreshWatcherOptions = {
  /** The channels this overlay shows, for "refresh one channel" and commands. */
  channels?: () => readonly OverlayChannel[];
  onRefresh: () => void;
  /** Runs a command sent from Owner tools (text without the !flosschat trigger). */
  onCommand?: (text: string) => void;
  fetcher?: typeof fetch;
  random?: () => number;
  /** Opens the live connection; null turns it off (polling only). */
  openLive?: EventSourceFactory | null;
};

type RefreshState = {
  token: number;
  /** Server time of this answer; null from an older server. */
  now: number | null;
  targets: OverlayRefreshTarget[];
  commands: OverlayOwnerCommand[];
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseTargets(value: unknown): OverlayRefreshTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { platform, channel, at } = item as Record<string, unknown>;
    if (typeof platform !== 'string' || !(OVERLAY_REFRESH_PLATFORMS as readonly string[]).includes(platform)) return [];
    if (typeof channel !== 'string' || !channel || !finite(at)) return [];
    return [{ platform: platform as OverlayRefreshPlatform, channel, at }];
  });
}

function parseCommands(value: unknown): OverlayOwnerCommand[] {
  if (!Array.isArray(value)) return [];
  return parseTargets(value).flatMap((target, index) => {
    const { id, text } = value[index] as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof text !== 'string' || !text) return [];
    return [{ ...target, id, text }];
  });
}

/** The refresh state from a JSON body (poll answer or live event); null if unusable. */
export function parseOverlayRefreshState(body: unknown): RefreshState | null {
  if (!body || typeof body !== 'object') return null;
  const { token, now, targets, commands } = body as Record<string, unknown>;
  if (!finite(token)) return null;
  return {
    token,
    now: finite(now) ? now : null,
    targets: parseTargets(targets),
    commands: parseCommands(commands),
  };
}

/** `c=platform:channel` pairs naming the channels an overlay shows. */
export function overlayChannelQuery(channels: readonly OverlayChannel[]): string {
  return channels
    .map((shown) => `c=${encodeURIComponent(`${shown.platform}:${shown.channel}`)}`)
    .join('&');
}

async function readState(fetcher: typeof fetch, query: string): Promise<RefreshState | null> {
  try {
    const response = await fetcher(`/api/overlay/refresh${query ? `?${query}` : ''}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseOverlayRefreshState(await response.json());
  } catch {
    return null;
  }
}

function defaultOpenLive(): EventSourceFactory | null {
  return typeof EventSource === 'function'
    ? (url) => new EventSource(url) as unknown as EventSourceLike
    : null;
}

export function startOverlayRefreshWatcher(options: OverlayRefreshWatcherOptions): () => void {
  const fetcher = options.fetcher ?? fetch;
  const random = options.random ?? Math.random;
  const openLive = options.openLive === undefined ? defaultOpenLive() : options.openLive;
  let stopped = false;
  let baseline: number | null = null;
  /* Server time of the first answer: only channel refreshes sent after this
     are for this overlay (an overlay opened afterwards is already fresh). */
  let since: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live: EventSourceLike | null = null;
  /* Commands already run, so one delivered by both the live connection and a
     poll (or pushed twice) runs once. */
  const ran = new Set<string>();
  const query = () => overlayChannelQuery(options.channels?.() ?? []);

  const targetedAtThisOverlay = (state: RefreshState) => {
    if (since === null || !options.channels) return false;
    const channels = options.channels();
    if (!channels.length) return false;
    return state.targets.some((target) => (
      target.at > (since as number) && overlayRefreshTargetMatches(target, channels)
    ));
  };

  const reload = (delayMs: number) => {
    stopped = true;
    if (timer) clearTimeout(timer);
    live?.close();
    if (delayMs <= 0) options.onRefresh();
    else timer = setTimeout(options.onRefresh, delayMs);
  };

  const runCommands = (state: RefreshState) => {
    if (since === null || !options.onCommand || !options.channels) return;
    const channels = options.channels();
    if (!channels.length) return;
    for (const command of state.commands) {
      if (stopped) return;
      if (command.at <= since || ran.has(command.id)) continue;
      if (!overlayRefreshTargetMatches(command, channels)) continue;
      ran.add(command.id);
      options.onCommand(command.text);
    }
  };

  const consider = (state: RefreshState | null) => {
    if (stopped || state === null) return;
    if (baseline === null) {
      baseline = state.token;
      since = state.now;
      return;
    }
    runCommands(state);
    if (stopped) return;
    if (state.token > baseline) {
      reload(Math.floor(random() * REFRESH_ALL_SPREAD_MS));
    } else if (targetedAtThisOverlay(state)) {
      reload(0);
    }
  };

  const liveOpen = () => live !== null && live.readyState === 1;

  const poll = async () => {
    /* While the live connection is open it delivers everything; skip the ask. */
    if (!liveOpen()) consider(await readState(fetcher, query()));
    if (stopped) return;
    timer = setTimeout(() => { void poll(); }, REFRESH_POLL_MS + Math.floor(random() * REFRESH_POLL_JITTER_MS));
  };

  if (openLive) {
    try {
      const q = query();
      live = openLive(q ? `${OVERLAY_LIVE_PATH}?${q}` : OVERLAY_LIVE_PATH);
      live.addEventListener(OVERLAY_LIVE_EVENT, (event) => {
        let body: unknown = null;
        try {
          body = JSON.parse(event.data);
        } catch {
          return;
        }
        consider(parseOverlayRefreshState(body));
      });
    } catch {
      live = null;
    }
  }

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    live?.close();
  };
}
