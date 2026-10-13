import { normalizeChatChannel } from '../channelValidation';
import type {
  OverlayUsageAction,
  OverlayUsageChannel,
  OverlayUsagePayload,
} from '../overlayUsage';
export type { OverlayUsagePayload } from '../overlayUsage';
import type { Platform } from '../types';

const SUPPORTED_PLATFORMS = new Set<Platform>(['twitch', 'kick', 'youtube', 'tiktok']);
const SUPPORTED_ACTIONS = new Set<OverlayUsageAction>(['opened', 'refreshed', 'loaded']);
const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANCE_ID_PATTERN = /^[0-9a-f]{8}$/;
const DELIVERY_TIMEOUT_MS = 4_000;
const SERVER_EVENT_DEDUPE_TTL_MS = 10 * 60_000;
const SERVER_EVENT_DEDUPE_MAX = 1_024;
const SERVER_RATE_WINDOW_MS = 60_000;
const SERVER_RATE_MAX = 30;

const deliveredEventIds = new Map<string, number>();
let recentDeliveries: number[] = [];
let warnedUnconfigured = false;

export type OverlayUsageDeliveryResult =
  | 'delivered'
  | 'deduped'
  | 'unconfigured'
  | 'failed';

function warnUnconfiguredDelivery(): void {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  console.warn('Discord overlay-usage delivery is not configured.');
}

function reportFailedDelivery(): void {
  console.error('Discord overlay-usage delivery failed.');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseChannels(value: unknown): OverlayUsageChannel[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;

  const seen = new Set<Platform>();
  const channels: OverlayUsageChannel[] = [];
  for (const item of value) {
    if (!isPlainObject(item) || !hasOnlyKeys(item, ['platform', 'channel'])) return null;
    if (typeof item.platform !== 'string' || !SUPPORTED_PLATFORMS.has(item.platform as Platform)) return null;
    const platform = item.platform as Platform;
    if (seen.has(platform)) return null;
    const channel = normalizeChatChannel(platform, item.channel);
    if (!channel) return null;
    seen.add(platform);
    channels.push({ platform, channel });
  }
  return channels;
}

export function parseOverlayUsagePayload(value: unknown): OverlayUsagePayload | null {
  if (!isPlainObject(value)) return null;
  const commonKeys = ['eventId', 'overlay', 'action', 'channels', 'instanceId'];
  if (value.overlay === 'counter') commonKeys.push('combined');
  if (!hasOnlyKeys(value, commonKeys)) return null;
  if (value.overlay !== 'multichat' && value.overlay !== 'counter') return null;
  if (typeof value.eventId !== 'string' || !UUID_PATTERN.test(value.eventId)) return null;
  if (typeof value.action !== 'string' || !SUPPORTED_ACTIONS.has(value.action as OverlayUsageAction)) return null;
  if (value.instanceId !== undefined && (
    typeof value.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(value.instanceId)
  )) return null;

  const channels = parseChannels(value.channels);
  if (!channels) return null;
  const common = {
    eventId: value.eventId.toLowerCase(),
    action: value.action as OverlayUsageAction,
    channels,
    ...(typeof value.instanceId === 'string' ? { instanceId: value.instanceId } : {}),
  };

  if (value.overlay === 'counter') {
    if (typeof value.combined !== 'boolean') return null;
    return { ...common, overlay: 'counter', combined: value.combined };
  }
  if (value.combined !== undefined) return null;
  return { ...common, overlay: 'multichat' };
}

export function formatOverlayUsageDiscordContent(payload: OverlayUsagePayload): string {
  const title = payload.overlay === 'counter'
    ? `👁 GXUFY Viewer Counter ${payload.action}`
    : `🟣 GXUFY MultiChat ${payload.action}`;
  return [
    title,
    ...payload.channels.map(({ platform, channel }) => `${PLATFORM_LABELS[platform]}: ${channel}`),
    ...(payload.overlay === 'counter' ? [`Mode: ${payload.combined ? 'Combined' : 'Separate'}`] : []),
    ...(payload.instanceId ? [`Instance: ${payload.instanceId}`] : []),
  ].join('\n');
}

function validDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (url.hostname !== 'discord.com' && url.hostname !== 'discordapp.com') return false;
    return /^\/api\/webhooks\/[^/]+\/[^/]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function admitDelivery(eventId: string, now: number): boolean {
  const cutoff = now - SERVER_EVENT_DEDUPE_TTL_MS;
  for (const [key, at] of deliveredEventIds) {
    if (at <= cutoff) deliveredEventIds.delete(key);
  }
  recentDeliveries = recentDeliveries.filter((at) => at > now - SERVER_RATE_WINDOW_MS);
  const previousDelivery = deliveredEventIds.get(eventId);
  if (previousDelivery !== undefined && previousDelivery > cutoff) return false;
  if (recentDeliveries.length >= SERVER_RATE_MAX) return false;

  deliveredEventIds.set(eventId, now);
  while (deliveredEventIds.size > SERVER_EVENT_DEDUPE_MAX) {
    const oldest = deliveredEventIds.keys().next().value as string | undefined;
    if (!oldest) break;
    deliveredEventIds.delete(oldest);
  }
  recentDeliveries.push(now);
  return true;
}

export async function deliverOverlayUsage(
  payload: OverlayUsagePayload,
  options: {
    webhookUrl?: string;
    fetch?: typeof fetch;
    now?: number;
  } = {},
): Promise<OverlayUsageDeliveryResult> {
  const webhookUrl = options.webhookUrl ?? process.env.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL ?? '';
  if (!webhookUrl || !validDiscordWebhookUrl(webhookUrl)) {
    warnUnconfiguredDelivery();
    return 'unconfigured';
  }
  const now = options.now ?? Date.now();
  if (!admitDelivery(payload.eventId, now)) return 'deduped';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: formatOverlayUsageDiscordContent(payload),
        allowed_mentions: { parse: [] },
      }),
      signal: controller.signal,
    });
    if (response.ok) return 'delivered';
    reportFailedDelivery();
    return 'failed';
  } catch {
    reportFailedDelivery();
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

export function resetOverlayUsageDeliveryForTests(): void {
  deliveredEventIds.clear();
  recentDeliveries = [];
  warnedUnconfigured = false;
}
