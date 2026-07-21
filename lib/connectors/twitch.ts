/* Twitch chat connector — anonymous IRC over websocket (no OAuth).
 *
 * Read-only "justinfan<digits>" nick (unified-chat-lite twitch.py scheme),
 * runs entirely in the browser: wss://irc-ws.chat.twitch.tv:443 with
 * tags+commands caps. PRIVMSG → chat, USERNOTICE → system (subs/raids),
 * CLEARMSG/CLEARCHAT → deletes, RECONNECT → reconnect.
 * Emote offsets come from the `emotes` tag (code points, exclusive end
 * converted here). No anonymous pin events exist on Twitch — pins need
 * OAuth (StreamNook uses authed GQL) — so this connector never calls onPin.
 */
import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';
import { loadFFZRoomBadges } from '../twitchEmotes';

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

/* chatis badge render order (script.js:1846): priority badges first,
   in-tag-order within each group; subscriber/bits/etc after */
const PRIORITY_BADGES = ['predictions', 'admin', 'global_mod', 'staff', 'twitchbot', 'broadcaster', 'lead_moderator', 'moderator', 'vip'];

const TAG_ESCAPES: Record<string, string> = { '\\:': ';', '\\s': ' ', '\\\\': '\\', '\\r': '\r', '\\n': '\n' };

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

/** badges tag "moderator/1,subscriber/12" → UnifiedBadge[].
 * URLs resolved against the GQL badge map (global + channel sets) so
 * sub tiers / bits / event badges get their real art. Priority badges
 * (broadcaster/mod/vip/staff...) sort first — chatis render order. */
function parseBadges(rawTag: string, badgeMap: Record<string, string>): UnifiedBadge[] {
  if (!rawTag) return [];
  const all = rawTag.split(',').filter(Boolean).map(b => {
    const [type, version] = b.split('/');
    return { type, count: parseInt(version) || undefined, url: badgeMap[b] ?? badgeMap[`${type}/1`] };
  });
  return [
    ...all.filter(b => PRIORITY_BADGES.includes(b.type)),
    ...all.filter(b => !PRIORITY_BADGES.includes(b.type)),
  ];
}

/** "prefix: text" with emote offsets shifted (unified-chat-lite prefix_text) */
function prefixText(prefix: string, text: string, emotes: UnifiedEmote[]): { text: string; emotes: UnifiedEmote[] } {
  if (!text) return { text: prefix, emotes: [] };
  const shift = [...prefix].length + 2;
  return {
    text: `${prefix}: ${text}`,
    emotes: emotes.map(e => ({ ...e, begin: e.begin + shift, end: e.end + shift })),
  };
}

export interface TwitchConnectorOpts extends ConnectorCallbacks {
  channel: string;
  /** room-id from ROOMSTATE — used for 7TV Twitch channel emotes */
  onRoomId?(roomId: string): void;
}

export function createTwitchConnector(opts: TwitchConnectorOpts): Connector {
  const channel = opts.channel.toLowerCase().replace(/^#/, '');
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 1000;
  let roomIdSent = false;
  // "<setID>/<version>" → imageURL; empty until the fetch resolves
  // (messages arriving before then just render without badge art)
  let badgeMap: Record<string, string> = {};

  fetch(`/api/twitch/badges?channel=${encodeURIComponent(channel)}`)
    .then(r => r.ok ? r.json() : {})
    .then(m => { badgeMap = m; })
    .catch(() => { /* fall back to bare types */ });

  function buildMessage(p: IrcLine, kind: 'chat' | 'system', text: string, emotes: UnifiedEmote[], category?: UnifiedMessage['category']): UnifiedMessage {
    const tags = p.tags;
    const login = (p.prefix ?? '').split('!')[0] || tags['login'] || 'unknown';
    return {
      platform: 'twitch',
      id: tags['id'] || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderId: tags['user-id'] ?? '',
      username: tags['display-name'] || login,
      color: tags['color'] || '',
      badges: parseBadges(tags['badges'] ?? '', badgeMap),
      text,
      emotes,
      timestamp: parseInt(tags['tmi-sent-ts']) || Date.now(),
      kind,
      category,
    };
  }

  /* StreamNook CATEGORY_OF: msg-id → event category */
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
          // FFZ custom room badges override stock mod/vip art (chatis :1416)
          loadFFZRoomBadges(roomId)
            .then(overrides => { Object.assign(badgeMap, overrides); })
            .catch(() => { /* keep stock art */ });
        }
        break;
      }
      case 'PRIVMSG': {
        const text = p.trailing ?? '';
        let emotes = parseTwitchEmotes(p.tags['emotes'] ?? '', text);
        const bits = p.tags['bits'];
        if (bits) {
          // Cheers → system notices, like subs/gifts (unified-chat-lite)
          const author = p.tags['display-name'] || (p.prefix ?? '').split('!')[0];
          const pref = prefixText(`${author} cheered ${bits} bits`, text, emotes);
          opts.onMessage(buildMessage(p, 'system', pref.text, pref.emotes, 'cheer'));
        } else {
          const msg = buildMessage(p, 'chat', text, emotes);
          // channel-point redeems: custom-reward-id / highlighted-message tag
          if (p.tags['custom-reward-id'] || p.tags['msg-id'] === 'highlighted-message') {
            msg.redeem = p.tags['custom-reward-id'] || 'highlighted';
          }
          opts.onMessage(msg);
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
        if (text) opts.onMessage(buildMessage(p, 'system', text, emotes, usernoticeCategory(p.tags['msg-id'] ?? '')));
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
    start() { connect(); },
    stop() {
      stopped = true;
      ws?.close();
    },
  };
}
