/*
 * What a chat Preview Data frame draws: the overlay settings parsed from the
 * serialized query, and the sample messages run through the overlay's own
 * filter and message model, as the live overlay does with arriving messages.
 *
 * Plain functions, used by the generator's preview frame (/preview-frame/chat).
 */
import type { ParsedMessage } from './kick';
import { safeParseMultichatConfig, type MultichatConfig } from './multichatConfig';
import {
  buildMessageFilter,
  buildParsedMessage,
  type MessageCosmetics,
} from './multichatMessageModel';
import type { PaintSource } from './paintChoice';
import type { MentionPaint } from './renderCore';
import type { UnifiedMessage } from './types';

/**
 * Sample chatters whose JilTV paint the preview shows even when they wear a
 * 7TV one too, as if they had typed `!flosschat paint jiltv`. Everyone else
 * keeps the overlay's rule (7TV's first). JilTV Cosmetics off still hides it.
 */
export const PREVIEW_JILTV_PAINT_LOGINS: ReadonlySet<string> = new Set(['gxufy', 'jilence']);

/** The cosmetics with those chatters' JilTV pick added (same object when
 *  nothing changes). */
export function withPreviewPaintPicks(
  messages: readonly UnifiedMessage[],
  cosmetics: MessageCosmetics,
): MessageCosmetics {
  let sources: Map<string, PaintSource> | null = null;
  for (const message of messages) {
    if (message.platform !== 'twitch' || !message.senderId || !message.jiltvPaint) continue;
    const login = (message.senderUsername ?? message.username).trim().replace(/^@/, '').toLowerCase();
    if (!PREVIEW_JILTV_PAINT_LOGINS.has(login)) continue;
    const key = `twitch:${message.senderId}`;
    if ((sources ?? cosmetics.paintSources)?.get(key) === 'jiltv') continue;
    sources ??= new Map(cosmetics.paintSources ?? []);
    sources.set(key, 'jiltv');
  }
  return sources ? { ...cosmetics, paintSources: sources } : cosmetics;
}

/** Parse a serialized query string into the config the overlay expects. */
export function chatPreviewConfig(query: string): MultichatConfig | null {
  const raw = Object.fromEntries(new URLSearchParams(query).entries());
  const parsed = safeParseMultichatConfig(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The rows to draw, in display order. Mention colours come from chatters seen
 * earlier in the same list, so the list is converted in order with one
 * context, exactly as the overlay converts its stream.
 */
export function chatPreviewRows(
  config: MultichatConfig | null,
  messages: readonly UnifiedMessage[],
  cosmetics: MessageCosmetics,
): ParsedMessage[] {
  if (!config) return [];

  const shouldDisplay = buildMessageFilter(config);
  const shown = withPreviewPaintPicks(messages, cosmetics);

  const mentions = {
    enabled: config.mentionColor,
    colors: new Map<string, string>(),
    paints: new Map<string, MentionPaint>(),
  };

  const out: ParsedMessage[] = [];

  for (const message of messages) {
    if (!shouldDisplay(message)) continue;

    out.push(
      buildParsedMessage(
        message,
        config,
        shown,
        mentions,
        message.timestamp,
      ),
    );
  }

  return out;
}
