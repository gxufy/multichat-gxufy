import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';
import { normalizeChatChannel } from '../channelValidation';
import { parseTwitchGifTag } from '../twitchGif';
import { loadFFZRoomBadges } from '../twitchEmotes';
import { fetchTwitchProfile } from '../twitchProfileClient';
import { resolveTwitchCommunityBadges } from '../communityBadges';
import type { LimerinoBadgeRenderOptions } from '../limerinoBadges';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

const PRIORITY_BADGES = ['predictions', 'admin', 'global_mod', 'staff', 'twitchbot', 'broadcaster', 'lead_moderator', 'moderator', 'vip'];

const TAG_ESCAPES: Record<string, string> = { '\\:': ';', '\\s': ' ', '\\\\': '\\', '\\r': '\r', '\\n': '\n' };
const MAX_ENRICHMENT_MESSAGES = 250;

function unescapeTag(v: string): string {
  return v.replace(/\\[:s\\rn]/g, m => TAG_ESCAPES[m] ?? m);
}

function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) tags[part] = '';
    else tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1));
  }
  return tags;
}

interface IrcLine {
  tags: Record<string, string>;
  prefix: string | null;
  command: string;
  params: string[];
  trailing: string | null;
}

/** IRC line: [@tags ][:prefix ]COMMAND [params][ :trailing] */
export function parseLine(line: string): IrcLine | null {
  let rest = line;
  let tags: Record<string, string> = {};
  let prefix: string | null = null;

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  let trailing: string | null = null;
  const ti = rest.indexOf(' :');
  if (ti !== -1) {
    trailing = rest.slice(ti + 2);
    rest = rest.slice(0, ti);
  }

  const parts = rest.split(' ').filter(Boolean);
  if (!parts.length) return null;
  return { tags, prefix, command: parts[0], params: parts.slice(1), trailing };
}

/** emotes tag "25:0-4,12-16/1902:6-10" → UnifiedEmote[] (code-point offsets). */
export function parseTwitchEmotes(rawTag: string, text: string): UnifiedEmote[] {
  if (!rawTag) return [];
  const chars = Array.from(text);
  const emotes: UnifiedEmote[] = [];
  for (const group of rawTag.split('/')) {
    const colon = group.indexOf(':');
    if (colon === -1) continue;
    const id = group.slice(0, colon);
    for (const range of group.slice(colon + 1).split(',')) {
      const [b, e] = range.split('-');
      const begin = parseInt(b), end = parseInt(e) + 1;
      if (isNaN(begin) || isNaN(end)) continue;
      emotes.push({
        begin, end,
        text: chars.slice(begin, end).join(''),
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/3.0`,
      });
    }
  }
  return emotes.sort((a, b) => a.begin - b.begin);
}

function parseBadges(rawTag: string, badgeMap: Record<string, string>): UnifiedBadge[] {
  if (!rawTag) return [];
  const all = rawTag.split(',').filter(Boolean).map(b => {
    const [type, version] = b.split('/');
    return {
      type,
      version,
      count: /^\d+$/.test(version) ? parseInt(version, 10) : undefined,
      url: badgeMap[b] ?? badgeMap[`${type}/1`],
    };
  });
  return [
    ...all.filter(b => PRIORITY_BADGES.includes(b.type)),
    ...all.filter(b => !PRIORITY_BADGES.includes(b.type)),
  ];
}

/** Accept only the exact safe map promised by /api/twitch/badges. */
export function parseBadgeMap(value: unknown): Record<string, string> | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'badges' in value
  ) {
    value = (value as { badges?: unknown }).badges;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const entries = Object.entries(value);
  for (const [key, url] of entries) {
    const parts = key.split('/');
    if (parts.length !== 2 || parts.some((part) => !part)) return null;
    if (typeof url !== 'string') return null;
    try {
      if (new URL(url).protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function prefixText(prefix: string, text: string, emotes: UnifiedEmote[]): { text: string; emotes: UnifiedEmote[] } {
  if (!text) return { text: prefix, emotes: [] };
  const shift = [...prefix].length + 2;
  return {
    text: `${prefix}: ${text}`,
    emotes: emotes.map(e => ({ ...e, begin: e.begin + shift, end: e.end + shift })),
  };
}

/** The overlay URL is immutable for one connector lifetime, so this is a cheap
 * runtime gate that also keeps tests/server callers default-on when no window
 * exists. */
function communityBadgesEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return new URLSearchParams(window.location.search).get('showCommunityBadges') !== 'false';
}

export interface TwitchConnectorOpts extends ConnectorCallbacks {
  channel: string;
  /** room-id from ROOMSTATE — used for 7TV Twitch channel emotes */
  onRoomId?(roomId: string): void;
  /** Badge art changed after messages may already have been delivered. */
  onBadgeMap?(badgeMap: Readonly<Record<string, string>>): void;
  /** Runtime gate for source-streamer profile enrichment. */
  shouldEnrichSourceChannel?(): boolean;
  /** Current overlay badge geometry used for Limerino's responsive art set. */
  communityBadgeRenderOptions?: LimerinoBadgeRenderOptions;
}

export function createTwitchConnector(opts: TwitchConnectorOpts): Connector {
  const channel = normalizeChatChannel('twitch', opts.channel).toLowerCase();
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 1000;
  let roomIdSent = false;
  // "<setID>/<version>" → imageURL; empty until the fetch resolves
  // (messages arriving before then just render without badge art)
  let badgeMap: Record<string, string> = {};
  let generation = 0;
  const deliveredMessages = new Map<string, UnifiedMessage>();

  if (channel) {
    fetch(`/api/twitch/badges?channel=${encodeURIComponent(channel)}`)
      .then(r => r.ok ? r.json() : null)
      .then(value => {
        const parsed = parseBadgeMap(value);
        if (parsed) {
          badgeMap = parsed;
          opts.onBadgeMap?.(badgeMap);
        }
      })
      .catch(() => { /* fall back to bare types */ });
  }

  function remember(message: UnifiedMessage): void {
    deliveredMessages.set(message.id, message);
    while (deliveredMessages.size > MAX_ENRICHMENT_MESSAGES) {
      const oldest = deliveredMessages.keys().next().value as string | undefined;
      if (!oldest) break;
      deliveredMessages.delete(oldest);
    }
  }

  function withCurrentNativeBadgeArt(message: UnifiedMessage): UnifiedMessage {
    const badges = message.badges.map((badge) => {
      if (badge.type.startsWith('community:') || badge.url) return badge;
      const version = badge.version ?? (badge.count ? String(badge.count) : '1');
      const url = badgeMap[`${badge.type}/${version}`] ?? badgeMap[`${badge.type}/1`];
      return url ? { ...badge, url } : badge;
    });
    return { ...message, badges };
  }

  function enrichSharedMessage(message: UnifiedMessage): void {
    const roomId = message.sourceChannel?.roomId;
    if (!roomId) return;
    /* The room id stays on every Twitch row so Shared Chat can be enabled at
       runtime, but profile traffic is skipped while the feature is off. A
       local !multichat sharedon command flips the gate during onMessage, before
       deliver() reaches this enrichment step, so that very message can receive
       its source avatar without reconnecting. */
    if (opts.shouldEnrichSourceChannel?.() === false) return;
    const ownedGeneration = generation;
    void fetchTwitchProfile(roomId).then(profile => {
      if (stopped || generation !== ownedGeneration || !profile) return;
      const current = deliveredMessages.get(message.id);
      if (!current || current.sourceChannel?.roomId !== roomId) return;
      const enriched = { ...current, sourceChannel: profile };
      remember(enriched);
      opts.onMessageUpdate?.(enriched);
    });
  }

  function enrichCommunityBadges(message: UnifiedMessage): void {
    if (!communityBadgesEnabled() || !message.senderId) return;
    const ownedGeneration = generation;
    void resolveTwitchCommunityBadges(
      message.senderId,
      message.username,
      opts.communityBadgeRenderOptions,
    ).then(communityBadges => {
      if (stopped || generation !== ownedGeneration || !communityBadges.length) return;
      const current = deliveredMessages.get(message.id);
      if (!current || current.senderId !== message.senderId) return;
      const native = withCurrentNativeBadgeArt(current).badges.filter((badge) => !badge.type.startsWith('community:'));
      const enriched = { ...current, badges: [...native, ...communityBadges] };
      remember(enriched);
      opts.onMessageUpdate?.(enriched);
    });
  }

  function buildMessage(p: IrcLine, kind: 'chat' | 'system', text: string, emotes: UnifiedEmote[], category?: UnifiedMessage['category']): UnifiedMessage {
    const tags = p.tags;
    const prefixLogin = p.prefix?.includes('!') ? p.prefix.split('!')[0] : '';
    const login = tags['login'] || prefixLogin;
    const sourceRoomId = tags['source-room-id'];
    const localRoomId = tags['room-id'];
    const sharedChat = Boolean(sourceRoomId && sourceRoomId !== localRoomId);
    const replyUsername = tags['reply-parent-display-name'] || tags['reply-parent-user-login'];
    const hasReplyBody = Object.prototype.hasOwnProperty.call(tags, 'reply-parent-msg-body');
    const reply = replyUsername && (tags['reply-parent-msg-id'] || hasReplyBody)
      ? {
          username: replyUsername,
          text: tags['reply-parent-msg-body'] ?? '',
          ...(tags['reply-parent-msg-id'] ? { messageId: tags['reply-parent-msg-id'] } : {}),
          ...(tags['reply-parent-user-id'] ? { senderId: tags['reply-parent-user-id'] } : {}),
        }
      : undefined;
    const gifUrl = kind === 'chat' ? parseTwitchGifTag(tags['gifs']) : undefined;
    const message: UnifiedMessage = {
      platform: 'twitch',
      id: tags['id'] || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderId: tags['user-id'] ?? '',
      ...(login ? { senderUsername: login } : {}),
      username: tags['display-name'] || login || 'unknown',
      color: tags['color'] || '',
      badges: parseBadges(tags['badges'] ?? '', badgeMap),
      text,
      emotes,
      timestamp: parseInt(tags['tmi-sent-ts']) || Date.now(),
      kind,
      category,
      ...(gifUrl ? { gifUrl } : {}),
      ...(reply ? { reply } : {}),
      ...(sourceRoomId ? { sourceChannel: { roomId: sourceRoomId } } : {}),
      ...(sharedChat ? { sharedChat: true } : {}),
    };
    return message;
  }

  function deliver(message: UnifiedMessage): void {
    remember(message);
    opts.onMessage(message);
    enrichSharedMessage(message);
    enrichCommunityBadges(message);
  }

  function usernoticeCategory(msgId: string): UnifiedMessage['category'] {
    if (['sub','resub','primepaidupgrade','giftpaidupgrade','anongiftpaidupgrade','standardpayforward','communitypayforward','sharedchatnotice'].includes(msgId)) return 'subscription';
    if (['subgift','submysterygift','anonsubgift','anonsubmysterygift'].includes(msgId)) return 'gift';
    if (msgId === 'raid' || msgId === 'unraid') return 'raid';
    if (['viewermilestone','watchstreak','bitsbadgetier'].includes(msgId)) return 'milestone';
    if (msgId === 'charitydonation') return 'cheer';
    return 'announcement';
  }

  function handleLine(line: string) {
    const p = parseLine(line);
    if (!p) return;

    switch (p.command) {
      case 'PING':
        ws?.send(`PONG :${p.trailing ?? 'tmi.twitch.tv'}`);
        break;
      case 'JOIN':
        if ((p.prefix ?? '').startsWith('justinfan')) opts.onStatus('connected');
        break;
      case 'ROOMSTATE': {
        const roomId = p.tags['room-id'];
        if (roomId && !roomIdSent) {
          roomIdSent = true;
          opts.onRoomId?.(roomId);

          loadFFZRoomBadges(roomId)
            .then(overrides => {
              Object.assign(badgeMap, overrides);
              opts.onBadgeMap?.(badgeMap);
            })
            .catch(() => { /* keep stock art */ });
        }
        break;
      }
      case 'PRIVMSG': {
        const text = p.trailing ?? '';
        let emotes = parseTwitchEmotes(p.tags['emotes'] ?? '', text);
        const bits = p.tags['bits'];
        if (bits) {
          const author = p.tags['display-name'] || (p.prefix ?? '').split('!')[0];
          const pref = prefixText(`${author} cheered ${bits} bits`, text, emotes);
          deliver(buildMessage(p, 'system', pref.text, pref.emotes, 'cheer'));
        } else {
          const msg = buildMessage(p, 'chat', text, emotes);
          if (p.tags['first-msg'] === '1') msg.firstMessage = true;
          // channel-point redeems: custom-reward-id / highlighted-message tag
          if (p.tags['custom-reward-id'] || p.tags['msg-id'] === 'highlighted-message') {
            msg.redeem = p.tags['custom-reward-id'] || 'highlighted';
          }
          deliver(msg);
        }
        break;
      }
      case 'USERNOTICE': {
        // Subs/resubs/gifts/raids/announcements: system-msg tag is the
        // ready-made line; user comment (resub message) rides in trailing.
        const systemMsg = (p.tags['system-msg'] ?? '').trim();
        const userMsg = p.trailing ?? '';
        let emotes = userMsg ? parseTwitchEmotes(p.tags['emotes'] ?? '', userMsg) : [];
        let text: string;
        if (systemMsg && userMsg) ({ text, emotes } = prefixText(systemMsg, userMsg, emotes));
        else text = systemMsg || userMsg;
        if (text) deliver(buildMessage(p, 'system', text, emotes, usernoticeCategory(p.tags['msg-id'] ?? '')));
        break;
      }
      case 'CLEARMSG': {
        const id = p.tags['target-msg-id'];
        if (id) opts.onDelete({ id });
        break;
      }
      case 'CLEARCHAT': {
        // Trailing user = ban/timeout; no trailing = full clear
        const login = (p.trailing ?? '').toLowerCase();
        opts.onDelete(login ? { username: login } : {});
        break;
      }
      case 'RECONNECT':
        ws?.close();
        break;
    }
  }

  function connect() {
    if (stopped) return;
    opts.onStatus('connecting');
    ws = new WebSocket(IRC_URL);
    ws.onopen = () => {
      backoff = 1000;
      ws!.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws!.send(`NICK justinfan${Math.floor(10000 + Math.random() * 90000)}`);
      ws!.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (line) handleLine(line);
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      opts.onStatus('connecting', `Reconnecting in ${Math.round(backoff / 1000)}s`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
    ws.onerror = () => ws?.close();
  }

  return {
    start() {
      if (!channel) {
        opts.onStatus('error', 'Invalid Twitch channel');
        return;
      }
      connect();
    },
    stop() {
      stopped = true;
      generation += 1;
      deliveredMessages.clear();
      ws?.close();
    },
  };
}
