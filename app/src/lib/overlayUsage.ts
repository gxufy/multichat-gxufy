import { normalizeChatChannel } from './channelValidation';
import type { Platform } from './types';

export const OVERLAY_USAGE_ENDPOINT = '/api/overlay/usage';
export const OVERLAY_USAGE_COOLDOWN_MS = 5 * 60_000;
export const OVERLAY_USAGE_RESOLUTION_WINDOW_MS = 10_000;
export const OVERLAY_USAGE_STORAGE_KEY = 'gxufy:multichat:usage:v1';
const OVERLAY_USAGE_STORAGE_MAX = 8;

const PLATFORM_ORDER: readonly Platform[] = ['twitch', 'kick', 'youtube', 'tiktok'];

export type OverlayUsageChannel = {
  platform: Platform;
  channel: string;
};

type UsageRecord = { key: string; at: number };
type UsageStorage = Pick<Storage, 'getItem' | 'setItem'>;
type UsageFetch = (input: string, init: RequestInit) => Promise<unknown>;

type OverlayUsageReporterOptions = {
  fetch?: UsageFetch;
  storage?: UsageStorage | null;
  now?: () => number;
  resolutionWindowMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

function readUsageRecords(storage: UsageStorage | null): UsageRecord[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(OVERLAY_USAGE_STORAGE_KEY) ?? 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records
      .filter((record: unknown): record is UsageRecord => {
        if (!record || typeof record !== 'object') return false;
        const candidate = record as Partial<UsageRecord>;
        return typeof candidate.key === 'string'
          && candidate.key.length <= 400
          && typeof candidate.at === 'number'
          && Number.isFinite(candidate.at);
      })
      .slice(-OVERLAY_USAGE_STORAGE_MAX);
  } catch {
    return [];
  }
}

function writeUsageRecords(storage: UsageStorage | null, records: UsageRecord[]): void {
  if (!storage) return;
  try {
    storage.setItem(OVERLAY_USAGE_STORAGE_KEY, JSON.stringify({
      version: 1,
      records: records.slice(-OVERLAY_USAGE_STORAGE_MAX),
    }));
  } catch {
    // Telemetry storage is best-effort and must never affect the overlay.
  }
}

function channelSetKey(channels: readonly OverlayUsageChannel[]): string {
  return channels.map(({ platform, channel }) => `${platform}:${channel.toLowerCase()}`).join('|');
}

function browserSessionStorage(): UsageStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserFetch(input: string, init: RequestInit): Promise<unknown> {
  return window.fetch(input, init);
}

/**
 * Collect provider-confirmed channel identities and report a settled set without
 * delaying connector startup. A short deadline permits partial success when one
 * configured provider is offline; a complete set reports immediately.
 */
export function createOverlayUsageReporter(
  expectedPlatforms: readonly Platform[],
  options: OverlayUsageReporterOptions = {},
) {
  const expected = new Set(expectedPlatforms.filter((platform) => PLATFORM_ORDER.includes(platform)));
  const resolvedChannels = new Map<Platform, string>();
  const fetchUsage = options.fetch ?? browserFetch;
  const storage = options.storage === undefined ? browserSessionStorage() : options.storage;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let deadlineReached = false;
  let stopped = false;

  const flush = () => {
    if (stopped || resolvedChannels.size === 0) return;
    const channels = PLATFORM_ORDER
      .filter((platform) => resolvedChannels.has(platform))
      .map((platform) => ({ platform, channel: resolvedChannels.get(platform)! }));
    const key = channelSetKey(channels);

    const at = now();
    const records = readUsageRecords(storage)
      .filter((record) => at - record.at < OVERLAY_USAGE_COOLDOWN_MS);
    if (records.some((record) => record.key === key)) {
      writeUsageRecords(storage, records);
      return;
    }
    writeUsageRecords(storage, [...records, { key, at }]);

    try {
      void Promise.resolve(fetchUsage(OVERLAY_USAGE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlay: 'multichat', channels }),
        keepalive: true,
      })).catch(() => undefined);
    } catch {
      // A synchronous fetch implementation failure is equally non-fatal.
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (expected.size > 0) {
    timer = setTimer(() => {
      timer = null;
      deadlineReached = true;
      flush();
    }, options.resolutionWindowMs ?? OVERLAY_USAGE_RESOLUTION_WINDOW_MS);
  }

  return {
    resolved(platform: Platform, channel: unknown): void {
      if (stopped || !expected.has(platform)) return;
      const normalized = normalizeChatChannel(platform, channel);
      if (!normalized) return;
      resolvedChannels.set(platform, normalized);
      if (resolvedChannels.size === expected.size) {
        if (timer !== null) clearTimer(timer);
        timer = null;
        flush();
      } else if (deadlineReached) {
        flush();
      }
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearTimer(timer);
    },
  };
}
