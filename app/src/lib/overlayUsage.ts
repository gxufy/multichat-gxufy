import { normalizeChatChannel } from './channelValidation';
import type { Platform } from './types';
import type { ViewerCounterChannels } from './viewerCounterConfig';

export const OVERLAY_USAGE_ENDPOINT = '/api/overlay/usage';
export const OVERLAY_USAGE_RESOLUTION_WINDOW_MS = 10_000;
export const OVERLAY_USAGE_INSTANCE_STORAGE_KEY = 'gxufy:overlay:instance-id:v1';

const PLATFORM_ORDER: readonly Platform[] = ['twitch', 'kick', 'youtube', 'tiktok'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OverlayUsageAction = 'opened' | 'refreshed' | 'loaded';

export type OverlayUsageChannel = {
  platform: Platform;
  channel: string;
};

export type MultichatOverlayUsagePayload = {
  eventId: string;
  overlay: 'multichat';
  action: OverlayUsageAction;
  channels: OverlayUsageChannel[];
  instanceId?: string;
};

export type CounterOverlayUsagePayload = {
  eventId: string;
  overlay: 'counter';
  action: OverlayUsageAction;
  channels: OverlayUsageChannel[];
  combined: boolean;
  instanceId?: string;
};

export type OverlayUsagePayload =
  | MultichatOverlayUsagePayload
  | CounterOverlayUsagePayload;

type OverlayUsageBody =
  | { overlay: 'multichat'; channels: OverlayUsageChannel[] }
  | { overlay: 'counter'; channels: OverlayUsageChannel[]; combined: boolean };

export type OverlayUsagePageContext = {
  eventId: string;
  action: OverlayUsageAction;
  instanceId?: string;
  sent: boolean;
};

type UsageStorage = Pick<Storage, 'getItem' | 'setItem'>;
type UsageFetch = (input: string, init: RequestInit) => Promise<unknown>;

type OverlayUsageReporterOptions = {
  fetch?: UsageFetch;
  pageContext?: OverlayUsagePageContext;
  resolutionWindowMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

type PageContextOptions = {
  storage?: UsageStorage | null;
  randomUuid?: () => string;
  navigationType?: () => string | undefined;
};

const pageContexts = new WeakMap<Window, OverlayUsagePageContext>();

function browserStorage(): UsageStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserRandomUuid(): string {
  return crypto.randomUUID();
}

function browserNavigationType(): string | undefined {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return undefined;
  }
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type;
}

function navigationAction(type: string | undefined): OverlayUsageAction {
  if (type === 'reload') return 'refreshed';
  if (type === 'navigate') return 'opened';
  return 'loaded';
}

function safeRandomUuid(randomUuid: () => string): string | null {
  try {
    const value = randomUuid().toLowerCase();
    return UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function anonymousInstanceId(
  storage: UsageStorage | null,
  randomUuid: () => string,
): string | undefined {
  if (!storage) return undefined;
  try {
    const existing = storage.getItem(OVERLAY_USAGE_INSTANCE_STORAGE_KEY) ?? '';
    if (UUID_PATTERN.test(existing)) return existing.slice(0, 8).toLowerCase();

    const created = safeRandomUuid(randomUuid);
    if (!created) return undefined;
    storage.setItem(OVERLAY_USAGE_INSTANCE_STORAGE_KEY, created);
    return created.slice(0, 8);
  } catch {
    return undefined;
  }
}

export function createOverlayUsagePageContext(
  options: PageContextOptions = {},
): OverlayUsagePageContext | null {
  const randomUuid = options.randomUuid ?? browserRandomUuid;
  const eventId = safeRandomUuid(randomUuid);
  if (!eventId) return null;

  return {
    eventId,
    action: navigationAction((options.navigationType ?? browserNavigationType)()),
    instanceId: anonymousInstanceId(
      options.storage === undefined ? browserStorage() : options.storage,
      randomUuid,
    ),
    sent: false,
  };
}

function browserPageContext(): OverlayUsagePageContext | null {
  if (typeof window === 'undefined') return null;
  const existing = pageContexts.get(window);
  if (existing) return existing;
  const created = createOverlayUsagePageContext();
  if (created) pageContexts.set(window, created);
  return created;
}

function browserFetch(input: string, init: RequestInit): Promise<unknown> {
  return window.fetch(input, init);
}

function postOnce(
  payload: OverlayUsageBody,
  pageContext: OverlayUsagePageContext | null,
  fetchUsage: UsageFetch,
): void {
  if (!pageContext || pageContext.sent) return;
  pageContext.sent = true;

  try {
    void Promise.resolve(fetchUsage(OVERLAY_USAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: pageContext.eventId,
        ...payload,
        action: pageContext.action,
        ...(pageContext.instanceId ? { instanceId: pageContext.instanceId } : {}),
      }),
      credentials: 'omit',
      keepalive: true,
    })).catch(() => undefined);
  } catch {
    // Usage reporting is best-effort and must never affect an overlay.
  }
}

/**
 * Collect provider-confirmed MultiChat channel identities and report exactly
 * once for this document load. The shared page context survives React remounts;
 * a browser refresh creates a new Window and therefore a new event id.
 */
export function createOverlayUsageReporter(
  expectedPlatforms: readonly Platform[],
  options: OverlayUsageReporterOptions = {},
) {
  const expected = new Set(expectedPlatforms.filter((platform) => PLATFORM_ORDER.includes(platform)));
  const resolvedChannels = new Map<Platform, string>();
  const fetchUsage = options.fetch ?? browserFetch;
  const pageContext = options.pageContext ?? browserPageContext();
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let deadlineReached = false;
  let stopped = false;

  const flush = () => {
    if (stopped || resolvedChannels.size === 0) return;
    const channels = PLATFORM_ORDER
      .filter((platform) => resolvedChannels.has(platform))
      .map((platform) => ({ platform, channel: resolvedChannels.get(platform)! }));
    postOnce({ overlay: 'multichat', channels }, pageContext, fetchUsage);
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

/** Report one configured viewer-counter load. Polling never calls this helper. */
export function reportCounterOverlayUsage(
  rawChannels: ViewerCounterChannels,
  combined: boolean,
  options: Pick<OverlayUsageReporterOptions, 'fetch' | 'pageContext'> = {},
): void {
  const channels = PLATFORM_ORDER.flatMap((platform) => {
    const channel = normalizeChatChannel(platform, rawChannels[platform]);
    return channel ? [{ platform, channel }] : [];
  });
  if (channels.length === 0) return;

  postOnce(
    { overlay: 'counter', channels, combined },
    options.pageContext ?? browserPageContext(),
    options.fetch ?? browserFetch,
  );
}

export function __resetOverlayUsagePageContextForTests(): void {
  if (typeof window !== 'undefined') pageContexts.delete(window);
}
