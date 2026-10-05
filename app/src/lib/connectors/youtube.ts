import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';
import { isMessageFromCurrentOverlaySession } from '../startupMessageBaseline';
import { normalizeChatChannel } from '../channelValidation';
import { youtubeDeliveryIntervalMs } from '../youtubePacing';
export { YOUTUBE_DELIVERY_INTERVAL_MS, youtubeDeliveryIntervalMs } from '../youtubePacing';

const OFFLINE_RECHECK_MS = 60_000;
const POLL_FLOOR_MS = 800;
const POLL_CEILING_MS = 2_000;
const YOUTUBE_SEEN_MAX = 2_048;
const RETRY_START_MS = 5_000;
const RETRY_MAX_MS = 60_000;
const SHARED_RECONNECT_START_MS = 5_000;
const SHARED_RECONNECT_MAX_MS = 60_000;

/**
 * Maximum delay between actions from one YouTube continuation batch. The pacing
 * implementation lives in youtubePacing so server diagnostics can report the
 * exact same planned delivery timing without duplicating constants.
 */
interface Bootstrap {
  videoId: string;
  apiKey: string;
  clientVersion: string;
  continuation: string;
  channelId?: string;
}
interface ParsedRuns { text: string; emotes: UnifiedEmote[] }

function codepointLength(value: string): number { return Array.from(value).length; }

function normalizeImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.startsWith('//') ? `https:${value}` : value;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch { return undefined; }
}

function bestThumbnail(thumbnails: any): string | undefined {
  if (!Array.isArray(thumbnails)) return undefined;
  return thumbnails
    .map((thumbnail, index) => ({
      url: normalizeImageUrl(thumbnail?.url),
      area: Number(thumbnail?.width || 0) * Number(thumbnail?.height || 0),
      index,
    }))
    .filter((thumbnail): thumbnail is { url: string; area: number; index: number } => Boolean(thumbnail.url))
    .sort((a, b) => b.area - a.area || b.index - a.index)[0]?.url;
}

function authorAvatar(renderer: any): string | undefined {
  const avatar = bestThumbnail(renderer?.authorPhoto?.thumbnails);
  return avatar?.replace(/=s\d+(?=-|$)/, '=s160');
}

/** Flatten InnerTube runs into fallback text plus native image-emote offsets. */
export function parseRuns(runs: any[]): ParsedRuns {
  let text = '';
  const emotes: UnifiedEmote[] = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (typeof run?.text === 'string') { text += run.text; continue; }
    const emoji = run?.emoji;
    if (!emoji) continue;
    if (!emoji.isCustomEmoji) {
      if (typeof emoji.emojiId === 'string') text += emoji.emojiId;
      continue;
    }
    const shortcut = Array.isArray(emoji.shortcuts)
      ? emoji.shortcuts.find((candidate: unknown) => typeof candidate === 'string' && candidate.length)
      : undefined;
    const rawName = shortcut ?? (typeof emoji.emojiId === 'string' ? emoji.emojiId : 'emote');
    const name = rawName.replace(/^:+|:+$/g, '') || 'emote';
    const begin = codepointLength(text);
    text += name;
    const url = bestThumbnail(emoji.image?.thumbnails);
    if (url) emotes.push({ begin, end: begin + codepointLength(name), text: name, url });
  }
  return { text, emotes };
}

function parseText(value: any): ParsedRuns {
  if (Array.isArray(value?.runs)) return parseRuns(value.runs);
  return { text: typeof value?.simpleText === 'string' ? value.simpleText : '', emotes: [] };
}
function appendText(target: ParsedRuns, value: string) { target.text += value; }
function appendRuns(target: ParsedRuns, value: ParsedRuns) {
  const shift = codepointLength(target.text);
  target.text += value.text;
  target.emotes.push(...value.emotes.map((emote) => ({ ...emote, begin: emote.begin + shift, end: emote.end + shift })));
}

function canonicalBadgeType(renderer: any, hasThumbnail: boolean): string | null {
  if (hasThumbnail) return 'subscriber';
  const value = `${renderer?.icon?.iconType ?? ''} ${renderer?.tooltip ?? ''}`.trim().toLowerCase();
  if (/\b(owner|channel owner)\b/.test(value)) return 'owner';
  if (/\bmoderator\b/.test(value)) return 'moderator';
  if (/\bverified\b/.test(value)) return 'verified';
  return null;
}

function authorBadges(renderer: any): UnifiedBadge[] {
  const badges: UnifiedBadge[] = [];
  for (const value of Array.isArray(renderer?.authorBadges) ? renderer.authorBadges : []) {
    const badge = value?.liveChatAuthorBadgeRenderer;
    if (!badge) continue;
    const url = bestThumbnail(badge.customThumbnail?.thumbnails);
    const type = canonicalBadgeType(badge, Boolean(url));
    if (type) badges.push({ type, ...(url ? { url } : {}) });
  }
  return badges;
}
function authorName(renderer: any): string { return parseText(renderer?.authorName).text; }
function authorHandle(name: string): string | undefined {
  const value = name.trim();
  return /^@[^\s@]+$/u.test(value) ? value : undefined;
}
function timestamp(renderer: any): number {
  const usec = Number(renderer?.timestampUsec);
  return Number.isFinite(usec) && usec > 0 ? Math.floor(usec / 1000) : Date.now();
}

function buildMessage(renderer: any): UnifiedMessage | null {
  if (!renderer?.id) return null;
  const { text, emotes } = parseText(renderer.message);
  const username = authorName(renderer);
  const senderUsername = authorHandle(username);
  return {
    platform: 'youtube', id: renderer.id,
    senderId: renderer.authorExternalChannelId ?? '',
    ...(senderUsername ? { senderUsername } : {}),
    username, color: '',
    badges: authorBadges(renderer), text, emotes, timestamp: timestamp(renderer), kind: 'chat',
    avatar: authorAvatar(renderer),
  };
}

function buildModeMessage(renderer: any): UnifiedMessage | null {
  if (!renderer?.id) return null;
  const visible = parseText(renderer.text ?? renderer.message ?? renderer.subtext ?? renderer.primaryText);
  if (!visible.text) return null;
  return {
    platform: 'youtube', id: renderer.id, senderId: '', username: 'YouTube', color: '', badges: [],
    text: visible.text, emotes: visible.emotes, timestamp: timestamp(renderer), kind: 'system', category: 'announcement',
  };
}

/** Paid, membership and membership-gift renderers -> normalized event rows. */
function buildSystemMessage(item: any): UnifiedMessage | null {
  const paid = item.liveChatPaidMessageRenderer;
  const sticker = item.liveChatPaidStickerRenderer;
  const member = item.liveChatMembershipItemRenderer;
  const gift = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  const redemption = item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer;
  if (item.liveChatModeChangeMessageRenderer) return buildModeMessage(item.liveChatModeChangeMessageRenderer);

  const renderer = paid ?? sticker ?? member
    ?? (gift ? gift.header?.liveChatSponsorshipsHeaderRenderer : null)
    ?? redemption;
  const id = paid?.id ?? sticker?.id ?? member?.id ?? gift?.id ?? redemption?.id;
  if (!renderer || !id) return null;

  const author = authorName(renderer) || 'Someone';
  const senderUsername = authorHandle(author);
  const displayAuthor = author.replace(/^@/, '');
  const content: ParsedRuns = { text: '', emotes: [] };
  let category: UnifiedMessage['category'];

  if (paid) {
    appendText(content, `${displayAuthor} sent a ${parseText(paid.purchaseAmountText).text} Super Chat`);
    const body = parseText(paid.message);
    if (body.text) appendText(content, ': ');
    appendRuns(content, body);
    category = 'cheer';
  } else if (sticker) {
    appendText(content, `${displayAuthor} sent a ${parseText(sticker.purchaseAmountText).text} Super Sticker!`);
    const stickerUrl = bestThumbnail(sticker.sticker?.thumbnails);
    if (stickerUrl) {
      const label = parseText(sticker.stickerDisplayText).text || 'Super Sticker';
      appendText(content, ' ');
      const begin = codepointLength(content.text);
      appendText(content, label);
      content.emotes.push({ begin, end: begin + codepointLength(label), text: label, url: stickerUrl });
    }
    category = 'cheer';
  } else if (gift) {
    appendText(content, `${displayAuthor} `);
    const primary = parseText(renderer.primaryText);
    appendRuns(content, primary.text ? primary : { text: 'gifted memberships!', emotes: [] });
    category = 'gift';
  } else if (redemption) {
    appendText(content, `${displayAuthor} `);
    const body = parseText(redemption.message ?? redemption.primaryText ?? redemption.subtext);
    appendRuns(content, body.text ? body : { text: 'received a gifted membership!', emotes: [] });
    category = 'gift';
  } else {
    appendText(content, `${displayAuthor} `);
    const header = parseText(member.headerSubtext);
    appendRuns(content, header.text ? header : { text: 'became a member!', emotes: [] });
    const body = parseText(member.message);
    if (body.text) appendText(content, ': ');
    appendRuns(content, body);
    category = 'subscription';
  }

  return {
    platform: 'youtube', id, senderId: renderer.authorExternalChannelId ?? '',
    ...(senderUsername ? { senderUsername } : {}),
    username: author, color: '',
    badges: authorBadges(renderer), text: content.text, emotes: content.emotes,
    timestamp: timestamp(renderer), kind: 'system', category, avatar: authorAvatar(renderer),
  };
}

function itemId(item: any): string | null {
  if (!item || typeof item !== 'object') return null;
  for (const renderer of Object.values(item) as any[]) {
    if (renderer && typeof renderer.id === 'string') return renderer.id;
  }
  return null;
}

function itemSenderId(item: any): string | null {
  if (!item || typeof item !== 'object') return null;
  for (const renderer of Object.values(item) as any[]) {
    const id = renderer?.authorExternalChannelId
      ?? renderer?.header?.liveChatSponsorshipsHeaderRenderer?.authorExternalChannelId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

export interface YouTubeConnectorOpts extends ConnectorCallbacks {
  channel: string;
  onChannelInfo?(info: { channelId: string; videoId: string }): void;
}

/**
 * Production browsers subscribe to one server-side YouTube hub per channel.
 * The hub owns discovery/polling (including a simultaneous live Short) while
 * this connector keeps the mature message/event parser in the browser. Older
 * environments without a standards-complete EventSource keep the direct
 * InnerTube polling path for backwards compatibility.
 */
export function createYouTubeConnector(opts: YouTubeConnectorOpts): Connector {
  const channel = normalizeChatChannel('youtube', opts.channel);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoff = RETRY_START_MS;
  let es: EventSource | null = null;
  let sharedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sharedReconnectDelay = SHARED_RECONNECT_START_MS;
  let lastChannelInfo = '';
  const startedAt = Date.now();
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  let deliveryTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingActions: Array<{
    action: any;
    deletedIds: Set<string>;
    deletedAuthors: Set<string>;
    delayMs: number;
  }> = [];

  function remember(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    seenOrder.push(id);
    while (seenOrder.length > YOUTUBE_SEEN_MAX) {
      const old = seenOrder.shift();
      if (old) seen.delete(old);
    }
    return true;
  }

  function schedule(fn: () => void, ms: number) {
    if (!stopped) timer = setTimeout(fn, ms);
  }

  function emitMessage(message: UnifiedMessage): void {
    if (!remember(message.id)) return;
    if (!isMessageFromCurrentOverlaySession(message.timestamp, startedAt)) return;
    opts.onMessage(message);
  }

  function handleAction(
    action: any,
    deletedIds: Set<string>,
    deletedAuthors: Set<string>,
  ) {
    const item = action.addChatItemAction?.item;
    if (item) {
      const id = itemId(item);
      const senderId = itemSenderId(item);
      if ((id && deletedIds.has(id)) || (senderId && deletedAuthors.has(senderId))) {
        if (id) remember(id);
        return;
      }
      const message = item.liveChatTextMessageRenderer
        ? buildMessage(item.liveChatTextMessageRenderer)
        : buildSystemMessage(item);
      if (message) emitMessage(message);
      return;
    }

    const deleteId = action.markChatItemAsDeletedAction?.targetItemId ?? action.removeChatItemAction?.targetItemId;
    if (deleteId) { opts.onDelete({ id: String(deleteId) }); return; }
    const banned = action.markChatItemsByAuthorAsDeletedAction?.externalChannelId
      ?? action.removeChatItemByAuthorAction?.externalChannelId;
    if (banned) { opts.onDelete({ senderId: String(banned) }); return; }

    const banner = action.addBannerToLiveChatCommand?.bannerRenderer?.liveChatBannerRenderer;
    if (banner) {
      const inner = banner.contents?.liveChatTextMessageRenderer;
      const message = inner ? buildMessage(inner) : null;
      if (message) opts.onPin({ message });
      return;
    }
    if (action.removeBannerForLiveChatCommand) opts.onPin(null);
  }

  function drainActionQueue(): void {
    if (stopped || deliveryTimer || pendingActions.length === 0) return;
    const queued = pendingActions.shift()!;
    handleAction(queued.action, queued.deletedIds, queued.deletedAuthors);
    deliveryTimer = setTimeout(() => {
      deliveryTimer = null;
      drainActionQueue();
    }, queued.delayMs);
  }

  function handleActions(actions: any[]): void {
    if (!actions.length) return;
    // Preserve whole-batch moderation semantics before pacing. A delete/ban later
    // in the same InnerTube response must suppress the matching add even though the
    // individual actions are displayed over time.
    const deletedIds = new Set<string>();
    const deletedAuthors = new Set<string>();
    for (const action of actions) {
      const id = action.markChatItemAsDeletedAction?.targetItemId ?? action.removeChatItemAction?.targetItemId;
      if (id) deletedIds.add(String(id));
      const author = action.markChatItemsByAuthorAsDeletedAction?.externalChannelId
        ?? action.removeChatItemByAuthorAction?.externalChannelId;
      if (author) deletedAuthors.add(String(author));
    }
    const delayMs = youtubeDeliveryIntervalMs(actions.length);
    for (const action of actions) pendingActions.push({ action, deletedIds, deletedAuthors, delayMs });
    drainActionQueue();
  }

  function supportsSharedHub(): boolean {
    if (typeof EventSource === 'undefined') return false;
    return typeof (EventSource as any).OPEN === 'number';
  }

  function scheduleSharedReconnect(): void {
    if (stopped || sharedReconnectTimer) return;
    const wait = sharedReconnectDelay;
    sharedReconnectDelay = Math.min(sharedReconnectDelay * 2, SHARED_RECONNECT_MAX_MS);
    sharedReconnectTimer = setTimeout(() => {
      sharedReconnectTimer = null;
      connectShared();
    }, wait);
  }

  function connectShared(): void {
    if (stopped) return;
    opts.onStatus('connecting');
    const query = new URLSearchParams({ channel, since: String(startedAt) });
    es = new EventSource(`/api/youtube/stream?${query.toString()}`);
    es.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data?.type === 'status') {
        if (data.status === 'connected') sharedReconnectDelay = SHARED_RECONNECT_START_MS;
        if (data.channelId && data.videoId) {
          const key = `${data.channelId}:${data.videoId}`;
          if (key !== lastChannelInfo) {
            lastChannelInfo = key;
            opts.onChannelInfo?.({ channelId: String(data.channelId), videoId: String(data.videoId) });
          }
        }
        if (['connecting', 'connected', 'offline', 'error'].includes(data.status)) {
          opts.onStatus(data.status, data.detail);
        }
        return;
      }
      if (data?.type === 'actions' && Array.isArray(data.actions)) handleActions(data.actions);
    };
    es.onerror = () => {
      es?.close();
      es = null;
      scheduleSharedReconnect();
    };
  }

  async function bootstrap() {
    if (stopped) return;
    opts.onStatus('connecting');
    try {
      const response = await fetch(`/api/youtube/live?channel=${encodeURIComponent(channel)}`);
      const data = await response.json();
      if (data.offline) {
        opts.onStatus('offline', 'Channel is not live');
        backoff = RETRY_START_MS;
        schedule(bootstrap, OFFLINE_RECHECK_MS);
        return;
      }
      if (!response.ok || data.error) {
        opts.onStatus('error', data.error ?? `HTTP ${response.status}`);
        schedule(bootstrap, OFFLINE_RECHECK_MS);
        return;
      }
      const boot = data as Bootstrap;
      if (boot.channelId) opts.onChannelInfo?.({ channelId: boot.channelId, videoId: boot.videoId });
      opts.onStatus('connected');
      backoff = RETRY_START_MS;
      poll(boot, boot.continuation, 1_000);
    } catch (error: any) {
      opts.onStatus('error', error?.message);
      schedule(bootstrap, OFFLINE_RECHECK_MS);
    }
  }

  function nextContinuation(cont: any): { continuation: string | null; timeoutMs: number } {
    for (const value of cont?.continuations ?? []) {
      const data = value.invalidationContinuationData ?? value.timedContinuationData ?? value.reloadContinuationData;
      if (data?.continuation) {
        const raw = typeof data.timeoutMs === 'number' && Number.isFinite(data.timeoutMs)
          ? data.timeoutMs
          : 2_000;
        return {
          continuation: data.continuation,
          timeoutMs: Math.min(Math.max(raw, POLL_FLOOR_MS), POLL_CEILING_MS),
        };
      }
    }
    return { continuation: null, timeoutMs: 0 };
  }

  async function poll(boot: Bootstrap, continuation: string, delayMs: number) {
    schedule(async () => {
      try {
        const response = await fetch('/api/youtube/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: boot.apiKey, clientVersion: boot.clientVersion, continuation }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        backoff = RETRY_START_MS;
        const cont = data?.continuationContents?.liveChatContinuation;
        if (!cont) {
          opts.onStatus('offline', 'Stream ended');
          schedule(bootstrap, OFFLINE_RECHECK_MS);
          return;
        }

        const actions: any[] = Array.isArray(cont.actions) ? cont.actions : [];
        handleActions(actions);

        const next = nextContinuation(cont);
        if (!next.continuation) {
          opts.onStatus('offline', 'Stream ended');
          schedule(bootstrap, OFFLINE_RECHECK_MS);
          return;
        }
        poll(boot, next.continuation, next.timeoutMs);
      } catch (error: any) {
        opts.onStatus('error', error?.message);
        const wait = backoff;
        backoff = Math.min(backoff * 2, RETRY_MAX_MS);
        poll(boot, continuation, wait);
      }
    }, delayMs);
  }

  return {
    start() {
      if (!channel) {
        opts.onStatus('error', 'Invalid YouTube channel');
        return;
      }
      if (supportsSharedHub()) connectShared();
      else void bootstrap();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (deliveryTimer) clearTimeout(deliveryTimer);
      deliveryTimer = null;
      pendingActions.length = 0;
      if (sharedReconnectTimer) clearTimeout(sharedReconnectTimer);
      sharedReconnectTimer = null;
      es?.close();
      es = null;
    },
  };
}
