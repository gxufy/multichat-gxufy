/* YouTube Live chat connector (no OAuth).
 *
 * Bootstraps via /api/youtube/live (handle → live videoId + InnerTube
 * key/version/continuation scraped server-side), then polls
 * /api/youtube/chat with continuation tokens. Poll floor 800ms,
 * respects timeoutMs (unified-chat-lite youtube.py behavior).
 * Offline recheck every 60s.
 *
 * Pins: addBannerToLiveChatCommand → liveChatBannerRenderer wraps a
 * liveChatTextMessageRenderer; removeBannerForLiveChatCommand unpins.
 */
import type { Connector, ConnectorCallbacks, UnifiedEmote, UnifiedMessage } from '../types';

const OFFLINE_RECHECK_MS = 60_000;
const POLL_FLOOR_MS = 800;

interface Bootstrap { videoId: string; apiKey: string; clientVersion: string; continuation: string }

/** Flatten InnerTube runs[] → text + emote char-offsets. */
export function parseRuns(runs: any[]): { text: string; emotes: UnifiedEmote[] } {
  let text = '';
  const emotes: UnifiedEmote[] = [];
  for (const run of runs ?? []) {
    if (typeof run.text === 'string') {
      text += run.text;
    } else if (run.emoji) {
      const emoji = run.emoji;
      if (emoji.isCustomEmoji) {
        const name = (emoji.shortcuts?.[0] ?? emoji.emojiId ?? 'emote').replace(/^:|:$/g, '');
        const thumbs = emoji.image?.thumbnails ?? [];
        const url = thumbs[thumbs.length - 1]?.url;
        if (url) {
          emotes.push({
            begin: [...text].length,
            end: [...text].length + [...name].length,
            text: name,
            url,
          });
        }
        text += name;
      } else {
        text += emoji.emojiId ?? '';
      }
    }
  }
  return { text, emotes };
}

function buildMessage(renderer: any): UnifiedMessage | null {
  if (!renderer?.id) return null;
  const { text, emotes } = parseRuns(renderer.message?.runs ?? []);
  const badges: UnifiedMessage['badges'] = [];
  for (const b of renderer.authorBadges ?? []) {
    const br = b.liveChatAuthorBadgeRenderer;
    if (!br) continue;
    const type = (br.icon?.iconType ?? br.tooltip ?? '').toLowerCase();
    // member badges carry custom thumbnails; owner/mod/verified are icon types
    const thumbs = br.customThumbnail?.thumbnails ?? [];
    badges.push({ type: type === 'owner' ? 'owner' : thumbs.length ? 'subscriber' : type, url: thumbs[thumbs.length - 1]?.url });
  }
  // avatar: last authorPhoto thumbnail, upsized (StreamNook hiResAvatar)
  const photos = renderer.authorPhoto?.thumbnails ?? [];
  const avatar = (photos[photos.length - 1]?.url as string | undefined)?.replace(/=s\d+(-|$)/, '=s160$1');
  return {
    platform: 'youtube',
    id: renderer.id,
    senderId: renderer.authorExternalChannelId ?? '',
    username: renderer.authorName?.simpleText ?? '',
    color: '',
    badges,
    text,
    emotes,
    timestamp: renderer.timestampUsec ? Math.floor(Number(renderer.timestampUsec) / 1000) : Date.now(),
    kind: 'chat',
    avatar,
  };
}

/** Paid/membership renderers → system messages ("{author} sent a $5 Super Chat: msg"). */
function buildSystemMessage(item: any): UnifiedMessage | null {
  const paid = item.liveChatPaidMessageRenderer;
  const sticker = item.liveChatPaidStickerRenderer;
  const member = item.liveChatMembershipItemRenderer;
  const gift = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  const r = paid ?? sticker ?? member ?? (gift ? gift.header?.liveChatSponsorshipsHeaderRenderer : null);
  if (!r) return null;
  const id = paid?.id ?? sticker?.id ?? member?.id ?? gift?.id;
  if (!id) return null;
  const author = r.authorName?.simpleText ?? 'Someone';
  let prefix: string;
  let category: UnifiedMessage['category'];
  if (paid) { prefix = `${author} sent a ${paid.purchaseAmountText?.simpleText ?? ''} Super Chat`; category = 'cheer'; }
  else if (sticker) { prefix = `${author} sent a ${sticker.purchaseAmountText?.simpleText ?? ''} Super Sticker!`; category = 'cheer'; }
  else if (gift) { prefix = `${author} ${parseRuns(r.primaryText?.runs ?? []).text || 'gifted memberships!'}`; category = 'gift'; }
  else { prefix = `${author} ${parseRuns(member.headerSubtext?.runs ?? []).text || 'became a member!'}`; category = 'subscription'; }
  const body = parseRuns(r.message?.runs ?? []);
  const sep = body.text ? ': ' : '';
  const shift = [...prefix].length + [...sep].length;
  const photos = r.authorPhoto?.thumbnails ?? [];
  return {
    platform: 'youtube',
    id,
    senderId: r.authorExternalChannelId ?? '',
    username: author,
    color: '',
    badges: [],
    text: prefix + sep + body.text,
    emotes: body.emotes.map(e => ({ ...e, begin: e.begin + shift, end: e.end + shift })),
    timestamp: r.timestampUsec ? Math.floor(Number(r.timestampUsec) / 1000) : Date.now(),
    kind: 'system',
    category,
    avatar: (photos[photos.length - 1]?.url as string | undefined)?.replace(/=s\d+(-|$)/, '=s160$1'),
  };
}

export interface YouTubeConnectorOpts extends ConnectorCallbacks {
  channel: string;
}

export function createYouTubeConnector(opts: YouTubeConnectorOpts): Connector {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(fn: () => void, ms: number) {
    if (stopped) return;
    timer = setTimeout(fn, ms);
  }

  async function bootstrap() {
    if (stopped) return;
    opts.onStatus('connecting');
    try {
      const r = await fetch(`/api/youtube/live?channel=${encodeURIComponent(opts.channel)}`);
      const data = await r.json();
      if (data.offline) {
        opts.onStatus('offline', 'Channel is not live');
        schedule(bootstrap, OFFLINE_RECHECK_MS);
        return;
      }
      if (!r.ok || data.error) {
        opts.onStatus('error', data.error ?? `HTTP ${r.status}`);
        schedule(bootstrap, OFFLINE_RECHECK_MS);
        return;
      }
      opts.onStatus('connected');
      poll(data as Bootstrap, data.continuation, 1000);
    } catch (e: any) {
      opts.onStatus('error', e?.message);
      schedule(bootstrap, OFFLINE_RECHECK_MS);
    }
  }

  let backoff = 5000;

  async function poll(boot: Bootstrap, continuation: string, delayMs: number) {
    schedule(async () => {
      try {
        const r = await fetch('/api/youtube/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: boot.apiKey, clientVersion: boot.clientVersion, continuation }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        backoff = 5000;

        const cont = data?.continuationContents?.liveChatContinuation;
        if (!cont) {
          // chat ended → back to offline recheck loop
          opts.onStatus('offline', 'Stream ended');
          schedule(bootstrap, OFFLINE_RECHECK_MS);
          return;
        }

        for (const action of cont.actions ?? []) {
          handleAction(action);
        }

        // next continuation + timeout: invalidation > timed > reload.
        // StreamNook clamps timeoutMs to 1000..2000 — YouTube sometimes
        // returns 10s+ values that make chat lurch.
        let next: string | null = null;
        let timeoutMs = 2000;
        for (const c of cont.continuations ?? []) {
          const d = c.invalidationContinuationData ?? c.timedContinuationData ?? c.reloadContinuationData;
          if (d?.continuation) {
            next = d.continuation;
            if (typeof d.timeoutMs === 'number') timeoutMs = Math.min(Math.max(d.timeoutMs, 1000), 2000);
            break;
          }
        }
        if (!next) {
          opts.onStatus('offline', 'Stream ended');
          schedule(bootstrap, OFFLINE_RECHECK_MS);
          return;
        }
        poll(boot, next, Math.max(timeoutMs, POLL_FLOOR_MS));
      } catch (e: any) {
        opts.onStatus('error', e?.message);
        const wait = backoff;
        backoff = Math.min(backoff * 2, 60_000);
        poll(boot, continuation, wait);
      }
    }, delayMs);
  }

  function handleAction(action: any) {
    const item = action.addChatItemAction?.item;
    if (item) {
      if (item.liveChatTextMessageRenderer) {
        const msg = buildMessage(item.liveChatTextMessageRenderer);
        if (msg) opts.onMessage(msg);
      } else {
        const sys = buildSystemMessage(item);
        if (sys) opts.onMessage(sys);
      }
      return;
    }
    const delId = action.markChatItemAsDeletedAction?.targetItemId;
    if (delId) { opts.onDelete({ id: delId }); return; }
    // ban/timeout: remove all messages from that channel id (StreamNook)
    const banned = action.markChatItemsByAuthorAsDeletedAction?.externalChannelId;
    if (banned) { opts.onDelete({ senderId: banned }); return; }

    // Pinned message banner (not implemented in either reference repo;
    // shape: addBannerToLiveChatCommand.bannerRenderer.liveChatBannerRenderer
    //        .contents.liveChatTextMessageRenderer)
    const banner = action.addBannerToLiveChatCommand?.bannerRenderer?.liveChatBannerRenderer;
    if (banner) {
      const inner = banner.contents?.liveChatTextMessageRenderer;
      const msg = inner ? buildMessage(inner) : null;
      if (msg) opts.onPin({ message: msg });
      return;
    }
    if (action.removeBannerForLiveChatCommand) {
      opts.onPin(null);
    }
  }

  return {
    start() { bootstrap(); },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
