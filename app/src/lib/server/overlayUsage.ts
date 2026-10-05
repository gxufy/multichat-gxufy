import { normalizeChatChannel } from '../channelValidation';
import type { OverlayUsageChannel } from '../overlayUsage';
import type { Platform } from '../types';

const SUPPORTED_PLATFORMS = new Set<Platform>(['twitch', 'kick', 'youtube', 'tiktok']);
const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};
const DELIVERY_TIMEOUT_MS = 4_000;
const SERVER_DEDUPE_COOLDOWN_MS = 5 * 60_000;
const SERVER_DEDUPE_MAX = 256;
const SERVER_RATE_WINDOW_MS = 60_000;
const SERVER_RATE_MAX = 30;

export type OverlayUsagePayload = {
  overlay: 'multichat';
  channels: OverlayUsageChannel[];
};

const deliveredChannelSets = new Map<string, number>();
let recentDeliveries: number[] = [];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function parseOverlayUsagePayload(value: unknown): OverlayUsagePayload | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['overlay', 'channels'])) return null;
  if (value.overlay !== 'multichat' || !Array.isArray(value.channels)) return null;
  if (value.channels.length < 1 || value.channels.length > 4) return null;

  const seen = new Set<Platform>();
  const channels: OverlayUsageChannel[] = [];
  for (const item of value.channels) {
    if (!isPlainObject(item) || !hasOnlyKeys(item, ['platform', 'channel'])) return null;
    if (typeof item.platform !== 'string' || !SUPPORTED_PLATFORMS.has(item.platform as Platform)) return null;
    const platform = item.platform as Platform;
    if (seen.has(platform)) return null;
    const channel = normalizeChatChannel(platform, item.channel);
    if (!channel) return null;
    seen.add(platform);
    channels.push({ platform, channel });
  }
  return { overlay: 'multichat', channels };
}

export function formatOverlayUsageDiscordContent(payload: OverlayUsagePayload): string {
  return [
    'GXUFY MultiChat started',
    ...payload.channels.map(({ platform, channel }) => `${PLATFORM_LABELS[platform]}: ${channel}`),
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

function payloadKey(payload: OverlayUsagePayload): string {
  return payload.channels
    .map(({ platform, channel }) => `${platform}:${channel.toLowerCase()}`)
    .sort()
    .join('|');
}

function admitDelivery(payload: OverlayUsagePayload, now: number): boolean {
  const cutoff = now - SERVER_DEDUPE_COOLDOWN_MS;
  for (const [key, at] of deliveredChannelSets) {
    if (at <= cutoff) deliveredChannelSets.delete(key);
  }
  recentDeliveries = recentDeliveries.filter((at) => at > now - SERVER_RATE_WINDOW_MS);
  const key = payloadKey(payload);
  if ((deliveredChannelSets.get(key) ?? 0) > cutoff || recentDeliveries.length >= SERVER_RATE_MAX) {
    return false;
  }
  deliveredChannelSets.set(key, now);
  while (deliveredChannelSets.size > SERVER_DEDUPE_MAX) {
    const oldest = deliveredChannelSets.keys().next().value as string | undefined;
    if (!oldest) break;
    deliveredChannelSets.delete(oldest);
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
): Promise<'delivered' | 'skipped' | 'failed'> {
  const webhookUrl = options.webhookUrl ?? process.env.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL ?? '';
  if (!webhookUrl || !validDiscordWebhookUrl(webhookUrl)) return 'skipped';
  const now = options.now ?? Date.now();
  if (!admitDelivery(payload, now)) return 'skipped';

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
    return response.ok ? 'delivered' : 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

export function resetOverlayUsageDeliveryForTests(): void {
  deliveredChannelSets.clear();
  recentDeliveries = [];
}
