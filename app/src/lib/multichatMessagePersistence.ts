import { z } from 'zod';
import type { ParsedMessage } from './kick';
import {
  MULTICHAT_MAX_MESSAGE_LINES,
  multichatKickChannel,
  normalizeMaxMessageAge,
  normalizeMaxMessageLines,
  type MultichatConfig,
} from './multichatConfig';
import type { UnifiedMessage } from './types';

const STORAGE_PREFIX = 'multichat:messages:v1:';

const platformSchema = z.enum(['kick', 'twitch', 'youtube', 'tiktok']);
const unifiedMessageSchema = z.object({
  platform: platformSchema,
  displayPlatform: platformSchema.optional(),
  id: z.string().min(1),
  senderId: z.string(),
  username: z.string(),
  color: z.string(),
  badges: z.array(z.object({
    type: z.string(),
    version: z.string().optional(),
    count: z.number().finite().optional(),
    url: z.string().optional(),
    backgroundColor: z.string().optional(),
  })),
  text: z.string(),
  emotes: z.array(z.object({
    begin: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string(),
    url: z.string(),
  })),
  timestamp: z.number().finite(),
  kind: z.enum(['chat', 'system']),
  category: z.enum([
    'subscription', 'gift', 'raid', 'cheer', 'milestone', 'follow', 'announcement',
  ]).optional(),
  redeem: z.union([z.boolean(), z.string()]).optional(),
  firstMessage: z.boolean().optional(),
  gifUrl: z.string().optional(),
  avatar: z.string().optional(),
  reply: z.object({
    messageId: z.string().optional(),
    senderId: z.string().optional(),
    username: z.string(),
    text: z.string(),
  }).optional(),
  sourceChannel: z.object({
    roomId: z.string(),
    displayName: z.string().optional(),
    profileImageUrl: z.string().optional(),
  }).optional(),
  sharedChat: z.boolean().optional(),
});

const storedMessageSchema = z.object({
  raw: unifiedMessageSchema,
  displayedAt: z.number().finite(),
});

const storedEnvelopeSchema = z.object({
  version: z.literal(1),
  messages: z.array(storedMessageSchema).max(MULTICHAT_MAX_MESSAGE_LINES),
});

export type RestoredMultichatMessage = {
  raw: UnifiedMessage;
  displayedAt: number;
};

export type MultichatMessageRestoreOptions = {
  maxMessages?: number;
  maxAgeSeconds?: number;
  now?: number;
};

function restorePolicy(options: MultichatMessageRestoreOptions) {
  const maxMessages = normalizeMaxMessageLines(options.maxMessages);
  const maxAgeSeconds = normalizeMaxMessageAge(options.maxAgeSeconds);
  const now = Number.isFinite(options.now) ? options.now! : Date.now();
  const cutoff = maxAgeSeconds === 0
    ? Number.NEGATIVE_INFINITY
    : now - maxAgeSeconds * 1000;
  return { maxMessages, cutoff };
}

function normalizedChannel(value: string | undefined): string {
  return (value ?? '').trim().replace(/^@/, '').toLowerCase();
}

/** Session cache identity: appearance changes reuse the same channel history. */
export function multichatMessageStorageKey(config: MultichatConfig): string {
  const channels = [
    ['kick', multichatKickChannel(config)],
    ['twitch', config.twitch],
    ['youtube', config.youtube],
    ['tiktok', config.tiktok],
  ] as const;
  const identity = channels
    .map(([platform, channel]) => [platform, normalizedChannel(channel)] as const)
    .filter(([, channel]) => channel !== '')
    .map(([platform, channel]) => `${platform}:${encodeURIComponent(channel)}`)
    .join('|');
  return `${STORAGE_PREFIX}${identity}`;
}

/** Browser storage can throw in private/locked-down contexts; restoration is best-effort. */
export function multichatSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; }
  catch { return null; }
}

export function loadRestoredMultichatMessages(
  storage: Storage | null,
  key: string,
  options: MultichatMessageRestoreOptions = {},
): RestoredMultichatMessage[] {
  if (!storage) return [];
  const { maxMessages, cutoff } = restorePolicy(options);
  let raw: string | null = null;
  try { raw = storage.getItem(key); }
  catch { return []; }
  if (!raw) return [];

  try {
    const parsed = storedEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      storage.removeItem(key);
      return [];
    }
    const byId = new Map<string, RestoredMultichatMessage>();
    for (const message of parsed.data.messages) {
      if (message.displayedAt < cutoff) continue;
      const id = `${message.raw.platform}:${message.raw.id}`;
      byId.delete(id);
      byId.set(id, message as RestoredMultichatMessage);
    }
    return [...byId.values()].slice(-maxMessages);
  } catch {
    try { storage.removeItem(key); } catch {}
    return [];
  }
}

export function saveRestoredMultichatMessages(
  storage: Storage | null,
  key: string,
  messages: readonly ParsedMessage[],
  options: MultichatMessageRestoreOptions = {},
): void {
  if (!storage) return;
  const { maxMessages, cutoff } = restorePolicy(options);
  const restorable = messages.flatMap((message): RestoredMultichatMessage[] => {
    const parsed = unifiedMessageSchema.safeParse(message.raw);
    if (!parsed.success || !Number.isFinite(message.timestamp)) return [];
    return [{ raw: parsed.data, displayedAt: message.timestamp! }];
  })
    .filter((message) => message.displayedAt >= cutoff)
    .slice(-maxMessages);

  try {
    if (!restorable.length) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ version: 1, messages: restorable }));
  } catch {
    // Quota/security failures only disable restoration; live chat stays untouched.
  }
}
