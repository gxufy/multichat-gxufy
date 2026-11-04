import type { Platform } from './types';

const CHANNEL_PATTERNS: Readonly<Record<Platform, RegExp>> = {
  kick: /^[A-Za-z0-9_-]{1,80}$/,
  twitch: /^[A-Za-z0-9_]{1,25}$/,
  youtube: /^[A-Za-z0-9._-]{1,50}$/,
  tiktok: /^[A-Za-z0-9._]{1,50}$/,
};

/**
 * Normalize one platform channel at the boundary shared by URLs, connectors and
 * server hubs. The conservative character sets match the provider-facing routes
 * already used by MultiChat and prevent whitespace/control characters from ever
 * reaching an IRC JOIN, upstream URL, or long-lived server subscription key.
 */
export function normalizeChatChannel(platform: Platform, value: unknown): string {
  if (typeof value !== 'string') return '';
  let channel = value.trim();
  if (!channel) return '';

  if (platform === 'twitch') channel = channel.replace(/^[@#]/, '');
  else channel = channel.replace(/^@/, '');

  return CHANNEL_PATTERNS[platform].test(channel) ? channel : '';
}

export function validChatChannel(platform: Platform, value: unknown): boolean {
  return normalizeChatChannel(platform, value) !== '';
}
